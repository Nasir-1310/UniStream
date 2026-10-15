# UniStream Downloader API image (built from this folder).
# Used by deploy/vm (docker compose behind Caddy); any Docker host works.

FROM python:3.12-slim

# ffmpeg (with ffprobe) merges video and audio and makes MP3s.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# Shown by GET / and the admin page (see version.py).
ARG COMMIT=local
RUN echo "$COMMIT" > .commit

RUN useradd -m -u 1000 app && chown -R app /app
USER app
ENV PYTHONUNBUFFERED=1 PORT=8000
EXPOSE 8000
# One worker: rate limits, download slots and the download queue live in memory.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --timeout-keep-alive 75"]
