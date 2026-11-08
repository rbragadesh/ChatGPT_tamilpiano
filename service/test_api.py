"""API lifecycle tests use real multipart parsing/FFmpeg and a deterministic inference stub."""
import io
from pathlib import Path
import threading
import time
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app as api


def audio_bytes(seconds=1.2):
    data = (np.sin(np.arange(round(22050 * seconds)) * (2 * np.pi * 261.6256 / 22050)) * 10000).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(22050)
        output.writeframes(data.tobytes())
    return buffer.getvalue()


def fake_engine(path, start, end):
    assert Path(path).exists()
    return {"duration": end - start, "sourceStart": start, "notes": [{"midi": 60, "start": 0, "end": end - start, "confidence": 0.9}], "chords": [], "warnings": ["Test inference stub."]}


def submit(client, **fields):
    return client.post("/v1/transcriptions", files={"file": ("notes.wav", audio_bytes(), "audio/wav")}, data={"start_seconds": "0.2", "end_seconds": "0.8", **fields})


def wait(client, id):
    for _ in range(200):
        response = client.get(f"/v1/transcriptions/{id}")
        if response.json()["status"] in ("completed", "failed"):
            return response.json()
        time.sleep(0.025)
    pytest.fail("Transcription job did not finish")


def test_upload_excerpt_result_cleanup_and_delete():
    app = api.create_app(fake_engine, lambda: True)
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
        submitted = submit(client)
        assert submitted.status_code == 202, submitted.text
        id = submitted.json()["id"]
        directory = app.state.jobs[id].directory
        job = wait(client, id)
        assert job["status"] == "completed", job
        result = job["result"]
        assert result["sourceStart"] == 0.2
        assert abs(result["duration"] - 0.6) < 0.01
        assert result["notes"][0]["midi"] == 60
        assert not directory.exists(), "Original upload and decoded audio must be deleted"
        assert client.delete(f"/v1/transcriptions/{id}").status_code == 204
        assert client.get(f"/v1/transcriptions/{id}").status_code == 404


def test_invalid_ranges_and_missing_setup():
    with TestClient(api.create_app(fake_engine, lambda: False)) as client:
        assert client.get("/health").status_code == 503
        assert submit(client).status_code == 503
    with TestClient(api.create_app(fake_engine, lambda: True)) as client:
        for fields in [{"start_seconds": "nan"}, {"start_seconds": "-1"}, {"end_seconds": "0.1"}, {"end_seconds": "61"}]:
            assert submit(client, **fields).status_code == 422
        assert client.post("/v1/transcriptions", files={"file": ("empty.wav", b"", "audio/wav")}).status_code == 422


def test_bad_audio_and_out_of_range_selection_fail_cleanly():
    app = api.create_app(fake_engine, lambda: True)
    with TestClient(app) as client:
        response = client.post("/v1/transcriptions", files={"file": ("fake.mp3", b"not an audio file", "audio/mpeg")}, data={"end_seconds": "1"})
        id = response.json()["id"]
        directory = app.state.jobs[id].directory
        assert wait(client, id)["status"] == "failed"
        assert not directory.exists()
        submitted = submit(client, end_seconds="3")
        job = wait(client, submitted.json()["id"])
        assert job["status"] == "failed"
        assert "beyond the uploaded audio" in job["error"]


def test_body_cap_origin_and_cors(monkeypatch):
    monkeypatch.setattr(api, "MAX_BODY_BYTES", 1024)
    with TestClient(api.create_app(fake_engine, lambda: True)) as client:
        assert submit(client).status_code == 413
        response = client.post("/v1/transcriptions", files={"file": ("notes.wav", audio_bytes())}, headers={"Origin": "https://untrusted.example"})
        assert response.status_code == 403
        assert "access-control-allow-origin" not in response.headers
        response = client.options("/v1/transcriptions", headers={"Origin": "http://127.0.0.1:5173", "Access-Control-Request-Method": "POST"})
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
        response = client.post("/v1/transcriptions", content=b"x" * 2048, headers={"Content-Type": "multipart/form-data; boundary=xx", "Origin": "http://127.0.0.1:5173"})
        assert response.status_code == 413
        assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_streamed_body_limit_cannot_be_evaded_without_content_length(monkeypatch):
    monkeypatch.setattr(api, "MAX_BODY_BYTES", 1024)
    with TestClient(api.create_app(fake_engine, lambda: True)) as client:
        response = client.post("/v1/transcriptions", content=iter([b"a" * 600, b"b" * 600]), headers={"Content-Type": "multipart/form-data; boundary=xx"})
        assert response.status_code == 413


def test_bounded_queue_and_cancelled_jobs_release_audio():
    gate = threading.Event()
    entered = threading.Event()
    def slow_engine(*args):
        entered.set()
        assert gate.wait(timeout=10)
        return fake_engine(*args)
    app = api.create_app(slow_engine, lambda: True)
    with TestClient(app) as client:
        try:
            first = submit(client).json()["id"]
            assert entered.wait(5)
            queued = [submit(client).json()["id"] for _ in range(3)]
            assert submit(client).status_code == 429
            directory = app.state.jobs[queued[0]].directory
            assert client.delete(f"/v1/transcriptions/{queued[0]}").status_code == 204
            assert not directory.exists()
            assert client.delete(f"/v1/transcriptions/{first}").status_code == 204
            assert client.get(f"/v1/transcriptions/{first}").status_code == 404
        finally:
            gate.set()
        for id in queued[1:]:
            assert wait(client, id)["status"] == "completed"


def test_cors_configuration_rejects_wildcard_and_path(monkeypatch):
    for bad in ["*", "https://rbragadesh.github.io/ChatGPT_tamilpiano", "https://user:pass@example.com"]:
        monkeypatch.setenv("ISAI_ALLOWED_ORIGINS", bad)
        with pytest.raises(ValueError):
            api.allowed_origins()
