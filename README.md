# 🎬 UniStream Saver

> University Students Video Downloader — YouTube, Facebook, Instagram, TikTok  
> Controlled Access · Multi-Resolution · Admin Panel

---

## 📁 Project Structure



```
unistream/
├── backend/                    ← FastAPI + yt-dlp (Render-এ হোস্ট)
│   ├── main.py                 ← সব API endpoints
│   ├── requirements.txt
│   ├── render.yaml             ← Render deployment config
│   └── .env.example
│
├── frontend/                   ← Next.js + Tailwind (Vercel-এ হোস্ট)
│   ├── app/
│   │   ├── page.tsx            ← Landing + Access Check
│   │   ├── download/page.tsx   ← Main Downloader UI
│   │   └── admin/page.tsx      ← Admin Panel
│   ├── lib/api.ts              ← Backend API calls
│   └── .env.example
│
└── supabase_schema.sql         ← Database setup (একবারই রান করতে হবে)
```

---
---

## 🚀 Deployment Guide

### Step 1 — Supabase Database Setup (FREE)

1. [supabase.com](https://supabase.com) → **New Project** তৈরি করুন
2. **SQL Editor → New Query** → `supabase_schema.sql` পেস্ট করুন → **Run**
3. **Settings → API** থেকে নিন:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret key → `SUPABASE_SERVICE_KEY`

---

### Step 2 — Backend Deploy on Render (FREE)

1. [render.com](https://render.com) → GitHub দিয়ে সাইন আপ
2. GitHub রেপো তৈরি করুন, `backend/` ফোল্ডার পুশ করুন
3. **New Web Service** → রেপো সিলেক্ট করুন
4. Settings:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Environment Variables:

   | Key | Value |
   |-----|-------|
   | `SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | `eyJhbGciOi...` |
   | `ADMIN_SECRET` | যেকোনো কঠিন পাসওয়ার্ড |
   | `FRONTEND_URL` | `https://your-app.vercel.app` (পরে আপডেট করুন) |

6. **Deploy** → URL পাবেন: `https://your-api.onrender.com`

> ⚠️ Render ফ্রি টিয়ারে 15 মিনিট inactive থাকলে সার্ভার স্লিপ করে। প্রথম রিকোয়েস্টে 30–60 সেকেন্ড লাগতে পারে।

---

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

For local development, either set `YOUTUBE_COOKIES_FILE=cookies.txt` in
`backend/.env`, or opt in to browser extraction with
`YOUTUBE_COOKIES_BROWSER=chrome` (Firefox is also supported). Never commit the
cookie file or its base64 value.

---

### Step 3 — Frontend Deploy on Vercel (FREE)

1. `frontend/` ফোল্ডার GitHub রেপোতে পুশ করুন
2. [vercel.com](https://vercel.com) → **New Project** → রেপো ইম্পোর্ট করুন
3. Environment Variable:

   | Key | Value |
   |-----|-------|
   | `NEXT_PUBLIC_API_URL` | `https://your-api.onrender.com` |

4. **Deploy** → URL পাবেন: `https://your-app.vercel.app`
5. এই URL দিয়ে Render-এর `FRONTEND_URL` আপডেট করুন

---

## 🖥️ Pages

| Route | বিবরণ |
|-------|--------|
| `/` | Landing page + Access Check (Gmail/Phone input) |
| `/download` | Main downloader — URL paste → Format selection |
| `/admin` | Admin panel (secret key দিয়ে লগইন) |

---

## 🔑 Admin Panel

1. `/admin` এ যান
2. `ADMIN_SECRET` দিয়ে লগইন করুন
3. **নতুন স্টুডেন্ট অ্যাড:** Gmail বা phone + নোট (যেমন: "CSE B24") দিয়ে অ্যাপ্রুভ করুন
4. **ইউজার ম্যানেজ:** ✓ Approve / ✗ Block / 🗑️ Delete
5. **ডাউনলোড লগ:** কে কোন ভিডিও ডাউনলোড করেছে দেখুন

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/check-access` | Gmail/phone অ্যাক্সেস চেক |
| `POST` | `/video-info` | ভিডিওর সব রেজোলিউশন ডিটেক্ট |
| `GET` | `/download` | ডাইরেক্ট ডাউনলোড URL |
| `GET` | `/admin/users` | সব ইউজার লিস্ট *(Admin only)* |
| `POST` | `/admin/users` | নতুন ইউজার অ্যাড/অ্যাপ্রুভ *(Admin only)* |
| `PATCH` | `/admin/users/status` | স্ট্যাটাস আপডেট *(Admin only)* |
| `DELETE` | `/admin/users/{id}` | ইউজার ডিলিট *(Admin only)* |
| `GET` | `/admin/logs` | ডাউনলোড লগ *(Admin only)* |

---

## ✅ Features (Phase 1 Complete)

- Gmail / Phone নম্বর দিয়ে অ্যাক্সেস চেক
- Auto-save pending users (যারা try করেছে)
- Multi-resolution detection: 1080p, 720p, 480p, 360p, MP3
- File size display
- Download logging (কে কখন কোনটা নামিয়েছে)
- Admin panel: Add, Approve, Block, Delete users
- Admin download logs viewer
- Responsive UI (Mobile + Desktop)
- Dark theme
- PWA manifest

---

## 🔒 Security

- Admin endpoints → `X-Admin-Secret` header required
- `yt-dlp` runs server-side — client কখনো raw API key দেখতে পায় না
- Supabase RLS enabled — direct public DB access বন্ধ
- Session stored in `sessionStorage` (tab close করলে expire)

---

## ⚡ Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env        # Fill in your values
uvicorn main:app --reload

# Frontend (নতুন terminal)
cd frontend
npm install
cp .env.example .env.local  # Fill in your values
npm run dev
```

- App: http://localhost:3000  
- API Docs: http://localhost:8000/docs

---

## 🗺️ Phase 2 Roadmap

- [ ] Facebook closed group / Instagram private video (cookie support)
- [ ] Chrome extension for cookie extraction
- [ ] Better error messages for geo-blocked videos
