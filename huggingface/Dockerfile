# UniStream Saver API on a Hugging Face Docker Space.
#
# The Space holds only this file and README.md: the image builds the backend
# straight from the public GitHub repository, so every push to BRANCH is
# picked up by "Restart / Factory rebuild" on the Space (the ADD below changes
# whenever the branch's commit does, which invalidates the cached clone).
#
# Configure the Space's secrets/variables like the Render service (see
# huggingface/DEPLOY.md). Hugging Face routes traffic to port 7860.

FROM python:3.12-slim

# ffmpeg (with ffprobe) merges video and audio and makes MP3s; git clones the code.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Spaces run the container as user 1000.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PORT=7860
WORKDIR /home/user

ARG REPO=Nasir-1310/UniStream
ARG BRANCH=ccr-83b3074e-h4txdu

# Changes whenever the branch moves, so the clone below is never stale.
ADD --chown=user https://api.github.com/repos/${REPO}/git/refs/heads/${BRANCH} /home/user/branch.json
RUN git clone --depth 1 --branch ${BRANCH} https://github.com/${REPO}.git app \
 && git -C app rev-parse HEAD > app/backend/.commit

WORKDIR /home/user/app/backend
RUN pip install --no-cache-dir --user -r requirements.txt

EXPOSE 7860
# One worker: rate limits, download slots and the download queue live in memory.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --timeout-keep-alive 75"]
