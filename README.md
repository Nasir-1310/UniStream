# UniStream Saver

> A video downloader for university students: **YouTube · Facebook · Instagram**.
> Access is approved by an admin, every account has a password and a fair daily
> download limit, and the admin panel shows who downloaded what.

---

## What it does

- **Request access → approval → password by email.** Students request access with
  their name, email and phone number. When the admin approves them, a temporary
  password is generated and emailed automatically.
- **Sign in with email or phone** (Bangladeshi numbers in any common format:
  `017XXXXXXXX`, `8801…`, `+880 17…`) plus the password. Users change their
  password on the Account page and can reset a forgotten one by email.
- **Daily download limit** (4 videos/day by default). The admin can change the
  default or give one user a custom or unlimited limit. Only completed downloads
  count, and the count resets at midnight Bangladesh time. Unlimited accounts
  (`daily_limit = -1`) are ready for a future paid plan.
- **Multi-resolution downloads** (up to 4K where available, MP3 audio) with live
  progress.
- **Admin dashboard**: overview with stats and a 14-day chart; users (search,
  filters, bulk approve/block/delete, edit, limits, send a new password, reset
  today's usage); download logs (filters, delete one, delete selected, purge old
  logs, CSV export); settings (default limit, email status and a test email);
  system (database status with the upgrade script, storage and YouTube checks).

---

## Project structure

```
UniStream/
├── backend/                     FastAPI + yt-dlp (Render)
│   ├── main.py                  App, CORS, error handlers, /video-info
│   ├── dependencies.py          Session/admin guards, quotas, download slots
│   ├── routers/
│   │   ├── auth.py              /auth/*  register, login, reset, change password
│   │   ├── admin.py             /admin/* dashboard, users, logs, settings
│   │   └── download.py          /download/progress (SSE) and /download/file
│   ├── security.py              Validation, password hashing, tokens, rate limits
│   ├── email_service.py         Brevo / Resend / SMTP emails
│   ├── storage.py               Supabase (production) or SQLite (local)
│   ├── yt_dlp_config.py         YouTube extraction strategy
│   ├── sql/migration_v2.sql     Copy of the upgrade script the admin panel shows
│   └── tests/                   Unit and end-to-end tests (offline)
├── frontend/                    Next.js + Tailwind (Vercel)
├── supabase_schema.sql          Full schema for a NEW Supabase project
├── supabase_migration_v2.sql    Upgrade for an EXISTING (v1) project
└── render.yaml                  Render blueprint
```

---

## How accounts, passwords and limits work

| Step | What happens |
|---|---|
| Request access | The account is created as **pending**. Duplicate emails or phone numbers are refused. |
| Admin approves | Status becomes **approved**, a temporary password like `Kx7m-Pq4t-Zr9w` is generated and emailed with sign-in instructions. If the email cannot be sent (or the account has no email), the admin panel shows the password once so it can be shared by hand. |
| First sign-in | The user is reminded to replace the temporary password on the Account page. |
| Forgot password | A reset link valid for 60 minutes is emailed, but only to approved accounts. The page always shows the same message, so nobody can find out which emails are registered. Each link works once. |
| Password change | Every password change, including a reset or a new password sent by the admin, signs out all other devices. |
| Blocked | A blocked user is signed out at once and cannot sign in. |

**Daily limits:** the `default_daily_limit` setting applies to every account
whose limit is *Default*. Per user the admin can choose *Default*, a custom
number from 0 to 10000, or *Unlimited*. A download counts when it completes;
analysing a video is free but limited to 40 per hour per user. Each account
can run 2 downloads at once, and in-progress downloads are reserved against the
limit, so starting several at once never goes over it.

### The admin account

The dashboard at `/admin` has one admin account with a username and password,
stored in the database (`app_settings`: `admin_username` and an scrypt
`admin_password_hash`; no extra table).

| Situation | How to sign in |
|---|---|
| **First sign-in** (no admin password saved yet) | Username `admin` (or `ADMIN_USERNAME`) and your `ADMIN_SECRET` as the password (or `ADMIN_PASSWORD`, if you set it). The dashboard then asks you to choose your own username and password before anything else. |
| **Database not upgraded yet** | The same first sign-in works, so you can open **System**, copy the upgrade SQL and run it. Saving your own password works once the upgrade has run. |
| **Normal use** | Your own username and password. "Keep me signed in on this device" keeps you signed in for 7 days instead of 12 hours. Changing the password signs out every other admin session. |
| **Forgot the admin password** | Set `ADMIN_RESET_PASSWORD=true` on Render and redeploy. Sign in with username `admin` (or your current username) and `ADMIN_SECRET` / `ADMIN_PASSWORD`, choose a new password, then **remove `ADMIN_RESET_PASSWORD`** from Render. The dashboard shows a warning while it is set. |
| **Scripts** | Send `x-admin-secret: <ADMIN_SECRET>` with any `/admin/*` request. It works as an API key regardless of the dashboard password, so keep `ADMIN_SECRET` long, random and private. |

**Rate limits** (per server process, in memory):

| Action | Limit |
|---|---|
| Request access | 20 per hour per IP |
| Sign in | 30 failed attempts per 15 min per IP; 10 attempts per 15 min per email/phone (also for addresses with no account, so a lockout reveals nothing) |
| Forgot password | 10 per hour per IP; 3 emails per hour per address (further requests get the same answer, but no email) |
| Reset password | 20 attempts per 15 min per IP |
| Change password | 5 attempts per 15 min per user |
| Analyse a video | 40 per hour per user |
| Start a download (ticket) | 30 per hour per user |
| All sign-in style requests (`POST /auth/*`, admin sign-in) | 300 per 15 min per IP |
| Admin sign-in | 5 failed attempts per 15 min per IP; 5 attempts per 15 min per username |
| Admin change password | 5 wrong current passwords per 15 min |
| Admin API key (`x-admin-secret`) | 10 different wrong keys per 15 min per IP |

The per-IP limits are generous on purpose: a whole campus Wi-Fi or a mobile
carrier can share one public IP, so they only stop floods. The per-account
sign-in limit is what stops password guessing. The client IP is read from the
first `X-Forwarded-For` entry; Vercel's `/api` rewrite and Render both pass
the visitor's IP there. If you add another proxy in front, make sure it
forwards that header too, otherwise every visitor shares one limit. If a class
still hits the sign-up limit, add the users from **Admin → Users → Add user**.

Run the API with a **single worker** (the default start command): limits and
download reservations are kept in memory.

---

## Deployment

### Step 1 — Supabase database (free)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query** and run:
   - **New project:** `supabase_schema.sql`
   - **Existing v1 project (already has users/logs):** `supabase_migration_v2.sql`.
     It keeps all users and logs, fills in email and phone from old
     identifiers, and is safe to run again. Until it has run, the admin panel
     shows **Database upgrade required** together with the script and a copy
     button.
3. From **Settings → API** copy the `Project URL` (`SUPABASE_URL`) and the
   `service_role` secret (`SUPABASE_SERVICE_KEY`). Row Level Security is on with
   no policies, so only the backend (service role) can read the tables.

### Step 2 — Email with Brevo (free, recommended)

Render's free instances block outgoing SMTP ports, so the backend sends email
through an HTTP API. Brevo's free plan sends **300 emails per day** from a
verified single sender, and no domain is needed.

1. Create an account at [brevo.com](https://www.brevo.com).
2. **Senders, domains & dedicated IPs → Senders → Add a sender**: enter the
   address the emails should come from (e.g. `unistream.saver@gmail.com`) and
   confirm the verification email.
3. **SMTP & API → API keys → Generate a new API key**.
4. On Render set `BREVO_API_KEY` to that key and `EMAIL_FROM` to the verified
   address (`EMAIL_FROM_NAME` defaults to "UniStream Saver").
5. In the admin panel open **Settings → Send test email** to check delivery.
   Ask students to look in their spam folder for the first email.

Alternatives: `RESEND_API_KEY` (needs a verified domain) or SMTP (`SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`) on hosts that allow it.
`EMAIL_PROVIDER=none` turns email off: the admin panel then shows each new
password so it can be shared by hand. Bulk approvals send one email per user,
so keep within the provider's daily quota.

### Step 3 — Backend on Render (free)

Use the `render.yaml` blueprint (**New → Blueprint**) or create a Python web
service with root directory `backend`, build command
`pip install -r requirements.txt` and start command
`uvicorn main:app --host 0.0.0.0 --port $PORT`.

| Key | Secret? | Value |
|---|---|---|
| `SUPABASE_URL` | no | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | **yes** | the `service_role` key |
| `ADMIN_SECRET` | **yes** | a long random value (32+ characters). It is the password for your first admin sign-in (username `admin`) and, for scripts, an API key in the `x-admin-secret` header. |
| `ADMIN_USERNAME` | no | optional: the admin username before you choose your own (default `admin`) |
| `ADMIN_PASSWORD` | **yes** | optional: a first-sign-in password other than `ADMIN_SECRET`. Remove it once you have chosen your own password. |
| `ADMIN_RESET_PASSWORD` | no | only to recover a forgotten admin password: `true` lets `ADMIN_SECRET` / `ADMIN_PASSWORD` sign in again. Remove it after choosing a new password. |
| `AUTH_SECRET` | **yes** | 32+ random characters that sign sessions, reset links, admin sessions and download tickets (the blueprint generates one). If it is missing, a key derived from `ADMIN_SECRET` and `SUPABASE_SERVICE_KEY` is used, and changing either one then signs everyone out. |
| `FRONTEND_URL` | no | `https://your-app.vercel.app` (used in email links and for CORS; separate several with commas) |
| `APP_TIMEZONE` | no | `Asia/Dhaka` (when daily limits reset) |
| `EMAIL_PROVIDER` | no | `auto` (or `brevo`, `resend`, `smtp`, `none`) |
| `BREVO_API_KEY` / `RESEND_API_KEY` / `SMTP_PASSWORD` | **yes** | see Step 2 |
| `EMAIL_FROM`, `EMAIL_FROM_NAME`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL` | no | see Step 2 |
| `YOUTUBE_COOKIES_BASE64` | **yes** | optional, see below |
| `YOUTUBE_PROXY` | **yes** (may contain a password) | optional, see below |
| `YOUTUBE_USER_AGENT` | no | optional, see below |
| `MAX_CONCURRENT_DOWNLOADS` | no | `5` (server-wide) |

None of these values is ever sent to the browser: the admin panel only shows
whether each one is set.

> Render's free tier sleeps after 15 idle minutes, and the first request then
> takes 30–60 seconds. See *Keeping analysis fast* below.

#### YouTube authentication on Render

YouTube may challenge Render's data-centre IP with "Sign in to confirm you're
not a bot". Use a separate/throwaway YouTube account, export only its
`youtube.com` cookies in Netscape `cookies.txt` format, and keep that file
secret.

1. Open a private/incognito browser window and sign in to YouTube.
2. Export the `youtube.com` cookies as a Netscape-format `cookies.txt`, then
   close that private window so YouTube does not rotate the exported session.
3. On Windows PowerShell, copy the file as base64:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt")) | Set-Clipboard
   ```

4. In the Render backend service, add secret environment variable
   `YOUTUBE_COOKIES_BASE64` and paste the copied value.
5. Optionally set `YOUTUBE_USER_AGENT` to the exact User-Agent of the browser
   used for the export, then redeploy the backend.

For local development, save the export as `backend/youtube-cookies.txt`, set a
different path with `YOUTUBE_COOKIES_FILE`, or opt in to browser extraction with
`YOUTUBE_COOKIES_BROWSER=chrome` (Firefox is also supported). Never commit the
cookie file or its base64 value.

The backend asks YouTube three ways at once and lists the best answer:
without cookies (works on home connections), signed in through the Safari
watch page (HLS up to 1080p, and the one route that avoids YouTube's player
API), and signed in through the player API (full DASH ladder where YouTube
allows it). The download page explains any 360p-only result, and the admin
panel's **Run YouTube check** shows what each route returns from the server.

#### Keeping analysis fast

Render's free plan puts the API to sleep after 15 idle minutes; the next
request then waits about a minute for it to start, and the start also empties
yt-dlp's caches. Keep it awake with a free uptime monitor (e.g. UptimeRobot or
cron-job.org) that requests the API's `/` URL every 10 minutes; one service
running all month stays within the free plan's 750 hours.

Within a running server, analysing a video again (including another share
link of it) is answered from a 20-minute cache, later videos try only the
route that last worked, and a download reuses its analysis instead of
extracting the video a second time. Each analysis logs its timings
(`Video info in ...s`) and sends them in a `Server-Timing` header.

#### When YouTube blocks the server's IP

YouTube answers Render's data-centre IPs with `HTTP Error 403` on its player
API, and may refuse them entirely. If the YouTube check lists no heights for
`web_safari_watch_page`, either run the backend on your own computer
(`start.bat`), or route YouTube through a residential proxy:

- Set `YOUTUBE_PROXY` on Render, e.g. `http://user:pass@host:port`.
- Use a **sticky session** (one exit IP for minutes, usually a session id in
  the proxy username). YouTube's stream links are bound to the IP that
  requested them, and yt-dlp opens a new connection per request, so a proxy
  that rotates its IP per request makes every stream fail with HTTP 403.

### Step 4 — Frontend on Vercel (free)

1. Import the repository at [vercel.com](https://vercel.com) with root
   directory `frontend`.
2. Set `NEXT_PUBLIC_API_URL` to the Render URL, e.g.
   `https://unistream-api.onrender.com`.
3. Deploy, then put the Vercel URL into Render's `FRONTEND_URL` so email links
   and CORS point at it.

### Step 5 — First launch checklist

1. Open `/admin` and sign in with username `admin` and your `ADMIN_SECRET`.
   If the database still needs its upgrade, run the SQL shown under **System**
   first. Then choose your own admin username and password when asked.
2. **Overview → system warnings** must be clear: database ready, email
   configured, `AUTH_SECRET` set.
3. **Settings → Send test email** to your own address.
4. Set the default daily limit (4 by default).
5. Request access from the landing page with a test account, approve it, and
   sign in with the emailed password.

---

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing page: sign in or request access, how it works, FAQ |
| `/download` | Paste a link, choose a quality, download with live progress |
| `/account` | Profile, today's usage, change password |
| `/forgot-password`, `/reset-password` | Reset a forgotten password by email |
| `/terms`, `/privacy` | Terms of use and privacy policy |
| `/admin` | Admin dashboard (admin username and password) |

---

## API

All error bodies are `{"detail": "<message>"}`, ready to show to the user.
User endpoints take `Authorization: Bearer <session token>`. Admin endpoints
take `Authorization: Bearer <admin token>` from `/admin/auth/login`, or the
`x-admin-secret: <ADMIN_SECRET>` API key.

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/register` | Request access (`name`, `email`, `phone`, `note?`) |
| `POST` | `/auth/login` | Sign in with `login` (email or phone) and `password` → session token |
| `POST` | `/auth/forgot-password` | Email a reset link (same answer for every address) |
| `POST` | `/auth/reset-password` | Set a new password with the emailed token and sign in |
| `GET` | `/auth/me` | Current user and today's usage |
| `POST` | `/auth/change-password` | Change password (signs out other devices) |
| `POST` | `/video-info` | List a video's formats (YouTube, Facebook, Instagram only) |
| `POST` | `/download/ticket` | Step 1 of a download (`url`, `format_id`, `ext`, `height?`, `source?`): checks the link and today's limit and returns `{"ticket", "expires_in": 60}`, a single-use ticket |
| `GET` | `/download/progress?ticket=` | SSE download progress; refusals arrive as an `error` event with `code` = `auth`, `limit`, `platform` or `busy` |
| `GET` | `/download/file` | Fetch the finished file once (one-time token) |
| `POST` | `/admin/auth/login` | Admin sign-in (`username`, `password`, `remember?`) → `{"token", "username", "must_change_password", "expires_at"}` |
| `GET` | `/admin/auth/me` | Signed-in admin, whether a new password is required, recovery mode |
| `POST` | `/admin/auth/change-credentials` | New admin password (and optionally username); other admin sessions end |
| `GET` | `/admin/overview` | Counters, 14-day chart, platform split, system status |
| `GET`/`POST` | `/admin/users` | List (search, filter, sort, paginate) / add a user |
| `PATCH`/`DELETE` | `/admin/users/{id}` | Edit (name, email, phone, note, daily limit) / delete |
| `POST` | `/admin/users/{id}/approve` | Approve and email a temporary password |
| `POST` | `/admin/users/{id}/status` | Set approved / pending / blocked |
| `POST` | `/admin/users/{id}/send-password` | Email a new temporary password |
| `POST` | `/admin/users/{id}/reset-usage` | Give back today's downloads |
| `POST` | `/admin/users/bulk` | Approve, block, set pending or delete up to 200 users |
| `GET` | `/admin/logs` | Download logs (search, platform, user, date range) |
| `DELETE` | `/admin/logs/{id}` | Delete one log |
| `POST` | `/admin/logs/delete` | Delete up to 500 selected logs |
| `POST` | `/admin/logs/purge` | Delete logs older than N days, before a date, or all |
| `GET` | `/admin/logs/export` | CSV export (Excel-ready, up to 50,000 rows) |
| `GET`/`PUT` | `/admin/settings` | Default daily limit, email and security status |
| `POST` | `/admin/email/test` | Send a test email |
| `GET` | `/admin/schema` | Database status and the upgrade script |
| `GET` | `/admin/storage`, `/admin/youtube-check` | Diagnostics |

Interactive docs: `http://localhost:8000/docs`.

---

## Security

- Passwords (users and admin) are hashed with scrypt; plain passwords are
  never stored or logged. The admin sees a user's password only when its email
  could not be sent.
- Sessions, reset links, admin sessions and download tickets are HMAC-SHA256
  signed with `AUTH_SECRET`, checked in constant time, expire, and carry a
  purpose, so one kind can never be used as another. Each is tied to the
  current password: any password change (or reset, or new password from the
  admin) ends every older session, and each reset link works once. User
  sessions last 30 days; admin sessions 12 hours (7 days with "Keep me signed
  in").
- No long-lived token ever appears in a URL. Sessions travel only in the
  `Authorization` header. The download stream, which a browser opens without
  headers, uses a ticket from `POST /download/ticket` instead: valid for 60
  seconds, usable once, and only for the one download it names. The finished
  file is fetched once with a random 5-minute token. Both are also blanked in
  the server's access log.
- Sign-in answers the same for unknown accounts and wrong passwords (and takes
  the same time); lockouts look the same whether or not the account exists;
  forgot-password never reveals whether an email is registered.
- Every `/admin` route requires an admin (a test checks each one); nothing is
  deleted by a `GET`.
- Links must be `http(s)` and the host must be YouTube, Facebook or Instagram,
  checked on the parsed host name: credentials before the host
  (`https://youtube.com@evil.example`), backslashes, IP addresses, unusual
  ports and encoded host names are refused. This also keeps the server from
  being pointed at other hosts through yt-dlp.
- Every request field has a maximum length (name 80, email 254, phone 20,
  note 300, link 2048, passwords 128, ids 64, lists bounded), unknown fields
  are refused, and request bodies over 1 MB are rejected.
- Responses carry `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. CORS allows
  only `FRONTEND_URL` (and `http://localhost:3000`), without credentials.
- Unexpected errors answer with a generic message; details go to the server
  log only.
- Emails go to one validated address; subjects cannot add headers, and every
  value in an email is HTML-escaped.
- Supabase Row Level Security is enabled with no policies: only the backend's
  service key can read or write.
- CSV exports neutralise cells that spreadsheet apps would run as formulas
  (starting with `=`, `+`, `-`, `@`, tab or carriage return).

---

## Local development

```bash
# Backend (Python 3.12)
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cat > .env <<'EOF'
STORAGE_BACKEND=sqlite
ADMIN_SECRET=local-admin-secret
AUTH_SECRET=change-me-to-32-or-more-random-characters
EMAIL_PROVIDER=none
EOF
uvicorn main:app --reload
# Admin dashboard: http://localhost:3000/admin, username "admin",
# password "local-admin-secret", then choose your own.

# Tests (offline: email and yt-dlp are faked)
for t in tests/test_*.py; do PYTHONPATH=. python $t || echo FAIL $t; done

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

- App: http://localhost:3000, API docs: http://localhost:8000/docs
- With `STORAGE_BACKEND=sqlite` the data lives in `backend/unistream_local.sqlite3`
  (upgraded in place automatically). With `EMAIL_PROVIDER=none`, approvals show
  the temporary password in the admin panel instead of emailing it.
- On Windows, `start.bat` starts both servers.

---

## Roadmap

- [ ] Premium plan with unlimited downloads (accounts already support `daily_limit = -1`)
- [ ] Facebook closed groups / Instagram private videos (cookie support)
- [ ] More platforms once demand is clear
