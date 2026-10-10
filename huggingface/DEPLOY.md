# Run the backend on Hugging Face Spaces

Render's free plan includes only 5 GB of bandwidth a month, which a video
downloader uses up in days. A free Hugging Face Docker Space (2 vCPU, 16 GB
RAM) runs the same backend. The Space holds just `Dockerfile` and
`README.md` from this folder; the image clones the backend from GitHub.

> Hugging Face may disable Spaces it considers against its content policy,
> and downloading videos from other sites is a grey area. Keep Render (or a
> VPS) ready as a fallback.

## 1. Create the Space

1. Sign up at <https://huggingface.co/join> (no card needed).
2. <https://huggingface.co/new-space>: any name (e.g. `unistream-api`),
   **SDK: Docker → Blank**, hardware **CPU basic (free)**, visibility
   **Public** (the browser must reach it without a Hugging Face login; only
   the build recipe is visible, never your secrets).
3. In the Space's **Files** tab: **Add file → Upload files**, upload
   `huggingface/Dockerfile` and `huggingface/README.md` from this repository
   (replace the README the Space created), and commit.

## 2. Secrets and variables (Space → Settings)

Copy the values from Render → your service → Environment. Use **New secret**
for anything private and **New variable** for the rest.

| Name | Type | Value |
|---|---|---|
| `SUPABASE_URL` | secret | same as Render |
| `SUPABASE_SERVICE_KEY` | secret | same as Render |
| `ADMIN_SECRET` | secret | same as Render |
| `AUTH_SECRET` | secret | **same as Render** (a new value signs everyone out) |
| `FRONTEND_URL` | variable | `https://uni-stream-saver.vercel.app` |
| `APP_TIMEZONE` | variable | `Asia/Dhaka` |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | variable | same as Render |
| `BREVO_API_KEY` (or `RESEND_API_KEY`) | secret | same as Render |
| `YOUTUBE_COOKIES_BASE64` | secret | same as Render |
| `INSTAGRAM_COOKIES_BASE64`, `FACEBOOK_COOKIES_BASE64` | secret | only if set on Render |
| `YOUTUBE_WARP` | variable | `true` |
| `MAX_CONCURRENT_DOWNLOADS` | variable | `6` (16 GB RAM allows more than Render's 3) |
| `YOUTUBE_ANALYSIS_SLOTS` | variable | `2` |

Saving secrets restarts the Space. The build log is under **Logs → Build**.
When it is running, open `https://<your-name>-<space-name>.hf.space/`; it
answers `{"status":"ok", …, "commit": "…"}`.

## 3. Point the website at it

Vercel → the frontend project → Settings → Environment Variables: set
`API_URL` (and `NEXT_PUBLIC_API_URL` if present) to the Space URL, e.g.
`https://nasir-unistream-api.hf.space`, then **Deployments → Redeploy**.
The URL is built into the page and its security policy, so a redeploy is
required.

## 4. Check

- Admin → System: database connected, "YouTube proxy: Cloudflare WARP
  (ready)". If WARP shows "failed", the Space may block the UDP traffic
  WireGuard needs; YouTube then works through the cookies only.
- Admin → System → Download check with a YouTube, Facebook and Instagram link.
- Sign in as a normal user and download a video.

## Updating

Push to the branch in the Dockerfile (`ccr-83b3074e-h4txdu`), then on the
Space: **Settings → Factory rebuild** (or just restart it). Once everything
runs on Hugging Face, suspend the Render service so it stops using bandwidth.
