"""Ephemeral, bounded CPU transcription API. Run one Uvicorn worker per instance."""
from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
import logging
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from typing import Callable
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.datastructures import UploadFile
from starlette.responses import JSONResponse

from engine import model_available, transcribe_audio

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 128 * 1024
MAX_EXCERPT_SECONDS = 60
MAX_PENDING = 4  # one processing + three queued
RETENTION_SECONDS = 15 * 60
logger = logging.getLogger("isai.service")


def allowed_origins() -> list[str]:
    from urllib.parse import urlsplit
    values = os.environ.get("ISAI_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    origins = []
    for raw in values:
        value = raw.strip().rstrip("/")
        u = urlsplit(value)
        if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password or u.path or u.query or u.fragment or "*" in value:
            raise ValueError("ISAI_ALLOWED_ORIGINS must contain comma-separated exact HTTP(S) origins, without paths or wildcards.")
        origins.append(value)
    return origins


class UploadGuard:
    """Reject oversized/slow multipart bodies before the multipart parser spools files."""
    def __init__(self, app, origins: list[str]):
        self.app = app
        self.origins = origins
        self.uploads = 0
        self.requests: dict[str, deque[float]] = defaultdict(deque)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/v1/transcriptions":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        origin = headers.get(b"origin", b"").decode("latin1")
        async def reject(status, message):
            await JSONResponse({"detail": message}, status_code=status)(scope, receive, send)
        if origin and origin not in self.origins:
            return await reject(403, "This browser origin is not allowed by the service.")
        content_type = headers.get(b"content-type", b"").lower()
        if not content_type.startswith(b"multipart/form-data;"):
            return await reject(415, "Send an audio file using multipart/form-data.")
        try:
            if int(headers.get(b"content-length", b"0")) > MAX_BODY_BYTES:
                return await reject(413, "The upload is too large. Choose a file of 25 MiB or less.")
        except ValueError:
            return await reject(400, "Invalid Content-Length.")
        # Forwarded-IP headers are not trusted here. Configure proxy rate limits separately.
        peer = (scope.get("client") or ("unknown",))[0]
        now = time.monotonic()
        for key in list(self.requests):
            while self.requests[key] and self.requests[key][0] <= now - 60:
                self.requests[key].popleft()
            if not self.requests[key]:
                del self.requests[key]
        recent = self.requests[peer]
        if len(recent) >= 6:
            return await reject(429, "Upload limit reached. Wait one minute and try again.")
        if self.uploads >= MAX_PENDING:
            return await reject(429, "The service is busy. Try again shortly.")
        recent.append(now)
        self.uploads += 1
        try:
            body = bytearray()
            try:
                async with asyncio.timeout(60):
                    while True:
                        event = await receive()
                        if event["type"] == "http.disconnect":
                            return
                        body.extend(event.get("body", b""))
                        if len(body) > MAX_BODY_BYTES:
                            return await reject(413, "The upload is too large. Choose a file of 25 MiB or less.")
                        if not event.get("more_body", False):
                            break
            except TimeoutError:
                return await reject(408, "The upload timed out. Try a shorter audio file.")
            sent = False
            async def replay():
                nonlocal sent
                if not sent:
                    sent = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await receive()
            await self.app(scope, replay, send)
        finally:
            self.uploads -= 1


@dataclass
class Job:
    id: str
    directory: Path
    start: float
    end: float
    status: str = "queued"
    created: float = field(default_factory=time.monotonic)
    finished: float | None = None
    result: dict | None = None
    error: str | None = None
    cancelled: bool = False

    def public(self):
        response = {"id": self.id, "status": self.status}
        if self.result is not None:
            response["result"] = self.result
        if self.error is not None:
            response["error"] = self.error
        return response


def process_audio(job: Job, engine: Callable) -> dict:
    """Decode only the selected excerpt; never accept URLs or remote media inputs."""
    source = job.directory / "upload"
    output = job.directory / "excerpt.wav"
    command = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
        "-protocol_whitelist", "file,pipe", "-format_whitelist", "wav,mp3,mov,flac,ogg,aac,matroska,webm,aiff", "-ss", str(job.start), "-i", str(source),
        "-t", str(job.end - job.start), "-map", "0:a:0", "-vn", "-sn", "-dn",
        "-ac", "1", "-ar", "22050", "-c:a", "pcm_s16le", "-y", str(output),
    ]
    try:
        decoded = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=45, check=False)
    except subprocess.TimeoutExpired:
        raise ValueError("Audio decoding timed out. Upload a shorter or simpler audio file.") from None
    if decoded.returncode or not output.exists() or output.stat().st_size < 128:
        raise ValueError("Could not decode audio at that timeframe. Check the file and its start/end times.")
    import soundfile as sf
    info = sf.info(output)
    duration = info.frames / info.samplerate
    if duration < 0.1:
        raise ValueError("This timeframe contains no usable audio. Select at least 0.1 seconds.")
    if duration + 0.1 < job.end - job.start:
        raise ValueError("The selected end time is beyond the uploaded audio. Choose a timeframe inside the file, or select the already-trimmed option.")
    if job.cancelled:
        raise ValueError("Cancelled.")
    result = engine(str(output), 0, duration)
    result["sourceStart"] = job.start
    result["sourceEnd"] = job.start + duration
    return result


def create_app(engine: Callable = transcribe_audio, ready: Callable = model_available) -> FastAPI:
    origins = allowed_origins()
    jobs: dict[str, Job] = {}
    pending: set[str] = set()
    queue: asyncio.Queue[Job] = asyncio.Queue(maxsize=MAX_PENDING)
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="isai-transcription")

    async def worker():
        while True:
            job = await queue.get()
            try:
                if job.cancelled:
                    continue
                job.status = "processing"
                try:
                    result = await asyncio.get_running_loop().run_in_executor(executor, process_audio, job, engine)
                    if not job.cancelled:
                        job.result = result
                        job.status = "completed"
                except ValueError as error:
                    if not job.cancelled:
                        job.error = str(error)
                        job.status = "failed"
                except Exception:
                    logger.exception("Transcription failed for job %s", job.id)
                    if not job.cancelled:
                        job.error = "Audio processing failed. Try a shorter, clear instrumental excerpt."
                        job.status = "failed"
            finally:
                job.finished = time.monotonic()
                pending.discard(job.id)
                shutil.rmtree(job.directory, ignore_errors=True)
                queue.task_done()

    async def expire():
        while True:
            await asyncio.sleep(30)
            now = time.monotonic()
            for key, job in list(jobs.items()):
                if job.finished is not None and now - job.finished > RETENTION_SECONDS:
                    jobs.pop(key, None)

    @asynccontextmanager
    async def lifespan(app):
        tasks = [asyncio.create_task(worker()), asyncio.create_task(expire())]
        try:
            yield
        finally:
            for job in jobs.values():
                job.cancelled = True
            # Wait for the bounded current inference before removing its input files.
            await queue.join()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            executor.shutdown(wait=True, cancel_futures=True)
            for job in jobs.values():
                shutil.rmtree(job.directory, ignore_errors=True)

    app = FastAPI(title="Isai audio transcription", version="1.0.0", lifespan=lifespan, docs_url="/docs", redoc_url=None)
    app.state.jobs = jobs
    app.add_middleware(UploadGuard, origins=origins)
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"], allow_credentials=False)

    @app.get("/health")
    async def health():
        available = ready() and shutil.which("ffmpeg") is not None
        return JSONResponse({"status": "ok" if available else "unavailable", "engine": "basic-pitch-onnx-0.4.0", "limits": {"maxUploadBytes": MAX_UPLOAD_BYTES, "maxExcerptSeconds": MAX_EXCERPT_SECONDS}, "retentionSeconds": RETENTION_SECONDS}, status_code=200 if available else 503)

    @app.post("/v1/transcriptions", status_code=202)
    async def submit(request: Request):
        if not ready() or shutil.which("ffmpeg") is None:
            raise HTTPException(503, "The transcription model or FFmpeg is unavailable. Ask the service operator to finish setup.")
        if len(pending) >= MAX_PENDING:
            raise HTTPException(429, "The processing queue is full. Try again shortly.")
        form = await request.form(max_files=1, max_fields=2, max_part_size=MAX_UPLOAD_BYTES)
        try:
            uploaded = form.get("file")
            if not isinstance(uploaded, UploadFile):
                raise HTTPException(422, "Choose an audio file.")
            try:
                start = float(str(form.get("start_seconds", "0")))
                end = float(str(form.get("end_seconds", "30")))
            except (ValueError, TypeError):
                raise HTTPException(422, "Start and end times must be numbers.") from None
            if not all(math.isfinite(v) for v in (start, end)) or start < 0 or end <= start or end - start > MAX_EXCERPT_SECONDS:
                raise HTTPException(422, "Choose a nonnegative start time and an end time up to 60 seconds later.")
            directory = Path(tempfile.mkdtemp(prefix="isai-audio-"))
            try:
                count = 0
                with (directory / "upload").open("wb") as target:
                    while chunk := await uploaded.read(1024 * 1024):
                        count += len(chunk)
                        if count > MAX_UPLOAD_BYTES:
                            raise HTTPException(413, "Choose a file of 25 MiB or less.")
                        target.write(chunk)
                if not count:
                    raise HTTPException(422, "The uploaded file is empty.")
                # No await between final capacity check and queue reservation.
                if len(pending) >= MAX_PENDING:
                    raise HTTPException(429, "The processing queue is full. Try again shortly.")
                job = Job(uuid.uuid4().hex, directory, start, end)
                queue.put_nowait(job)
                pending.add(job.id)
                jobs[job.id] = job
                return job.public()
            except BaseException:
                shutil.rmtree(directory, ignore_errors=True)
                raise
        finally:
            await form.close()

    @app.get("/v1/transcriptions/{job_id}")
    async def get_job(job_id: str):
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "This job was not found or has expired. Upload the audio again.")
        return job.public()

    @app.delete("/v1/transcriptions/{job_id}", status_code=204)
    async def delete_job(job_id: str):
        job = jobs.pop(job_id, None)
        if job is None:
            raise HTTPException(404, "This job was not found or has already expired.")
        job.cancelled = True
        if job.status != "processing":
            shutil.rmtree(job.directory, ignore_errors=True)

    return app


app = create_app()
