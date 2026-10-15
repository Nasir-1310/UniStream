#!/usr/bin/env bash
# Update and (re)start the API on the VM: pull the latest code of the
# checked-out branch, rebuild the image and restart the containers.
#
#   /opt/unistream/src/deploy/vm/deploy.sh
#
# Needs /opt/unistream/app.env (settings and secrets) and
# /opt/unistream/domain (the HTTPS host name). See README.md.
set -euo pipefail

cd "$(dirname "$0")/../.."
git pull --ff-only

export COMMIT
COMMIT="$(git rev-parse HEAD)"
# One or more host names, separated by spaces, commas or new lines; Caddy
# wants them as "a.example, b.example".
export DOMAIN
DOMAIN="$(tr ',\n' '  ' < /opt/unistream/domain | xargs | sed 's/ /, /g')"

docker compose -f deploy/vm/compose.yml -p unistream up -d --build
docker image prune -f >/dev/null
docker compose -f deploy/vm/compose.yml -p unistream ps
