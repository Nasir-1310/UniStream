# Run the backend on a Linux VM (Azure for Students)

The API runs in Docker behind Caddy, which serves HTTPS with a free Let's
Encrypt certificate. Any Ubuntu VM with ports 22, 80 and 443 open works.

## Layout on the VM

| Path | What |
|---|---|
| `/opt/unistream/src` | this repository (branch `ccr-83b3074e-h4txdu`) |
| `/opt/unistream/app.env` | settings and secrets, `chmod 600` (same names as on Render) |
| `/opt/unistream/domain` | the HTTPS host name, e.g. `unistream-api.indiasouthcentral.cloudapp.azure.com` |

## Update to the latest code

```sh
ssh -i ~/.ssh/unistream-key.pem azureuser@<vm-ip> /opt/unistream/src/deploy/vm/deploy.sh
```

## Useful commands (on the VM)

```sh
cd /opt/unistream/src
docker compose -f deploy/vm/compose.yml -p unistream logs -f api     # API logs
docker compose -f deploy/vm/compose.yml -p unistream restart api     # after editing app.env
```

## Settings for a 1 GB VM

`MAX_CONCURRENT_DOWNLOADS=2` and `YOUTUBE_ANALYSIS_SLOTS=1` keep memory in
check (2 GB swap is configured as well); raise them on a bigger VM.
