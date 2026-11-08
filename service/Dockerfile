# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=2

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin isai

WORKDIR /app
COPY requirements.txt requirements-api.txt ./
RUN --mount=type=secret,id=proxy_ca \
    set -eu; \
    task_ca_bundle=""; \
    if [ -f /run/secrets/proxy_ca ]; then \
      task_ca_bundle="$(mktemp)"; \
      trap 'rm -f "$task_ca_bundle"' EXIT; \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/proxy_ca > "$task_ca_bundle"; \
      export PIP_CERT="$task_ca_bundle" SSL_CERT_FILE="$task_ca_bundle"; \
    fi; \
    pip install --no-cache-dir -r requirements-api.txt
COPY --chmod=644 engine.py app.py ./
RUN --mount=type=secret,id=proxy_ca \
    set -eu; \
    task_ca_bundle=""; \
    if [ -f /run/secrets/proxy_ca ]; then \
      task_ca_bundle="$(mktemp)"; \
      trap 'rm -f "$task_ca_bundle"' EXIT; \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/proxy_ca > "$task_ca_bundle"; \
      export PIP_CERT="$task_ca_bundle" SSL_CERT_FILE="$task_ca_bundle"; \
    fi; \
    python engine.py --download-model \
    && chmod -R a=rX /app/models

USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)" || exit 1

# Keep one worker: this service owns one bounded, in-memory job queue.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
