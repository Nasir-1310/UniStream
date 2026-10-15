# Run the backend on a Linux VM (Azure for Students)

The API runs in Docker behind Caddy, which serves HTTPS with a free Let's
Encrypt certificate. Any Ubuntu VM with ports 22, 80 and 443 open works.

## Layout on the VM

| Path | What |
|---|---|
| `/opt/unistream/src` | this repository (branch `ccr-83b3074e-h4txdu`) |
| `/opt/unistream/app.env` | settings and secrets, `chmod 600` (same names as on Render) |
| `/opt/unistream/domain` | the HTTPS host name(s), e.g. `unistream-api.indiasouthcentral.cloudapp.azure.com`; several names separated by spaces all get a certificate |

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

Measured on Standard_B2ats_v2 (2 vCPU, 1 GB RAM, 2 GB swap):

- `YOUTUBE_ANALYSIS_SLOTS=1`: one YouTube lookup takes ~7 s and both vCPUs.
  Two at once were only ~25% faster overall and pushed ~190 MB into swap;
  three at once were slower than one by one and swapped ~680 MB.
- `MAX_CONCURRENT_DOWNLOADS=3`: downloads reuse the analysed info, so they
  are light on memory (3 at once, 4K + 2 × 1080p, peaked at ~150 MB) but use
  the CPU fully (the WARP tunnel). More slots would not add throughput.

Raise both on a VM with more RAM and vCPUs.
