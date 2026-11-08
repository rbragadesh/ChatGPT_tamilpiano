# Isai audio transcription service

The Isai frontend stays a static app on GitHub Pages. This separate Python service accepts an audio file, transcribes a selected passage, and returns timed note events for review and practice. It uses Spotify's Basic Pitch ONNX model on the CPU, without a paid API or API key.

The software is free to run. An always-available public server is separate from GitHub Pages and may have hosting costs or free-tier limits. No public service has been deployed by adding these files.

## What the service can analyse

Upload an audio file you can use, such as a recording of your keyboard or an audio excerpt you already have. A saved YouTube link remains a listening bookmark: the service does not download YouTube audio. Choose the same timeframe as the saved clip, or use start `0` when your uploaded file is already trimmed.

Basic Pitch estimates pitches and note onsets from audio. A clear piano or isolated instrumental recording works better than a complete film mix. Vocals, percussion, overlapping instruments, ornamentation, and recording effects can create missed, extra, or incorrect notes. Generated notes and chord suggestions are drafts to check against the recording, not verified scores. The service does not identify a raga or model Carnatic gamakas.

## Local development

Use Python 3.12 and FFmpeg. FFmpeg must be installed as a system executable; it decodes supported MP3, WAV, M4A, FLAC, and OGG files. Dependency and model downloads require Internet access during setup. Inference runs locally without an external AI API.

From the repository root:

```sh
python3 -m venv service/.venv
service/.venv/bin/python -m pip install --cache-dir /tmp/isai-pip-cache -r service/requirements-api.txt
cd service
.venv/bin/python engine.py --download-model
ISAI_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173 \
  .venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1
```

The model setup command fetches the official `basic-pitch==0.4.0` wheel over HTTPS, verifies its pinned SHA-256, and extracts the ONNX model and its Apache license/notice. The engine also verifies the model file's checksum before loading it. Do not disable TLS checks or change the expected checksums to bypass a failed download. The generated `models/` directory is setup output, not an audio library.

In Isai's clip dialog, enter `http://127.0.0.1:8000` as the transcription service URL when testing on the same computer. This loopback address does not reach the computer from an iPhone. For an iPhone or a GitHub Pages site, use an accessible HTTPS service address.

Run service tests from the repository root:

```sh
service/.venv/bin/python -m pip install --cache-dir /tmp/isai-pip-cache -r service/requirements-test.txt
service/.venv/bin/python -m pytest service -q
```

## API flow

`GET /health` checks whether the service is available. Submit one file using multipart form data:

```sh
curl -f -X POST http://127.0.0.1:8000/v1/transcriptions \
  -F file=@/path/to/piano.wav \
  -F start_seconds=0 \
  -F end_seconds=20
```

The response contains a job `id` and status. Poll `GET /v1/transcriptions/{id}` until the status is `completed` or `failed`. Completed results contain timed `notes`, any `chords` suggestions, the selected duration, `sourceStart`, and `warnings`. Note start/end times are relative to the selected passage, not the start of the original file. `DELETE /v1/transcriptions/{id}` removes a job or requests cancellation.

The app uploads to the configured service only when the user starts transcription. Audio files are temporary and are deleted after processing or cancellation; completed note results expire. A server restart discards queued jobs and results. The service does not store a permanent song library or synchronise Isai's device-local clips.

## Container deployment

The Docker build installs FFmpeg and Python dependencies and prepares the verified model. It needs standard Debian and Python package registries and the official model package download during the build. The running container needs no outbound AI connection.

From the repository root:

```sh
docker build -t isai-transcriber ./service
docker run --rm -p 8000:8000 \
  -e ISAI_ALLOWED_ORIGINS=https://rbragadesh.github.io \
  isai-transcriber
```

In a managed cloud environment that supplies a private proxy CA, pass that existing CA file as an optional BuildKit secret:

```sh
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -t isai-transcriber ./service
```

The two HTTPS download steps combine that CA with the image's normal trust bundle in a temporary file. The secret and temporary bundle are not copied into the final image or installed as permanent trust. TLS verification stays enabled. If the environment does not provide `CODEX_PROXY_CERT`, use the ordinary build command instead; do not create a secret value or disable verification.

Use a container host or your own server that can expose port `8000` through HTTPS. Start with 2 CPU cores and 2 GB of RAM, then measure real file workloads and adjust. This recommendation is a deployment starting point, not a benchmark or a claim that a particular hosting plan is available.

Set `ISAI_ALLOWED_ORIGINS` to the exact browser origins allowed to call the API, separated by commas. The GitHub Pages origin is `https://rbragadesh.github.io`, with no repository path or trailing slash. If you later use a custom frontend domain, add that exact origin. The development defaults allow only the two local Vite origins shown above. CORS settings are public configuration, not secrets.

After deployment:

1. Verify the public HTTPS `/health` response.
2. Open the Pages app and set its transcription service URL to the deployed HTTPS origin or configured API base path.
3. Upload a short piano recording, wait for the result, check the notes, and save it to a clip.
4. Test the flow on the iPhone in Safari before adding the app to the Home Screen.

## Operating limits

This small service uses one processing worker, a bounded queue, short excerpts, upload limits, and expiring results. Do not start multiple Uvicorn workers: each would create a separate queue and polling requests could reach a worker that does not know the job. Horizontal replicas need a shared queue and result store before they can be used safely.

Keep it behind an HTTPS proxy. Configure that proxy to reject request bodies above the service's 25 MiB file limit plus small multipart overhead, limit request rates, and set an appropriate request timeout. The service also bounds total upload bodies before parsing, times out slow uploads, caps concurrent uploads, and limits uploads per peer address. Only one transcription runs at once, with up to three other jobs queued. Excerpts are limited to 60 seconds, decoding has a timeout, and job metadata expires approximately 15 minutes after processing. Cancelled work retains its processing slot until the underlying work finishes.

CORS is browser access control; it does not authenticate non-browser callers or prevent others from consuming a public endpoint. For a personal deployment, restrict network access or add authentication and per-user limits before advertising it publicly. Do not put a secret bearer key in the GitHub Pages JavaScript: shipped frontend code is readable by visitors.

Avoid logging request bodies, uploaded audio, or full local filenames. Temporary files and note results may still be accessible to the server operator while processing. Keep the service's temporary storage ephemeral and do not add user audio to container images or repository commits.
