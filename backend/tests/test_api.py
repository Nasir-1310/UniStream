import asyncio
"""End-to-end API tests on a throwaway SQLite database.

Email delivery is replaced by a recorder (no test touches the network), and
yt-dlp by a fake that writes a small file, so every flow runs offline:
register -> approve -> sign in -> download within the daily limit -> admin.
"""

import csv
import io
import json
import logging
import os
import re
import shutil
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import yt_dlp
from fastapi.testclient import TestClient

import admin_account
import dependencies
import email_service
import main
import security
import storage
from routers import admin_auth as admin_auth_router
from routers import auth as auth_router
from routers import download as download_router


ADMIN_SECRET = "test-admin-secret-2026"
ENV = {
    "ADMIN_SECRET": ADMIN_SECRET,
    "AUTH_SECRET": "a-test-signing-secret-that-is-long-enough-1234",
    "EMAIL_PROVIDER": "brevo",
    "BREVO_API_KEY": "test-brevo-key",
    "EMAIL_FROM": "noreply@unistream.test",
    "EMAIL_FROM_NAME": "UniStream Saver",
    "FRONTEND_URL": "https://app.unistream.test",
    "APP_TIMEZONE": "Asia/Dhaka",
}
FORGOT_MESSAGE = auth_router.FORGOT_MESSAGE
INVALID_LOGIN = "Incorrect email/phone or password."
SESSION_EXPIRED = "Your session has expired. Please sign in again."
ADMIN_EXPIRED = "Admin session expired. Please sign in again."
TICKET_EXPIRED = download_router.TICKET_EXPIRED_MESSAGE
UNSUPPORTED = "Only YouTube, Facebook and Instagram links are supported."
FACEBOOK_URL = "https://www.facebook.com/watch?v=1"


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def fake_youtube_dl(*, title="Lecture", content=b"fake-media", gate=None, started=None, error=None):
    """A yt-dlp stand-in that "downloads" `content`, optionally after `gate`."""

    class FakeYoutubeDL:
        sanitize_info = staticmethod(lambda info, remove_private_keys=False: dict(info))

        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def extract_info(self, _url, download):
            if started is not None:
                started.release()
            if gate is not None and not gate.wait(20):
                raise RuntimeError("test gate never opened")
            if error is not None:
                raise error
            output = Path(self.options["outtmpl"]).parent / f"{title}.mp4"
            output.write_bytes(content)
            for hook in self.options.get("progress_hooks", []):
                hook({
                    "status": "downloading", "downloaded_bytes": len(content),
                    "total_bytes": len(content), "speed": 1024, "eta": 0,
                })
                hook({"status": "finished", "filename": str(output)})
            return {"title": title, "extractor_key": "Youtube"}

    return FakeYoutubeDL


class ApiTestCase(unittest.TestCase):
    """Fresh SQLite database, fixed secrets and a recording mailer per test."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)

        saved = {
            name: getattr(storage, name)
            for name in ("SUPABASE_CONFIGURED", "LOCAL_DB_PATH", "_local_conn")
        }

        def restore_storage():
            if storage._local_conn is not None and storage._local_conn is not saved["_local_conn"]:
                storage._local_conn.close()
            for name, value in saved.items():
                setattr(storage, name, value)
            storage._clear_caches()

        self.addCleanup(restore_storage)
        storage.SUPABASE_CONFIGURED = False
        storage.LOCAL_DB_PATH = Path(self.temp_dir.name) / "api.sqlite3"
        storage._local_conn = None
        storage._clear_caches()

        env = patch.dict(os.environ, ENV)
        env.start()
        self.addCleanup(env.stop)
        for reset in (
            security._auth_secret.cache_clear,
            security.rate_limiter.reset,
            security.used_tickets.reset,
            dependencies.download_slots.reset,
            admin_account.forget_cached_state,
        ):
            reset()
            self.addCleanup(reset)

        self.sent = []
        self.email_error = None

        def record_email(to, subject, html, text):
            if self.email_error is not None:
                raise self.email_error
            self.sent.append({"to": to, "subject": subject, "html": html, "text": text})

        for target, replacement in (
            (email_service, {"send_email": record_email}),
            # Belt and braces: nothing may reach a real provider.
            (email_service.httpx, {"post": self._no_network}),
        ):
            for attribute, value in replacement.items():
                patcher = patch.object(target, attribute, value)
                patcher.start()
                self.addCleanup(patcher.stop)

        self.addCleanup(self._drop_download_files)
        self.client = TestClient(main.app)

    @staticmethod
    def _no_network(*_args, **_kwargs):
        raise AssertionError("tests must not send real email")

    @staticmethod
    def _drop_download_files():
        for key, entry in list(download_router._jobs.items()):
            if key.startswith("token:"):
                shutil.rmtree(Path(entry["filename"]).parent, ignore_errors=True)
        download_router._jobs.clear()

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    def admin(self, method, path, **kwargs):
        headers = {"x-admin-secret": ADMIN_SECRET, **kwargs.pop("headers", {})}
        return self.client.request(method, path, headers=headers, **kwargs)

    def register(self, name="Rahim Uddin", email="rahim@example.com", phone="01712345678",
                 ip="198.51.100.1", **extra):
        body = {"name": name, "email": email, "phone": phone, **extra}
        return self.client.post("/auth/register", json=body, headers={"x-forwarded-for": ip})

    def login(self, login, password, ip="198.51.100.50"):
        return self.client.post(
            "/auth/login", json={"login": login, "password": password},
            headers={"x-forwarded-for": ip},
        )

    def user_id(self, login):
        return storage.get_user_by_login(login)["id"]

    def password_from(self, message):
        return re.search(r"Temporary password: (\S+)", message["text"]).group(1)

    def approve(self, user_id):
        response = self.admin("POST", f"/admin/users/{user_id}/approve", json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["credentials"]["emailed"])
        return self.password_from(self.sent[-1])

    def active_user(self, email="rahim@example.com", phone="01712345678", daily_limit="default"):
        """Register, approve and sign in; returns (user id, session token, password)."""
        self.assertEqual(self.register(email=email, phone=phone, ip=f"203.0.113.{len(self.sent) + 1}").status_code, 201)
        user_id = self.user_id(email)
        if daily_limit != "default":
            response = self.admin("PATCH", f"/admin/users/{user_id}", json={"daily_limit": daily_limit})
            self.assertEqual(response.status_code, 200, response.text)
        password = self.approve(user_id)
        response = self.login(email, password)
        self.assertEqual(response.status_code, 200, response.text)
        return user_id, response.json()["token"], password

    def request_ticket(self, token, url=FACEBOOK_URL, ext="mp4", height=720, client=None, **extra):
        """POST /download/ticket; returns the response."""
        body = {"url": url, "format_id": "hd", "ext": ext, "height": height, "source": None, **extra}
        headers = bearer(token) if token is not None else {}
        return (client or self.client).post("/download/ticket", json=body, headers=headers)

    def ticket(self, token, **kwargs):
        response = self.request_ticket(token, **kwargs)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body), {"ticket", "expires_in"})
        self.assertEqual(body["expires_in"], 60)
        return body["ticket"]

    def stream(self, ticket=None, client=None, params=None):
        """Run GET /download/progress to the end; returns the SSE events."""
        params = dict(params or {})
        if ticket is not None:
            params["ticket"] = ticket
        response = (client or self.client).get("/download/progress", params=params)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/event-stream"))
        return [
            json.loads(line.removeprefix("data: "))
            for line in response.text.splitlines()
            if line.startswith("data: ")
        ]

    def download(self, token, url=FACEBOOK_URL, ext="mp4", height=720, client=None):
        """Get a ticket and run the download stream to the end; returns the SSE events."""
        ticket = self.ticket(token, url=url, ext=ext, height=height, client=client)
        return self.stream(ticket, client=client)

    def admin_session(self, username="admin", password=ADMIN_SECRET, remember=False, ip="198.51.100.200"):
        """Sign in to the dashboard; returns the login response body."""
        response = self.client.post(
            "/admin/auth/login", json={"username": username, "password": password, "remember": remember},
            headers={"x-forwarded-for": ip},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def assert_refused(self, events, code):
        self.assertEqual(len(events), 1, events)
        self.assertEqual(events[0]["status"], "error")
        self.assertEqual(events[0]["code"], code)
        return events[0]["error"]

    def logs(self):
        return storage.list_download_logs(page_size=200)["items"]


class HealthAndValidationTests(ApiTestCase):
    def test_health_reports_v2(self):
        body = self.client.get("/").json()
        self.assertEqual(body["status"], "ok")
        self.assertIn("v2", body["service"])

    def test_legacy_endpoints_are_gone(self):
        self.assertEqual(self.client.post("/check-access", json={"identifier": "x@y.com"}).status_code, 404)
        self.assertEqual(
            self.client.get("/download", params={"url": FACEBOOK_URL, "format_id": "1"}).status_code, 404,
        )

    def test_access_log_never_records_tokens(self):
        for path, secret, expected in (
            ("/download/file?token=abc.def&x=1", "abc.def", "token=[redacted]&x=1"),
            ("/download/progress?ticket=tik.sig", "tik.sig", "?ticket=[redacted]"),
        ):
            record = logging.LogRecord(
                "uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                ("203.0.113.5:4000", "GET", path, "1.1", 200), None,
            )
            main.RedactTokens().filter(record)
            self.assertNotIn(secret, record.getMessage())
            self.assertIn(expected, record.getMessage())

    def test_validation_errors_are_one_readable_string(self):
        response = self.client.post("/auth/login", json={})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Email or phone is required. Password is required.")

        response = self.client.post(
            "/auth/login", content=b"{not json", headers={"content-type": "application/json"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "The request body is not valid JSON.")

        response = self.admin("GET", "/admin/users", params={"page": 0})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Page: input should be greater than or equal to 1.")


class RegistrationTests(ApiTestCase):
    def test_register_creates_a_pending_account_with_normalised_contacts(self):
        response = self.register(
            name="  Nusrat   Jahan ", email="Nusrat@Gmail.com", phone="+880 1812-345678",
            note="CSE, Dhaka University",
        )

        self.assertEqual(response.status_code, 201)
        self.assertIn("approved", response.json()["message"])
        user = storage.get_user_by_login("nusrat@gmail.com")
        self.assertEqual(user["status"], "pending")
        self.assertEqual(user["name"], "Nusrat Jahan")
        self.assertEqual(user["phone"], "+8801812345678")
        self.assertEqual(user["note"], "CSE, Dhaka University")
        self.assertIsNone(user["password_hash"])
        self.assertEqual(self.sent, [])

    def test_register_rejects_invalid_fields_with_the_shared_messages(self):
        cases = [
            ({"email": "rahim@gmail"}, "Missing domain — e.g. @gmail.com"),
            ({"phone": "0171234567"}, "Too short — Bangladeshi numbers need 11 digits, e.g. 017XXXXXXXX."),
            ({"phone": "01212345678"}, "Unknown operator — Bangladeshi mobile numbers start with 013–019."),
            ({"name": "A"}, "Name must be at least 2 characters."),
        ]
        for change, message in cases:
            with self.subTest(change=change):
                body = {"name": "Rahim Uddin", "email": "rahim@example.com", "phone": "01712345678", **change}
                response = self.client.post("/auth/register", json=body)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["detail"], message)

        response = self.client.post("/auth/register", json={"email": "a@b.com", "phone": "01712345678"})
        self.assertEqual(response.json()["detail"], "Name is required.")

    def test_duplicate_email_or_phone_is_refused_in_any_format(self):
        self.assertEqual(self.register().status_code, 201)

        response = self.register(email="RAHIM@example.com", phone="01912345678", ip="198.51.100.2")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"],
            "This email is already registered. Sign in or reset your password.",
        )

        response = self.register(email="other@example.com", phone="+8801712345678", ip="198.51.100.3")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"],
            "This phone number is already registered. Sign in or reset your password.",
        )

    def test_register_is_limited_per_ip_per_hour(self):
        limit, _window = auth_router.REGISTER_PER_IP
        for index in range(limit):
            response = self.register(email=f"s{index}@example.com", phone=f"017123{index:05d}")
            self.assertEqual(response.status_code, 201)

        response = self.register(email="s99999@example.com", phone="01712399999")
        self.assertEqual(response.status_code, 429)
        self.assertRegex(response.json()["detail"], r"Try again in \d+ minutes\.$")
        self.assertIn("Retry-After", response.headers)
        # Another network is unaffected.
        self.assertEqual(self.register(email="s99999@example.com", phone="01712399999", ip="198.51.100.77").status_code, 201)


class SignInTests(ApiTestCase):
    def test_full_account_flow(self):
        self.assertEqual(self.register().status_code, 201)
        user_id = self.user_id("rahim@example.com")

        response = self.login("rahim@example.com", "whatever1")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json()["detail"],
            "Your account is waiting for admin approval. You'll get an email when it's approved.",
        )

        password = self.approve(user_id)
        email = self.sent[-1]
        self.assertEqual(email["to"], "rahim@example.com")
        self.assertIn("ready", email["subject"])
        self.assertIn("+8801712345678", email["text"])
        self.assertIn("4 videos per day", email["text"])
        self.assertRegex(password, r"^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$")

        # Phone in any common format, or the email in any case, signs in.
        for login in ("01712345678", "+880 1712-345678", "RAHIM@example.com"):
            response = self.login(login, password)
            self.assertEqual(response.status_code, 200, login)
        body = response.json()
        token = body["token"]
        self.assertEqual(
            set(body["user"]), {"id", "name", "email", "phone", "status", "temp_password", "created_at", "usage"},
        )
        self.assertTrue(body["user"]["temp_password"])
        self.assertNotIn("password_hash", response.text)
        self.assertIsNotNone(storage.get_user_by_id(user_id)["last_login_at"])

        me = self.client.get("/auth/me", headers=bearer(token))
        self.assertEqual(me.status_code, 200)
        usage = me.json()["user"]["usage"]
        self.assertEqual((usage["used"], usage["limit"], usage["remaining"]), (0, 4, 4))
        self.assertEqual(usage["timezone"], "Asia/Dhaka")
        self.assertTrue(usage["resets_at"].endswith("T00:00:00+06:00"))
        # Sessions travel only in the Authorization header, never in a URL.
        response = self.client.get("/auth/me", params={"token": token})
        self.assertEqual((response.status_code, response.json()["detail"]), (401, SESSION_EXPIRED))

        response = self.client.post(
            "/auth/change-password", headers=bearer(token),
            json={"current_password": "wrong-one-1", "new_password": "NewPassword1"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Your current password is incorrect.")

        response = self.client.post(
            "/auth/change-password", headers=bearer(token),
            json={"current_password": password, "new_password": password},
        )
        self.assertEqual(response.status_code, 400)

        response = self.client.post(
            "/auth/change-password", headers=bearer(token),
            json={"current_password": password, "new_password": "short"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "Password must be at least 8 characters.")

        response = self.client.post(
            "/auth/change-password", headers=bearer(token),
            json={"current_password": password, "new_password": "My new pass 2026"},
        )
        self.assertEqual(response.status_code, 200)
        new_token = response.json()["token"]
        self.assertFalse(response.json()["user"]["temp_password"])

        # Every older session ends; the new one works.
        old = self.client.get("/auth/me", headers=bearer(token))
        self.assertEqual(old.status_code, 401)
        self.assertEqual(old.json()["detail"], SESSION_EXPIRED)
        self.assertEqual(self.client.get("/auth/me", headers=bearer(new_token)).status_code, 200)
        self.assertEqual(self.login("rahim@example.com", password).status_code, 401)
        self.assertEqual(self.login("rahim@example.com", "My new pass 2026").status_code, 200)

    def test_unknown_account_and_wrong_password_get_the_same_answer(self):
        self.active_user()
        unknown = self.login("nobody@example.com", "Password123")
        wrong = self.login("rahim@example.com", "Password123")
        self.assertEqual((unknown.status_code, wrong.status_code), (401, 401))
        self.assertEqual(unknown.json(), wrong.json())
        self.assertEqual(unknown.json()["detail"], INVALID_LOGIN)

    def test_unknown_account_still_spends_a_password_hash(self):
        with patch.object(security, "verify_password", wraps=security.verify_password) as verify:
            self.login("nobody@example.com", "Password123")
        verify.assert_called_once_with("Password123", None)

    def test_approved_account_without_a_password_is_told_to_reset(self):
        storage.create_user(name="Old User", email="old@example.com", phone="+8801912345678", status="approved")
        response = self.login("old@example.com", "anything12")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(
            response.json()["detail"],
            "Your account has no password yet. Use “Forgot password” to set one.",
        )

    def test_blocked_account(self):
        user_id, token, password = self.active_user()
        response = self.admin("POST", f"/admin/users/{user_id}/status", json={"status": "blocked"})
        self.assertEqual(response.json()["user"]["status"], "blocked")

        blocked = "Your account has been blocked. Contact the administrator."
        me = self.client.get("/auth/me", headers=bearer(token))
        self.assertEqual((me.status_code, me.json()["detail"]), (403, blocked))
        response = self.login("rahim@example.com", password)
        self.assertEqual((response.status_code, response.json()["detail"]), (403, blocked))
        # Only the password holder learns the account is blocked.
        self.assertEqual(self.login("rahim@example.com", "wrong-pass-1").status_code, 401)
        response = self.request_ticket(token)
        self.assertEqual((response.status_code, response.json()["detail"]), (403, blocked))

        self.admin("POST", f"/admin/users/{user_id}/status", json={"status": "approved"})
        self.assertEqual(self.client.get("/auth/me", headers=bearer(token)).status_code, 200)

    def test_forged_expired_and_misused_tokens_are_rejected(self):
        user_id, token, _password = self.active_user()
        payload, signature = token.split(".")

        other_user = security.create_token("999", "", "session", 3600)
        forged = f"{other_user.split('.')[0]}.{signature}"
        with patch.dict(os.environ, {"AUTH_SECRET": "another-secret-that-is-long-enough-12345"}):
            security._auth_secret.cache_clear()
            foreign = security.create_token(user_id, "x", "session", 3600)
        security._auth_secret.cache_clear()
        pv = security.password_version(storage.get_user_by_id(user_id)["password_hash"])
        with patch.object(security, "time") as clock:
            clock.time.return_value = time.time() - security.SESSION_TTL_SECONDS - 60
            expired = security.create_token(user_id, pv, "session", security.SESSION_TTL_SECONDS)
        reset_token = security.create_token(user_id, pv, "reset", 600)

        for bad in (forged, foreign, expired, reset_token, "garbage", payload, ""):
            with self.subTest(token=bad[:20]):
                response = self.client.get("/auth/me", headers=bearer(bad))
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()["detail"], SESSION_EXPIRED)
        self.assertEqual(self.client.get("/auth/me").status_code, 401)

        # A session token is not a reset token.
        response = self.client.post("/auth/reset-password", json={"token": token, "password": "Another pass 1"})
        self.assertEqual(response.status_code, 400)

    def test_login_attempts_are_limited_per_account(self):
        _user_id, _token, password = self.active_user()
        for attempt in range(10):
            # Different networks, so only the per-account limit applies.
            self.assertEqual(self.login("rahim@example.com", "wrong-pass-1", ip=f"192.0.2.{attempt}").status_code, 401)

        response = self.login("rahim@example.com", password, ip="192.0.2.200")
        self.assertEqual(response.status_code, 429)
        self.assertRegex(response.json()["detail"], r"Try again in \d+ minutes")
        # The same account by phone is a different login key, and still works.
        self.assertEqual(self.login("01712345678", password, ip="192.0.2.201").status_code, 200)

    def test_failed_sign_ins_are_limited_per_ip_but_successes_are_not(self):
        _user_id, _token, password = self.active_user()
        for _ in range(12):
            self.assertEqual(self.login("rahim@example.com", password, ip="192.0.2.10").status_code, 200)
        limit, _window = auth_router.LOGIN_FAILURES_PER_IP
        for index in range(limit):
            self.assertEqual(self.login(f"guess{index}@example.com", "Password123", ip="192.0.2.10").status_code, 401)

        response = self.login("rahim@example.com", password, ip="192.0.2.10")
        self.assertEqual(response.status_code, 429)
        self.assertIn("from your network", response.json()["detail"])
        self.assertEqual(self.login("rahim@example.com", password, ip="192.0.2.11").status_code, 200)


class PasswordResetTests(ApiTestCase):
    def reset_link(self):
        message = self.sent[-1]
        url = re.search(r"https://app\.unistream\.test/reset-password\?token=\S+", message["text"]).group(0)
        return parse_qs(urlsplit(url).query)["token"][0]

    def test_forgot_password_never_reveals_which_emails_exist(self):
        self.active_user()
        self.register(name="Pending Person", email="pending@example.com", phone="01812345678", ip="198.51.100.9")
        self.sent.clear()

        answers = []
        for email in ("nobody@example.com", "pending@example.com", "rahim@example.com"):
            response = self.client.post("/auth/forgot-password", json={"email": email})
            self.assertEqual(response.status_code, 200)
            answers.append(response.json())
        self.assertEqual(answers, [{"message": FORGOT_MESSAGE}] * 3)
        self.assertEqual([message["to"] for message in self.sent], ["rahim@example.com"])
        self.assertIn("Reset your", self.sent[0]["subject"])

    def test_reset_sets_the_password_signs_in_and_works_once(self):
        _user_id, token, password = self.active_user()
        self.client.post("/auth/forgot-password", json={"email": "Rahim@Example.com"})
        reset_token = self.reset_link()

        response = self.client.post("/auth/reset-password", json={"token": reset_token, "password": "short"})
        self.assertEqual(response.status_code, 422)

        response = self.client.post("/auth/reset-password", json={"token": "nonsense", "password": "Fresh pass 99"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["detail"], "This reset link is invalid or has expired. Request a new one.",
        )

        response = self.client.post("/auth/reset-password", json={"token": reset_token, "password": "Fresh pass 99"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["user"]["temp_password"])
        self.assertEqual(self.client.get("/auth/me", headers=bearer(body["token"])).status_code, 200)

        # Single use, and the old password and sessions are gone.
        again = self.client.post("/auth/reset-password", json={"token": reset_token, "password": "Other pass 77"})
        self.assertEqual(again.status_code, 400)
        self.assertEqual(self.client.get("/auth/me", headers=bearer(token)).status_code, 401)
        self.assertEqual(self.login("rahim@example.com", password).status_code, 401)
        self.assertEqual(self.login("rahim@example.com", "Fresh pass 99").status_code, 200)

    def test_reset_clears_a_locked_sign_in(self):
        self.active_user()
        for index in range(10):
            self.login("rahim@example.com", "wrong-pass-1", ip=f"192.0.2.{index}")
        self.assertEqual(self.login("rahim@example.com", "Fresh pass 99", ip="192.0.2.99").status_code, 429)

        self.client.post("/auth/forgot-password", json={"email": "rahim@example.com"})
        self.client.post("/auth/reset-password", json={"token": self.reset_link(), "password": "Fresh pass 99"})

        self.assertEqual(self.login("rahim@example.com", "Fresh pass 99", ip="192.0.2.99").status_code, 200)

    def test_blocked_accounts_get_no_reset_link(self):
        user_id, _token, _password = self.active_user()
        self.admin("POST", f"/admin/users/{user_id}/status", json={"status": "blocked"})
        self.sent.clear()
        self.client.post("/auth/forgot-password", json={"email": "rahim@example.com"})
        self.assertEqual(self.sent, [])

    def test_forgot_password_limits(self):
        self.active_user()
        self.sent.clear()
        for _ in range(4):
            response = self.client.post(
                "/auth/forgot-password", json={"email": "rahim@example.com"},
                headers={"x-forwarded-for": "192.0.2.30"},
            )
            self.assertEqual(response.json(), {"message": FORGOT_MESSAGE})
        # Three emails per address per hour; the fourth answer is identical.
        self.assertEqual(len(self.sent), 3)

        per_ip, _window = auth_router.FORGOT_PER_IP
        for index in range(per_ip - 4):
            response = self.client.post(
                "/auth/forgot-password", json={"email": f"x{index}@example.com"},
                headers={"x-forwarded-for": "192.0.2.30"},
            )
            self.assertEqual(response.status_code, 200)
        response = self.client.post(
            "/auth/forgot-password", json={"email": "y@example.com"}, headers={"x-forwarded-for": "192.0.2.30"},
        )
        self.assertEqual(response.status_code, 429)

    def test_reset_email_failure_is_only_logged(self):
        self.active_user()
        self.email_error = email_service.EmailError("Brevo rejected the request")
        with self.assertLogs("routers.auth", level="WARNING") as logs:
            response = self.client.post("/auth/forgot-password", json={"email": "rahim@example.com"})
        self.assertEqual(response.json(), {"message": FORGOT_MESSAGE})
        self.assertIn("Brevo rejected", "".join(logs.output))


class AdminSecretTests(ApiTestCase):
    def test_admin_routes_need_the_secret(self):
        response = self.client.get("/admin/overview")
        self.assertEqual((response.status_code, response.json()["detail"]), (401, ADMIN_EXPIRED))
        response = self.client.get("/admin/overview", headers={"x-admin-secret": "nope"})
        self.assertEqual((response.status_code, response.json()["detail"]), (401, ADMIN_EXPIRED))
        # ADMIN_SECRET keeps working as an API key for scripts.
        self.assertEqual(self.admin("GET", "/admin/overview").status_code, 200)

    def test_failed_admin_secrets_are_limited_per_ip(self):
        headers = {"x-forwarded-for": "192.0.2.66"}
        for attempt in range(10):
            response = self.client.get(
                "/admin/settings", headers={**headers, "x-admin-secret": f"guess-{attempt}"},
            )
            self.assertEqual(response.status_code, 401)

        response = self.admin("GET", "/admin/settings", headers=headers)
        self.assertEqual(response.status_code, 429)
        self.assertRegex(response.json()["detail"], r"Try again in \d+ minutes")
        self.assertEqual(self.admin("GET", "/admin/settings", headers={"x-forwarded-for": "192.0.2.67"}).status_code, 200)

    def test_a_repeated_stale_secret_counts_once(self):
        # A dashboard tab with a rotated secret sends the same wrong value with
        # every request; that must not lock the admin out of their own IP.
        headers = {"x-forwarded-for": "192.0.2.68", "x-admin-secret": "old-secret"}
        for _ in range(25):
            self.assertEqual(self.client.get("/admin/overview", headers=headers).status_code, 401)
        response = self.admin("GET", "/admin/overview", headers={"x-forwarded-for": "192.0.2.68"})
        self.assertEqual(response.status_code, 200)

    def test_admin_is_disabled_without_a_configured_secret(self):
        with patch.dict(os.environ, {"ADMIN_SECRET": "", "ADMIN_PASSWORD": ""}):
            response = self.admin("GET", "/admin/overview")
            login = self.client.post("/admin/auth/login", json={"username": "admin", "password": ADMIN_SECRET})
        self.assertEqual(
            (response.status_code, response.json()["detail"]),
            (503, "Admin access is not configured. Set ADMIN_SECRET on the server."),
        )
        self.assertEqual(login.status_code, 503)


class AdminUserTests(ApiTestCase):
    def create(self, **body):
        defaults = {"name": "Karim Ahmed", "email": "karim@example.com", "phone": "01612345678"}
        return self.admin("POST", "/admin/users", json={**defaults, **body})

    def test_create_user_emails_a_temporary_password(self):
        response = self.create(note="EEE 3rd year", daily_limit=6)

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["credentials"], {"emailed": True, "email_error": None, "password": None})
        user = body["user"]
        self.assertEqual(
            set(user),
            {
                "id", "identifier", "name", "email", "phone", "note", "status", "daily_limit",
                "effective_limit", "used_today", "total_downloads", "has_password", "temp_password",
                "approved_at", "credentials_sent_at", "last_login_at", "last_download_at",
                "created_at", "updated_at",
            },
        )
        self.assertEqual((user["status"], user["daily_limit"], user["effective_limit"]), ("approved", 6, 6))
        self.assertTrue(user["has_password"] and user["temp_password"])
        self.assertIsNotNone(user["approved_at"])
        self.assertIsNotNone(user["credentials_sent_at"])
        self.assertNotIn("password_hash", response.text)
        self.assertIn("6 videos per day", self.sent[-1]["text"])
        self.assertEqual(self.login("01612345678", self.password_from(self.sent[-1])).status_code, 200)

    def test_password_is_shown_to_the_admin_only_when_the_email_fails(self):
        self.email_error = email_service.EmailError("Email is not configured: BREVO_API_KEY is not set.")
        response = self.create()

        credentials = response.json()["credentials"]
        self.assertFalse(credentials["emailed"])
        self.assertIn("BREVO_API_KEY", credentials["email_error"])
        self.assertIsNone(response.json()["user"]["credentials_sent_at"])
        self.assertEqual(self.login("karim@example.com", credentials["password"]).status_code, 200)

    def test_create_pending_user_sends_nothing(self):
        response = self.create(status="pending")
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.json()["credentials"])
        self.assertFalse(response.json()["user"]["has_password"])
        self.assertEqual(self.sent, [])

    def test_create_validation_and_duplicates(self):
        self.assertEqual(self.create().status_code, 201)
        response = self.create(phone="01912345678")
        self.assertEqual((response.status_code, response.json()["detail"]),
                         (409, "Another account already uses this email address."))
        response = self.create(email="new@example.com", daily_limit=10001)
        self.assertEqual(response.status_code, 422)
        self.assertIn("from 0 to 10000", response.json()["detail"])
        response = self.create(email="new@example.com", status="blocked")
        self.assertEqual(response.status_code, 422)
        # Python's JSON parser accepts NaN/Infinity; they must not become a 500.
        response = self.admin(
            "PATCH", "/admin/users/1", content=b'{"daily_limit": Infinity}',
            headers={"content-type": "application/json"},
        )
        self.assertEqual(response.status_code, 422)

    def test_edit_profile_and_daily_limit(self):
        user_id = self.create().json()["user"]["id"]

        response = self.admin("PATCH", f"/admin/users/{user_id}", json={
            "name": "Karim A.", "email": "Karim.New@Example.com", "phone": "+44 7700 900123",
            "note": "Moved\nto EEE", "daily_limit": 10,
        })
        self.assertEqual(response.status_code, 200, response.text)
        user = response.json()["user"]
        self.assertEqual(user["email"], "karim.new@example.com")
        self.assertEqual(user["identifier"], "karim.new@example.com")
        self.assertEqual(user["phone"], "+447700900123")
        self.assertEqual(user["note"], "Moved\nto EEE")
        self.assertEqual(user["effective_limit"], 10)

        unlimited = self.admin("PATCH", f"/admin/users/{user_id}", json={"daily_limit": -1}).json()["user"]
        self.assertEqual((unlimited["daily_limit"], unlimited["effective_limit"]), (-1, None))
        default = self.admin("PATCH", f"/admin/users/{user_id}", json={"daily_limit": None}).json()["user"]
        self.assertEqual((default["daily_limit"], default["effective_limit"]), (None, 4))
        # Keys that are not sent stay as they are.
        self.assertEqual(default["name"], "Karim A.")

        self.assertEqual(self.admin("PATCH", f"/admin/users/{user_id}", json={"email": None}).status_code, 422)
        self.assertEqual(self.admin("PATCH", "/admin/users/424242", json={"name": "Someone"}).status_code, 404)
        self.create(email="taken@example.com", phone="01512345678")
        response = self.admin("PATCH", f"/admin/users/{user_id}", json={"phone": "01512345678"})
        self.assertEqual((response.status_code, response.json()["detail"]),
                         (409, "Another account already uses this phone number."))
        # The new email signs in.
        self.assertEqual(self.login("karim.new@example.com", self.password_from(self.sent[0])).status_code, 200)

    def test_list_search_filter_sort_and_paginate(self):
        self.create(name="Zara Khan", email="zara@example.com", phone="01312345678")
        self.create(name="Anik Das", email="anik@example.com", phone="01412345678", status="pending")
        self.create(name="Mina Roy", email="mina@example.com", phone="01512345678", note="Physics")

        page = self.admin("GET", "/admin/users", params={"sort": "name", "order": "asc", "page_size": 2}).json()
        self.assertEqual(page["total"], 3)
        self.assertEqual((page["page"], page["page_size"]), (1, 2))
        self.assertEqual([user["name"] for user in page["items"]], ["Anik Das", "Mina Roy"])

        pending = self.admin("GET", "/admin/users", params={"status": "pending"}).json()
        self.assertEqual([user["name"] for user in pending["items"]], ["Anik Das"])
        self.assertEqual(self.admin("GET", "/admin/users", params={"status": "all"}).json()["total"], 3)
        self.assertEqual(self.admin("GET", "/admin/users", params={"q": "physics"}).json()["total"], 1)
        self.assertEqual(self.admin("GET", "/admin/users", params={"q": "1312345"}).json()["items"][0]["name"], "Zara Khan")
        self.assertEqual(self.admin("GET", "/admin/users", params={"sort": "password_hash"}).status_code, 422)

    def test_send_password_replaces_it_and_ends_sessions(self):
        user_id, token, old_password = self.active_user()
        self.register(name="Pending Person", email="pending@example.com", phone="01812345678", ip="198.51.100.9")
        pending_id = self.user_id("pending@example.com")

        response = self.admin("POST", f"/admin/users/{pending_id}/send-password")
        self.assertEqual(response.status_code, 400)

        response = self.admin("POST", f"/admin/users/{user_id}/send-password")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["credentials"]["emailed"])
        self.assertIn("new", self.sent[-1]["subject"])
        new_password = self.password_from(self.sent[-1])
        self.assertNotEqual(new_password, old_password)
        self.assertEqual(self.client.get("/auth/me", headers=bearer(token)).status_code, 401)
        self.assertEqual(self.login("rahim@example.com", new_password).status_code, 200)

    def test_approve_does_not_reissue_an_active_password(self):
        user_id, token, _password = self.active_user()
        sent_before = len(self.sent)
        response = self.admin("POST", f"/admin/users/{user_id}/approve", json={"send_credentials": True})
        self.assertIsNone(response.json()["credentials"])
        self.assertEqual(len(self.sent), sent_before)
        self.assertEqual(self.client.get("/auth/me", headers=bearer(token)).status_code, 200)

    def test_approve_without_sending_credentials(self):
        self.register()
        user_id = self.user_id("rahim@example.com")
        response = self.admin("POST", f"/admin/users/{user_id}/approve", json={"send_credentials": False})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["credentials"])
        self.assertEqual(response.json()["user"]["status"], "approved")
        self.assertFalse(response.json()["user"]["has_password"])
        self.assertEqual(self.admin("POST", "/admin/users/424242/approve").status_code, 404)

    def test_reset_usage_and_delete(self):
        user_id, token, _password = self.active_user()
        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl()):
            self.download(token)
        self.assertEqual(self.client.get("/auth/me", headers=bearer(token)).json()["user"]["usage"]["used"], 1)

        response = self.admin("POST", f"/admin/users/{user_id}/reset-usage")
        self.assertEqual(response.json()["user"]["used_today"], 0)
        self.assertEqual(response.json()["user"]["total_downloads"], 1)
        self.assertEqual(self.client.get("/auth/me", headers=bearer(token)).json()["user"]["usage"]["used"], 0)

        self.assertEqual(self.admin("DELETE", f"/admin/users/{user_id}").json(), {"deleted": True})
        self.assertEqual(self.admin("DELETE", f"/admin/users/{user_id}").status_code, 404)
        self.assertEqual(self.client.get("/auth/me", headers=bearer(token)).status_code, 401)
        # The audit log outlives the account.
        self.assertEqual([log["user_id"] for log in self.logs()], [None])

    def test_bulk_actions_report_per_user_results(self):
        ids = []
        for index in range(3):
            self.register(name=f"Student {'ABC'[index]}", email=f"bulk{index}@example.com",
                          phone=f"0171111111{index}", ip=f"198.51.100.{index + 10}")
            ids.append(self.user_id(f"bulk{index}@example.com"))

        response = self.admin("POST", "/admin/users/bulk", json={"ids": ids + ["424242", ids[0]], "action": "approve"})
        results = response.json()["results"]
        self.assertEqual([result["id"] for result in results], ids + ["424242"])
        self.assertTrue(all(result["ok"] and result["credentials"]["emailed"] for result in results[:3]))
        self.assertEqual(results[3], {"id": "424242", "ok": False, "error": "User not found.", "credentials": None})
        self.assertEqual(sorted(message["to"] for message in self.sent),
                         [f"bulk{index}@example.com" for index in range(3)])

        self.admin("POST", "/admin/users/bulk", json={"ids": ids[:2], "action": "block"})
        self.assertEqual([storage.get_user_by_id(i)["status"] for i in ids], ["blocked", "blocked", "approved"])
        self.admin("POST", "/admin/users/bulk", json={"ids": ids[:1], "action": "pending"})
        self.assertEqual(storage.get_user_by_id(ids[0])["status"], "pending")

        response = self.admin("POST", "/admin/users/bulk", json={"ids": ids, "action": "delete"})
        self.assertTrue(all(result["ok"] for result in response.json()["results"]))
        self.assertEqual(storage.user_status_counts()["total"], 0)

        too_many = [str(index) for index in range(201)]
        self.assertEqual(self.admin("POST", "/admin/users/bulk", json={"ids": too_many, "action": "block"}).status_code, 422)
        self.assertEqual(self.admin("POST", "/admin/users/bulk", json={"ids": [], "action": "block"}).status_code, 422)


class DownloadTests(ApiTestCase):
    def test_completed_downloads_count_and_are_logged(self):
        user_id, token, _password = self.active_user(daily_limit=2)

        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(content=b"x" * 2048)):
            events = self.download(token, url="https://youtu.be/dECxLXuEafE", height=1080)
        complete = events[-1]
        self.assertEqual(complete["status"], "complete")
        self.assertEqual(
            {key: complete["usage"][key] for key in ("used", "limit", "remaining")},
            {"used": 1, "limit": 2, "remaining": 1},
        )
        entry = download_router._jobs[f"token:{complete['token']}"]
        self.assertEqual(entry["user_id"], user_id)
        self.assertIn("job_id", entry)
        # The file token is random, not a guessable or sequential id.
        self.assertGreaterEqual(len(complete["token"]), 40)
        served_dir = Path(entry["filename"]).parent
        self.addCleanup(shutil.rmtree, served_dir, ignore_errors=True)
        file_response = self.client.get("/download/file", params={"token": complete["token"]})
        self.assertEqual(file_response.content, b"x" * 2048)
        self.assertEqual(file_response.headers["cache-control"], "no-store")
        # The file token is single-use.
        again = self.client.get("/download/file", params={"token": complete["token"]})
        self.assertEqual(again.status_code, 404)
        self.assertEqual(again.json()["detail"], download_router.FILE_GONE_MESSAGE)

        log = self.logs()[0]
        self.assertEqual(
            (log["user_id"], log["identifier"], log["platform"], log["quality"], log["file_size"], log["title"]),
            (user_id, "rahim@example.com", "YouTube", "1080p MP4", 2048, "Lecture"),
        )

        # Two tickets while one download is left: the stream start checks
        # the limit again, so only one of them can be used.
        spare = self.ticket(token)
        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(title="Reel")):
            events = self.download(token, url="https://www.instagram.com/reel/abc/", ext="mp3", height=None)
        self.assertEqual(events[-1]["usage"]["remaining"], 0)
        self.assertEqual((self.logs()[0]["platform"], self.logs()[0]["quality"]), ("Instagram", "MP3"))
        message = self.assert_refused(self.stream(spare), "limit")
        self.assertEqual(message, "You've used all 2 downloads for today. Your limit resets at 12:00 AM.")

        response = self.request_ticket(token)
        self.assertEqual(
            (response.status_code, response.json()["detail"]),
            (429, "You've used all 2 downloads for today. Your limit resets at 12:00 AM."),
        )
        usage = self.client.get("/auth/me", headers=bearer(token)).json()["user"]["usage"]
        self.assertEqual((usage["used"], usage["remaining"]), (2, 0))

        user = self.admin("GET", "/admin/users").json()["items"][0]
        self.assertEqual((user["used_today"], user["total_downloads"]), (2, 2))
        self.assertIsNotNone(user["last_download_at"])

    def test_a_single_download_limit_reads_naturally(self):
        _user_id, token, _password = self.active_user(daily_limit=1)
        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl()):
            self.download(token)
        response = self.request_ticket(token)
        self.assertEqual(
            response.json()["detail"],
            "You've used your 1 download for today. Your limit resets at 12:00 AM.",
        )

    def test_failed_downloads_do_not_count(self):
        _user_id, token, _password = self.active_user(daily_limit=1)
        failure = yt_dlp.utils.DownloadError("ERROR: Unable to download video data: HTTP Error 404")

        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(error=failure)):
            events = self.download(token)
        self.assertEqual(events[-1]["status"], "error")
        self.assertNotIn("code", events[-1])
        self.assertEqual(self.logs(), [])

        # The slot was released and nothing was counted.
        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl()):
            self.assertEqual(self.download(token)[-1]["status"], "complete")

    def test_ticket_prechecks(self):
        _user_id, token, _password = self.active_user()
        self.assertEqual(self.request_ticket(None).status_code, 401)
        self.assertEqual(self.request_ticket("forged.token").status_code, 401)
        for url in ("https://www.tiktok.com/@a/video/1", "javascript:alert(1)//youtube.com",
                    "https://www.youtube.com@evil.example/watch?v=1", "http://169.254.169.254/latest"):
            with self.subTest(url=url):
                response = self.request_ticket(token, url=url)
                self.assertEqual((response.status_code, response.json()["detail"]), (400, UNSUPPORTED))

        cases = (
            {"ext": "exe"},
            {"height": 0},
            {"url": "https://youtu.be/" + "a" * 2048},
            {"format_id": "x" * 201},
            {"format_id": "h\td"},
            {"source": "s" * 33},
            {"identifier": "extra field"},
        )
        for change in cases:
            with self.subTest(change=str(change)[:40]):
                response = self.request_ticket(token, **change)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIsInstance(response.json()["detail"], str)
        self.assertEqual(self.logs(), [])

    def test_stream_refuses_anything_but_a_fresh_ticket(self):
        user_id, token, _password = self.active_user()
        pv = security.password_version(storage.get_user_by_id(user_id)["password_hash"])
        valid = self.ticket(token)
        payload, signature = valid.split(".")
        with patch.object(security, "time") as clock:
            clock.time.return_value = time.time() - 61
            expired = security.create_download_ticket(user_id, pv, url=FACEBOOK_URL, format_id="hd", ext="mp4")
        with patch.dict(os.environ, {"AUTH_SECRET": "another-secret-that-is-long-enough-12345"}):
            security._auth_secret.cache_clear()
            foreign = security.create_download_ticket(user_id, pv, url=FACEBOOK_URL, format_id="hd", ext="mp4")
        security._auth_secret.cache_clear()
        other_url = security.create_download_ticket(user_id, pv, url="https://youtu.be/x", format_id="hd", ext="mp4")
        tampered = f"{other_url.split('.')[0]}.{signature}"
        session_token_as_ticket = token
        admin_token_as_ticket = self.admin_session()["token"]

        refusals = {
            "missing": self.stream(None),
            "garbage": self.stream("garbage"),
            "expired": self.stream(expired),
            "foreign": self.stream(foreign),
            "tampered": self.stream(tampered),
            "session token": self.stream(session_token_as_ticket),
            "admin token": self.stream(admin_token_as_ticket),
            "old query params": self.stream(params={"token": token, "url": FACEBOOK_URL, "format_id": "hd", "ext": "mp4"}),
            "too long": self.stream("a" * 9000),
        }
        for name, events in refusals.items():
            with self.subTest(name=name):
                self.assertEqual(self.assert_refused(events, "auth"), TICKET_EXPIRED)

        # A ticket works once.
        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl()):
            self.assertEqual(self.stream(valid)[-1]["status"], "complete")
        self.assertEqual(self.assert_refused(self.stream(valid), "auth"), TICKET_EXPIRED)
        self.assertEqual(len(self.logs()), 1)

        # A ticket the server signed for another platform is still re-checked.
        sneaky = security.create_download_ticket(
            user_id, pv, url="https://vimeo.com/1", format_id="hd", ext="mp4",
        )
        self.assertEqual(self.assert_refused(self.stream(sneaky), "platform"), UNSUPPORTED)

    def test_password_change_voids_unused_tickets(self):
        _user_id, token, password = self.active_user()
        ticket = self.ticket(token)
        response = self.client.post(
            "/auth/change-password", headers=bearer(token),
            json={"current_password": password, "new_password": "Changed pass 42"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.assert_refused(self.stream(ticket), "auth"), SESSION_EXPIRED)

    def test_blocked_after_the_ticket_was_issued(self):
        user_id, token, _password = self.active_user()
        ticket = self.ticket(token)
        self.admin("POST", f"/admin/users/{user_id}/status", json={"status": "blocked"})
        self.assertEqual(
            self.assert_refused(self.stream(ticket), "auth"),
            "Your account has been blocked. Contact the administrator.",
        )

    def test_tickets_are_limited_per_user(self):
        _user_id, token, _password = self.active_user()
        limit, _window = download_router.TICKETS_PER_USER
        for _ in range(limit):
            self.ticket(token)
        response = self.request_ticket(token)
        self.assertEqual(response.status_code, 429)
        self.assertRegex(response.json()["detail"], r"^Too many download attempts\. Try again in \d+ minutes\.$")

    def test_tickets_and_sessions_cannot_stand_in_for_each_other(self):
        _user_id, token, _password = self.active_user()
        ticket = self.ticket(token)
        self.assertEqual(self.client.get("/auth/me", headers=bearer(ticket)).status_code, 401)
        self.assertEqual(self.client.get("/admin/overview", headers=bearer(ticket)).status_code, 401)
        admin_token = self.admin_session()["token"]
        self.assertEqual(self.request_ticket(admin_token).status_code, 401)

    def test_parallel_downloads_cannot_overshoot_the_limit(self):
        _user_id, token, _password = self.active_user(daily_limit=1)
        gate, started = threading.Event(), threading.Semaphore(0)
        results = {}
        early_ticket = self.ticket(token)
        first_ticket = self.ticket(token)

        def first():
            results["events"] = self.stream(first_ticket, client=TestClient(main.app))

        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(gate=gate, started=started)):
            thread = threading.Thread(target=first)
            thread.start()
            try:
                self.assertTrue(started.acquire(timeout=20))
                # One download is running and none has completed: no room left.
                response = self.request_ticket(token)
                self.assertEqual(response.status_code, 429)
                self.assertIn("already in progress", response.json()["detail"])
                message = self.assert_refused(self.stream(early_ticket), "limit")
                self.assertIn("already in progress", message)
            finally:
                gate.set()
                thread.join(30)

        self.assertEqual(results["events"][-1]["status"], "complete")
        self.assertEqual(self.request_ticket(token).status_code, 429)
        self.assertEqual(len(self.logs()), 1)

    def test_at_most_two_downloads_run_at_once_per_account(self):
        _user_id, token, _password = self.active_user(daily_limit=-1)
        gate, started = threading.Event(), threading.Semaphore(0)
        results = []
        tickets = [self.ticket(token) for _ in range(3)]

        def run(ticket):
            results.append(self.stream(ticket, client=TestClient(main.app)))

        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(gate=gate, started=started)):
            threads = [threading.Thread(target=run, args=(ticket,)) for ticket in tickets[:2]]
            for thread in threads:
                thread.start()
            try:
                for _ in threads:
                    self.assertTrue(started.acquire(timeout=20))
                response = self.request_ticket(token)
                self.assertEqual(response.status_code, 409)
                self.assertIn("2 downloads in progress", response.json()["detail"])
                self.assertIn("2 downloads in progress", self.assert_refused(self.stream(tickets[2]), "busy"))
            finally:
                gate.set()
                for thread in threads:
                    thread.join(30)

        self.assertEqual([events[-1]["status"] for events in results], ["complete", "complete"])
        self.assertIsNone(results[0][-1]["usage"]["limit"])
        self.assertIsNone(results[0][-1]["usage"]["remaining"])

    def test_first_event_carries_a_resume_code(self):
        _user_id, token, _password = self.active_user(daily_limit=-1)
        events = self.stream(self.ticket(token))
        self.assertEqual(events[0]["status"], "starting")
        self.assertTrue(events[0]["job_id"])
        self.assertGreaterEqual(len(events[0]["resume"]), 24)

    def test_reconnecting_with_the_resume_code_delivers_the_result(self):
        download_router._jobs["job-r"] = {
            "resume": "secret-code", "watchers": 0, "status": "complete",
            "percent": 100, "token": "file-token", "usage": None,
        }
        self.addCleanup(download_router._jobs.pop, "job-r", None)

        events = self.stream(params={"job": "job-r", "resume": "secret-code"})

        self.assertEqual(events[-1]["status"], "complete")
        self.assertEqual(events[-1]["token"], "file-token")
        self.assertNotIn("job-r", download_router._jobs)

    def test_reconnecting_with_a_wrong_code_is_refused(self):
        download_router._jobs["job-w"] = {"resume": "secret-code", "watchers": 0, "status": "downloading"}
        self.addCleanup(download_router._jobs.pop, "job-w", None)

        for params in ({"job": "job-w", "resume": "guess"}, {"job": "job-w"}, {"job": "missing", "resume": "x"}):
            events = self.stream(params=params)
            self.assertEqual([e["code"] for e in events], ["auth"])
        self.assertIn("job-w", download_router._jobs)

    def test_a_dropped_stream_keeps_the_job_only_while_someone_may_return(self):
        download_router._jobs["job-g"] = {"resume": "c", "watchers": 0, "status": "downloading"}
        download_router._jobs["job-h"] = {"resume": "c", "watchers": 1, "status": "downloading"}
        self.addCleanup(download_router._jobs.pop, "job-g", None)
        self.addCleanup(download_router._jobs.pop, "job-h", None)

        with patch.object(download_router, "RESUME_GRACE_SECONDS", 0):
            asyncio.run(download_router._drop_if_unwatched("job-g"))
            asyncio.run(download_router._drop_if_unwatched("job-h"))

        self.assertNotIn("job-g", download_router._jobs)
        self.assertIn("job-h", download_router._jobs)

    def test_abandoned_download_stops_and_frees_its_slots(self):
        user_id, token, _password = self.active_user(daily_limit=-1)
        gate, started, finished = threading.Event(), threading.Semaphore(0), threading.Event()
        calls, outcome = [], []

        class StoppableYoutubeDL:
            def __init__(self, options):
                self.options = options

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def extract_info(self, _url, download):
                calls.append(1)
                started.release()
                gate.wait(20)
                try:
                    for _ in range(50):
                        for hook in self.options.get("progress_hooks", []):
                            hook({"status": "downloading", "downloaded_bytes": 1, "total_bytes": 100})
                        time.sleep(0.01)
                    outcome.append("ran to the end")
                except BaseException as exc:
                    outcome.append(type(exc).__name__)
                    raise
                finally:
                    finished.set()
                return {"title": "x"}

        ticket = self.ticket(token)
        results = []
        with patch.object(yt_dlp, "YoutubeDL", StoppableYoutubeDL):
            thread = threading.Thread(target=lambda: results.append(self.stream(ticket, client=TestClient(main.app))))
            thread.start()
            self.assertTrue(started.acquire(timeout=20))
            # The browser leaves: the stream drops its job.
            for key in [k for k in download_router._jobs if not k.startswith("token:")]:
                download_router._jobs.pop(key, None)
            gate.set()
            self.assertTrue(finished.wait(20))
            thread.join(20)
            self.assertFalse(thread.is_alive())
            deadline = time.time() + 10
            while dependencies.download_slots.active(user_id) and time.time() < deadline:
                time.sleep(0.05)

        self.assertNotIn("complete", [event["status"] for event in results[0]])
        self.assertEqual(outcome, ["DownloadCancelled"])
        self.assertEqual(len(calls), 1)  # no fallback attempt after a cancel
        self.assertEqual(dependencies.download_slots.active(user_id), 0)
        self.assertEqual(self.logs(), [])
        self.assertEqual(self.client.get("/auth/me", headers=bearer(token)).json()["user"]["usage"]["used"], 0)

    def test_startup_sweeps_download_folders_left_by_a_previous_process(self):
        root = Path(self.temp_dir.name)
        old, fresh = root / "unistream_old", root / "unistream_fresh"
        for folder in (old, fresh):
            folder.mkdir()
            (folder / "video.mp4").write_bytes(b"x")
        (root / "other_dir").mkdir()
        stale = time.time() - download_router.STALE_TEMP_SECONDS - 60
        os.utime(old, (stale, stale))
        os.utime(root / "other_dir", (stale, stale))
        self.assertEqual(download_router.sweep_stale_temp_dirs(str(root)), 1)
        self.assertFalse(old.exists())
        self.assertTrue(fresh.exists())
        self.assertTrue((root / "other_dir").exists())

    def test_default_limit_comes_from_the_settings(self):
        _user_id, token, _password = self.active_user()
        ticket = self.ticket(token)
        self.admin("PUT", "/admin/settings", json={"default_daily_limit": 0})
        response = self.request_ticket(token)
        self.assertEqual(response.status_code, 429)
        self.assertIn("turned off", response.json()["detail"])
        self.assertIn("turned off", self.assert_refused(self.stream(ticket), "limit"))

    def test_file_tokens_are_bounded(self):
        self.assertEqual(self.client.get("/download/file", params={"token": "x" * 129}).status_code, 422)
        response = self.client.get("/download/file", params={"token": "unknown"})
        self.assertEqual((response.status_code, response.json()["detail"]), (404, download_router.FILE_GONE_MESSAGE))


class VideoInfoTests(ApiTestCase):
    def test_video_info_needs_a_session_and_a_supported_link(self):
        _user_id, token, _password = self.active_user()
        self.assertEqual(self.client.post("/video-info", json={"url": FACEBOOK_URL}).status_code, 401)

        response = self.client.post(
            "/video-info", json={"url": "https://vm.tiktok.com/abc"}, headers=bearer(token),
        )
        self.assertEqual((response.status_code, response.json()["detail"]), (400, UNSUPPORTED))

    def test_video_info_is_limited_per_user(self):
        _user_id, token, _password = self.active_user()
        cached = {"title": "Clip", "formats": []}
        with patch.object(main.extraction_cache, "payload", return_value=cached):
            for _ in range(40):
                response = self.client.post("/video-info", json={"url": FACEBOOK_URL}, headers=bearer(token))
                self.assertEqual(response.status_code, 200)
            response = self.client.post("/video-info", json={"url": FACEBOOK_URL}, headers=bearer(token))

        self.assertEqual(response.status_code, 429)
        self.assertRegex(response.json()["detail"], r"^Too many requests, try again in \d+ minutes\.$")
        # Analysis never counts toward the download limit.
        self.assertEqual(self.client.get("/auth/me", headers=bearer(token)).json()["user"]["usage"]["used"], 0)


class AdminLogTests(ApiTestCase):
    def add_log(self, when, *, platform="YouTube", title="Lecture", user_id=None, identifier="a@example.com"):
        storage.add_download_log(
            user_id=user_id, identifier=identifier, url="https://youtu.be/x", title=title,
            platform=platform, quality="720p MP4", file_size=100,
        )
        conn = storage._get_local_conn()
        with storage._local_lock:
            row_id = conn.execute("SELECT MAX(id) FROM download_logs").fetchone()[0]
            conn.execute("UPDATE download_logs SET created_at = ? WHERE id = ?", (storage._db_ts(when), row_id))
            conn.commit()
        return str(row_id)

    def test_filters_dates_are_whole_local_days(self):
        user_id = storage.create_user(name="Log User", email="log@example.com", phone="+8801712345600")["id"]
        utc = timezone.utc
        late_oct_1 = self.add_log(datetime(2026, 10, 1, 17, 59, tzinfo=utc), title="Late night")  # 23:59 Dhaka
        early_oct_2 = self.add_log(datetime(2026, 10, 1, 18, 1, tzinfo=utc), platform="Facebook",
                                   user_id=user_id, identifier="log@example.com")
        last_oct_2 = self.add_log(datetime(2026, 10, 2, 17, 59, tzinfo=utc), title="Exam revision")

        def ids(**params):
            response = self.admin("GET", "/admin/logs", params=params)
            self.assertEqual(response.status_code, 200, response.text)
            return [item["id"] for item in response.json()["items"]]

        self.assertEqual(ids(), [last_oct_2, early_oct_2, late_oct_1])
        self.assertEqual(ids(date_from="2026-10-02", date_to="2026-10-02"), [last_oct_2, early_oct_2])
        self.assertEqual(ids(date_to="2026-10-01"), [late_oct_1])
        self.assertEqual(ids(platform="facebook"), [early_oct_2])
        self.assertEqual(ids(user_id=user_id), [early_oct_2])
        self.assertEqual(ids(q="REVISION"), [last_oct_2])

        page = self.admin("GET", "/admin/logs", params={"page": 2, "page_size": 2}).json()
        self.assertEqual((page["total"], page["page"], page["page_size"]), (3, 2, 2))
        self.assertEqual([item["id"] for item in page["items"]], [late_oct_1])
        self.assertEqual(
            set(page["items"][0]),
            {"id", "user_id", "identifier", "url", "title", "platform", "quality", "file_size", "created_at"},
        )

        bad = self.admin("GET", "/admin/logs", params={"date_from": "02/10/2026"})
        self.assertEqual((bad.status_code, bad.json()["detail"]),
                         (400, "Start date must be a date in YYYY-MM-DD format."))
        reversed_range = self.admin("GET", "/admin/logs", params={"date_from": "2026-10-03", "date_to": "2026-10-01"})
        self.assertEqual(reversed_range.status_code, 400)

    def test_delete_single_and_selected_logs(self):
        now = datetime.now(timezone.utc)
        first, second, third = (self.add_log(now - timedelta(minutes=m)) for m in (1, 2, 3))

        self.assertEqual(self.admin("DELETE", f"/admin/logs/{first}").json(), {"deleted": 1})
        self.assertEqual(self.admin("DELETE", f"/admin/logs/{first}").json(), {"deleted": 0})
        response = self.admin("POST", "/admin/logs/delete", json={"ids": [second, third, "999"]})
        self.assertEqual(response.json(), {"deleted": 2})
        self.assertEqual(storage.count_download_logs(), 0)
        self.assertEqual(self.admin("POST", "/admin/logs/delete", json={"ids": []}).status_code, 422)

    def test_purge_old_logs(self):
        now = datetime.now(timezone.utc)
        self.add_log(now - timedelta(days=100))
        self.add_log(now - timedelta(days=40))
        self.add_log(now - timedelta(days=1))
        self.add_log(now)

        self.assertEqual(self.admin("POST", "/admin/logs/purge", json={"older_than_days": 90}).json(), {"deleted": 1})
        self.assertEqual(self.admin("POST", "/admin/logs/purge", json={"older_than_days": 30}).json(), {"deleted": 1})
        before = security.local_today().isoformat()
        self.assertEqual(self.admin("POST", "/admin/logs/purge", json={"before": before}).json()["deleted"], 1)
        self.assertEqual(self.admin("POST", "/admin/logs/purge", json={"all": True}).json(), {"deleted": 1})

        for body in ({}, {"all": False}, {"older_than_days": 0}, {"older_than_days": 7, "all": True},
                     {"before": "yesterday"}):
            with self.subTest(body=body):
                response = self.admin("POST", "/admin/logs/purge", json=body)
                self.assertEqual(response.status_code, 422)
                self.assertIsInstance(response.json()["detail"], str)

    def test_export_is_an_excel_friendly_csv(self):
        now = datetime.now(timezone.utc)
        self.add_log(now - timedelta(hours=2), title="=HYPERLINK(\"http://evil\")", platform="Facebook")
        self.add_log(now - timedelta(hours=1), title="বাংলা লেকচার")

        response = self.admin("GET", "/admin/logs/export")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/csv"))
        filename = f"download-logs-{security.local_today():%Y%m%d}.csv"
        self.assertIn(filename, response.headers["content-disposition"])
        self.assertTrue(response.content.startswith(b"\xef\xbb\xbf"))

        rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
        self.assertEqual(rows[0][0], "Downloaded at (Asia/Dhaka)")
        self.assertEqual([row[5] for row in rows[1:]], ["বাংলা লেকচার", "'=HYPERLINK(\"http://evil\")"])

        filtered = self.admin("GET", "/admin/logs/export", params={"platform": "Facebook"})
        self.assertEqual(len(list(csv.reader(io.StringIO(filtered.content.decode("utf-8-sig"))))), 2)


class CsvNeutralisationTests(unittest.TestCase):
    def test_every_formula_prefix_is_neutralised(self):
        from routers import admin as admin_router
        for value in ("=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1"):
            with self.subTest(value=value):
                self.assertEqual(admin_router._csv_cell(value), "'" + value)
        for value, expected in (("Lecture 1", "Lecture 1"), ("", ""), (None, ""), (5, "5"), (" =1", " =1")):
            self.assertEqual(admin_router._csv_cell(value), expected)


class SettingsAndOverviewTests(ApiTestCase):
    def test_no_secret_reaches_an_admin_response(self):
        token = self.admin_session()["token"]
        secrets_to_hide = (ENV["ADMIN_SECRET"], ENV["AUTH_SECRET"], ENV["BREVO_API_KEY"])
        for path in ("/admin/overview", "/admin/settings", "/admin/storage", "/admin/auth/me", "/admin/schema"):
            with self.subTest(path=path):
                response = self.client.get(path, headers=bearer(token))
                self.assertEqual(response.status_code, 200)
                for secret in secrets_to_hide:
                    self.assertNotIn(secret, response.text)

    def test_settings_round_trip(self):
        settings = self.admin("GET", "/admin/settings").json()
        self.assertEqual(settings["default_daily_limit"], 4)
        self.assertEqual(settings["timezone"], "Asia/Dhaka")
        self.assertTrue(settings["email"]["configured"])
        self.assertEqual(settings["email"]["provider"], "brevo")
        self.assertTrue(settings["auth_secret_configured"])
        self.assertTrue(settings["schema"]["ready"])
        self.assertEqual(settings["frontend_url"], "https://app.unistream.test")

        _user_id, token, _password = self.active_user()
        response = self.admin("PUT", "/admin/settings", json={"default_daily_limit": 6})
        self.assertEqual(response.json()["default_daily_limit"], 6)
        self.assertEqual(self.client.get("/auth/me", headers=bearer(token)).json()["user"]["usage"]["limit"], 6)

        for value in (10001, -1, "lots", None):
            with self.subTest(value=value):
                response = self.admin("PUT", "/admin/settings", json={"default_daily_limit": value})
                self.assertEqual(response.status_code, 422)
                self.assertIn("default daily limit", response.json()["detail"])

    def test_test_email(self):
        response = self.admin("POST", "/admin/email/test", json={"to": "Admin@Example.com"})
        self.assertEqual(response.json(), {"sent": True})
        self.assertEqual(self.sent[-1]["to"], "admin@example.com")

        self.email_error = email_service.EmailError("Brevo rejected the request (401): Key not found")
        response = self.admin("POST", "/admin/email/test", json={"to": "admin@example.com"})
        self.assertEqual((response.status_code, response.json()["detail"]),
                         (502, "Brevo rejected the request (401): Key not found"))

    def test_schema_and_storage_reports(self):
        schema = self.admin("GET", "/admin/schema").json()
        self.assertEqual((schema["ready"], schema["missing"]), (True, []))
        self.assertIn("download_logs", schema["migration_sql"])

        report = self.admin("GET", "/admin/storage").json()
        self.assertEqual(report["active_backend"], "sqlite")
        self.assertTrue(report["schema"]["ready"])
        self.assertIn("yt_dlp_version", report)

    def test_overview_counts_and_chart(self):
        self.register(name="Pending One", email="p1@example.com", phone="01812345671", ip="198.51.100.21")
        self.active_user()
        today = security.local_today()
        midday = lambda day: security.local_midnight(day) + timedelta(hours=12)  # noqa: E731
        storage_logs = AdminLogTests.add_log
        for days_ago, platform in ((0, "YouTube"), (0, "Facebook"), (3, "Instagram"), (20, "YouTube"), (40, "YouTube")):
            storage_logs(self, midday(today - timedelta(days=days_ago)), platform=platform)

        overview = self.admin("GET", "/admin/overview").json()
        self.assertEqual(overview["users"], {"total": 2, "pending": 1, "approved": 1, "blocked": 0})
        downloads = overview["downloads"]
        self.assertEqual((downloads["today"], downloads["last_7_days"], downloads["last_30_days"]), (2, 3, 4))
        self.assertEqual(len(downloads["daily"]), 14)
        self.assertEqual(downloads["daily"][-1], {"date": today.isoformat(), "count": 2})
        self.assertEqual(downloads["daily"][-4], {"date": (today - timedelta(days=3)).isoformat(), "count": 1})
        self.assertEqual(downloads["daily"][0]["count"], 0)
        self.assertEqual(downloads["platforms"], {"YouTube": 2, "Facebook": 1, "Instagram": 1})
        self.assertEqual(overview["settings"], {"default_daily_limit": 4})
        system = overview["system"]
        self.assertEqual(
            (system["schema_ready"], system["storage"], system["persistent"], system["timezone"]),
            (True, "sqlite", False, "Asia/Dhaka"),
        )
        self.assertTrue(system["email"]["configured"])
        self.assertTrue(system["auth_secret_configured"])

    def test_outdated_supabase_schema_keeps_the_dashboard_usable(self):
        outdated = storage.SchemaOutdatedError("column users.password_hash does not exist")
        status = {"ready": False, "missing": ["users.password_hash"], "checked_at": "2026-10-06T00:00:00+00:00"}
        with patch.object(storage, "schema_status", return_value=status), \
                patch.object(storage, "download_stats", side_effect=outdated), \
                patch.object(storage, "get_setting", side_effect=outdated), \
                patch.object(storage, "get_user_by_id", side_effect=outdated):
            overview = self.admin("GET", "/admin/overview")
            settings = self.admin("GET", "/admin/settings")
            me = self.client.get("/auth/me", headers=bearer(security.create_token("1", "", "session", 60)))

        self.assertEqual(overview.status_code, 200)
        self.assertFalse(overview.json()["system"]["schema_ready"])
        self.assertEqual(overview.json()["settings"]["default_daily_limit"], 4)
        self.assertEqual(overview.json()["downloads"]["today"], 0)
        self.assertEqual(settings.status_code, 200)
        self.assertEqual(settings.json()["schema"]["missing"], ["users.password_hash"])
        self.assertEqual(me.status_code, 503)
        self.assertIn("Database upgrade required", me.json()["detail"])



class AdminAuthTests(ApiTestCase):
    NEW_PASSWORD = "Dhaka admin 2026"

    def change(self, token, current, new=NEW_PASSWORD, username=None, **extra):
        body = {"current_password": current, "new_password": new, **extra}
        if username is not None:
            body["new_username"] = username
        return self.client.post("/admin/auth/change-credentials", json=body, headers=bearer(token))

    def admin_login(self, username, password, ip="198.51.100.201", **extra):
        return self.client.post(
            "/admin/auth/login", json={"username": username, "password": password, **extra},
            headers={"x-forwarded-for": ip},
        )

    def set_credentials(self, username="owner", password=NEW_PASSWORD):
        token = self.admin_session()["token"]
        response = self.change(token, ADMIN_SECRET, password, username)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_first_sign_in_uses_admin_secret_and_must_change(self):
        before = datetime.now(timezone.utc)
        body = self.admin_session(username="  Admin ")
        self.assertEqual(set(body), {"token", "username", "must_change_password", "expires_at"})
        self.assertEqual((body["username"], body["must_change_password"]), ("admin", True))
        expires = datetime.fromisoformat(body["expires_at"])
        self.assertAlmostEqual((expires - before).total_seconds(), 12 * 3600, delta=60)

        token = body["token"]
        self.assertEqual(self.client.get("/admin/overview", headers=bearer(token)).status_code, 200)
        me = self.client.get("/admin/auth/me", headers=bearer(token))
        self.assertEqual(me.json(), {"username": "admin", "must_change_password": True, "recovery_mode": False})
        # The token payload names no secret.
        payload = json.loads(base64_decode(token.split(".")[0]))
        self.assertEqual(payload["purpose"], "admin")
        self.assertNotIn(ADMIN_SECRET, json.dumps(payload))

    def test_admin_password_env_replaces_the_secret_for_sign_in(self):
        with patch.dict(os.environ, {"ADMIN_PASSWORD": "bootstrap-pass-99", "ADMIN_USERNAME": "Owner"}):
            self.assertEqual(self.admin_login("admin", ADMIN_SECRET).status_code, 401)
            self.assertEqual(self.admin_login("owner", ADMIN_SECRET).status_code, 401)
            body = self.admin_login("owner", "bootstrap-pass-99").json()
            self.assertEqual((body["username"], body["must_change_password"]), ("owner", True))
            # ADMIN_SECRET is still the API key.
            self.assertEqual(self.admin("GET", "/admin/overview").status_code, 200)

    def test_wrong_credentials_get_one_answer(self):
        answers = [
            self.admin_login("admin", "wrong-password", ip="198.51.100.211"),
            self.admin_login("nobody", ADMIN_SECRET, ip="198.51.100.212"),
            self.admin_login("admin", ADMIN_SECRET + "x", ip="198.51.100.213"),
        ]
        for response in answers:
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json(), {"detail": "Incorrect username or password."})

    def test_wrong_credentials_still_spend_a_password_hash(self):
        with patch.object(security, "verify_password", wraps=security.verify_password) as verify:
            self.admin_login("nobody", "whatever-123")
        verify.assert_called_once_with("whatever-123", None)

    def test_change_credentials_ends_bootstrap_and_every_old_session(self):
        first = self.admin_session()["token"]
        second = self.admin_session(remember=True)["token"]

        response = self.change(first, ADMIN_SECRET, username="Owner.BD")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["username"], body["must_change_password"]), ("owner.bd", False))
        new_token = body["token"]

        stored = storage.get_setting("admin_password_hash")
        self.assertTrue(stored.startswith("scrypt$"))
        self.assertEqual(storage.get_setting("admin_username"), "owner.bd")
        self.assertNotIn(stored, response.text)

        for old in (first, second):
            response = self.client.get("/admin/overview", headers=bearer(old))
            self.assertEqual((response.status_code, response.json()["detail"]), (401, ADMIN_EXPIRED))
        me = self.client.get("/admin/auth/me", headers=bearer(new_token)).json()
        self.assertEqual(me, {"username": "owner.bd", "must_change_password": False, "recovery_mode": False})

        # The bootstrap password no longer signs in; the new credentials do.
        self.assertEqual(self.admin_login("admin", ADMIN_SECRET).status_code, 401)
        self.assertEqual(self.admin_login("owner.bd", ADMIN_SECRET).status_code, 401)
        self.assertEqual(self.admin_login("admin", self.NEW_PASSWORD).status_code, 401)
        login = self.admin_login("OWNER.BD", self.NEW_PASSWORD)
        self.assertEqual(login.status_code, 200)
        self.assertFalse(login.json()["must_change_password"])
        # ...and the API key keeps working for scripts.
        self.assertEqual(self.admin("GET", "/admin/overview").status_code, 200)

    def test_change_keeps_the_keep_me_signed_in_choice(self):
        remembered = self.admin_session(remember=True)
        before = datetime.now(timezone.utc)
        self.assertAlmostEqual(
            (datetime.fromisoformat(remembered["expires_at"]) - before).total_seconds(), 7 * 86400, delta=60,
        )
        body = self.change(remembered["token"], ADMIN_SECRET).json()
        self.assertAlmostEqual(
            (datetime.fromisoformat(body["expires_at"]) - before).total_seconds(), 7 * 86400, delta=60,
        )
        # Changing the username is optional: empty keeps it.
        body = self.change(body["token"], self.NEW_PASSWORD, "Second pass 2026", username="").json()
        self.assertEqual(body["username"], "admin")

    def test_change_credentials_validation(self):
        token = self.admin_session()["token"]
        cases = [
            ({"current": "not-it-123"}, 400, "Your current password is incorrect."),
            ({"new": ADMIN_SECRET}, 400, "Your new password must be different from your current password."),
            ({"new": "short1"}, 422, "Admin password must be at least 10 characters."),
            ({"new": "onlyletters"}, 422, "Admin password must include at least one letter and one number."),
            ({"new": "a1" * 65}, 422, "Admin password must be at most 128 characters."),
            ({"username": "ab"}, 422, "Username must be at least 3 characters."),
            ({"username": "x" * 33}, 422, "Username must be at most 32 characters."),
            ({"username": "bad user!"}, 422,
             "Username can only contain letters, numbers, dots, dashes and underscores."),
        ]
        for change, status, detail in cases:
            with self.subTest(change=change):
                response = self.change(
                    token, change.get("current", ADMIN_SECRET), change.get("new", self.NEW_PASSWORD),
                    change.get("username"),
                )
                self.assertEqual((response.status_code, response.json()["detail"]), (status, detail))
        response = self.change(token, ADMIN_SECRET, extra_field=True)
        self.assertEqual(response.status_code, 422)
        # Nothing was saved by the failed attempts.
        self.assertIsNone(storage.get_setting("admin_password_hash"))

    def test_new_password_may_not_be_a_bootstrap_secret(self):
        token = self.set_credentials()["token"]
        response = self.change(token, self.NEW_PASSWORD, ADMIN_SECRET)
        self.assertEqual(response.status_code, 400)
        self.assertIn("ADMIN_SECRET", response.json()["detail"])

    def test_new_password_may_not_be_admin_secret_when_admin_password_is_used(self):
        with patch.dict(os.environ, {"ADMIN_PASSWORD": "bootstrap-pass-99"}):
            token = self.admin_session(password="bootstrap-pass-99")["token"]
            response = self.change(token, "bootstrap-pass-99", ADMIN_SECRET)
        self.assertEqual(response.status_code, 400)
        self.assertIn("ADMIN_SECRET", response.json()["detail"])

    def test_wrong_current_passwords_are_limited(self):
        token = self.admin_session()["token"]
        limit, _window = admin_auth_router.CHANGE_FAILURES
        for _ in range(limit):
            self.assertEqual(self.change(token, "wrong-pass-1").status_code, 400)
        response = self.change(token, ADMIN_SECRET)
        self.assertEqual(response.status_code, 429)
        self.assertRegex(response.json()["detail"], r"Try again in \d+ minutes")

    def test_api_key_cannot_change_credentials(self):
        response = self.admin("POST", "/admin/auth/change-credentials", json={
            "current_password": ADMIN_SECRET, "new_password": self.NEW_PASSWORD,
        })
        self.assertEqual(response.status_code, 403)
        me = self.admin("GET", "/admin/auth/me").json()
        self.assertEqual(me, {"username": "admin", "must_change_password": True, "recovery_mode": False})
        self.set_credentials()
        self.assertFalse(self.admin("GET", "/admin/auth/me").json()["must_change_password"])

    def test_recovery_mode_reopens_the_bootstrap_password(self):
        self.set_credentials(username="owner")
        with patch.dict(os.environ, {"ADMIN_RESET_PASSWORD": "true"}):
            # The default username works too, in case the owner forgot theirs.
            for username in ("admin", "owner"):
                body = self.admin_login(username, ADMIN_SECRET).json()
                self.assertEqual((body["username"], body["must_change_password"]), ("owner", True))
            recovery_token = body["token"]
            me = self.client.get("/admin/auth/me", headers=bearer(recovery_token)).json()
            self.assertEqual(me, {"username": "owner", "must_change_password": True, "recovery_mode": True})
            # The saved password still works and needs no change.
            saved = self.admin_login("owner", self.NEW_PASSWORD).json()
            self.assertFalse(saved["must_change_password"])

            response = self.change(recovery_token, ADMIN_SECRET, "Recovered pass 2026")
            self.assertEqual(response.status_code, 200, response.text)
            new_token = response.json()["token"]
            self.assertFalse(response.json()["must_change_password"])
            for old in (recovery_token, saved["token"]):
                self.assertEqual(self.client.get("/admin/auth/me", headers=bearer(old)).status_code, 401)
            me = self.client.get("/admin/auth/me", headers=bearer(new_token)).json()
            self.assertEqual(me, {"username": "owner", "must_change_password": False, "recovery_mode": True})

        # Without the flag, only the new password signs in.
        self.assertEqual(self.admin_login("owner", ADMIN_SECRET).status_code, 401)
        self.assertEqual(self.admin_login("owner", "Recovered pass 2026").status_code, 200)
        self.assertEqual(self.client.get("/admin/auth/me", headers=bearer(new_token)).status_code, 200)

    def test_sign_in_is_limited_per_username_and_per_ip(self):
        limit, _window = admin_auth_router.LOGIN_ATTEMPTS_PER_USERNAME
        for attempt in range(limit):
            self.assertEqual(self.admin_login("admin", "wrong-pass-1", ip=f"192.0.2.{attempt}").status_code, 401)
            self.assertEqual(self.admin_login("ghost", "wrong-pass-1", ip=f"192.0.2.{attempt + 50}").status_code, 401)
        locked = self.admin_login("admin", ADMIN_SECRET, ip="192.0.2.100")
        unknown = self.admin_login("ghost", ADMIN_SECRET, ip="192.0.2.101")
        self.assertEqual((locked.status_code, unknown.status_code), (429, 429))
        # A lockout does not reveal whether the username exists.
        self.assertEqual(locked.json(), unknown.json())
        self.assertRegex(locked.json()["detail"], r"^Too many sign-in attempts\. Try again in \d+ minutes\.$")
        self.assertIn("Retry-After", locked.headers)

        ip_limit, _window = admin_auth_router.LOGIN_FAILURES_PER_IP
        for index in range(ip_limit):
            self.assertEqual(self.admin_login(f"user{index}", "wrong-pass-1", ip="192.0.2.150").status_code, 401)
        self.assertEqual(self.admin_login("other", ADMIN_SECRET, ip="192.0.2.150").status_code, 429)
        self.assertEqual(self.admin_login("other", "wrong-pass-1", ip="192.0.2.151").status_code, 401)

    def test_successful_sign_ins_are_not_limited(self):
        for _ in range(8):
            self.admin_session(ip="192.0.2.160")

    def test_sign_in_works_while_the_database_needs_its_upgrade(self):
        self.set_credentials()
        outdated = storage.SchemaOutdatedError("relation app_settings does not exist")
        admin_account.forget_cached_state()
        with patch.object(storage, "get_setting", side_effect=outdated), \
                patch.object(storage, "set_settings", side_effect=outdated):
            body = self.admin_session()
            self.assertTrue(body["must_change_password"])
            token = body["token"]
            me = self.client.get("/admin/auth/me", headers=bearer(token))
            self.assertEqual(me.status_code, 200)
            self.assertTrue(me.json()["must_change_password"])
            schema = self.client.get("/admin/schema", headers=bearer(token))
            self.assertEqual(schema.status_code, 200)
            self.assertIn("download_logs", schema.json()["migration_sql"])
            response = self.change(token, ADMIN_SECRET)
            self.assertEqual(response.status_code, 503)
            self.assertIn("database upgrade", response.json()["detail"])

    def test_a_damaged_stored_hash_falls_back_to_bootstrap(self):
        storage.set_settings({"admin_username": "owner", "admin_password_hash": "scrypt$broken"})
        body = self.admin_session(username="owner")
        self.assertTrue(body["must_change_password"])

    def test_sessions_survive_a_brief_database_outage(self):
        token = self.set_credentials()["token"]
        down = storage.StorageUnavailableError("Persistent storage is temporarily unavailable.")
        with patch.object(storage, "get_setting", side_effect=down):
            response = self.client.get("/admin/auth/me", headers=bearer(token))
            self.assertEqual(response.status_code, 200)
            # The bootstrap password does not reopen while the saved one is known.
            self.assertEqual(self.admin_login("owner", ADMIN_SECRET).status_code, 401)

    def test_admin_and_user_tokens_are_not_interchangeable(self):
        user_id, user_token, _password = self.active_user()
        admin_token = self.admin_session()["token"]
        self.assertEqual(self.client.get("/auth/me", headers=bearer(admin_token)).status_code, 401)
        response = self.client.get("/admin/overview", headers=bearer(user_token))
        self.assertEqual((response.status_code, response.json()["detail"]), (401, ADMIN_EXPIRED))
        pv = security.password_version(storage.get_user_by_id(user_id)["password_hash"])
        for purpose in ("session", "reset", "download"):
            forged = security.create_token("admin", pv, purpose, 600)
            self.assertEqual(self.client.get("/admin/overview", headers=bearer(forged)).status_code, 401)
        # An admin-purpose token for another subject or an old password version is refused.
        other_subject = security.create_token(user_id, "", "admin", 600)
        stale = security.create_token("admin", "boot-0000000000000000", "admin", 600)
        for token in (other_subject, stale):
            self.assertEqual(self.client.get("/admin/overview", headers=bearer(token)).status_code, 401)

    def test_login_body_is_validated(self):
        self.assertEqual(self.client.post("/admin/auth/login", json={}).status_code, 422)
        cases = [
            {"username": "admin", "password": "p" * 257},
            {"username": "a" * 65, "password": ADMIN_SECRET},
            {"username": "admin", "password": ADMIN_SECRET, "secret": "x"},
        ]
        for body in cases:
            with self.subTest(body=str(body)[:40]):
                response = self.client.post("/admin/auth/login", json=body)
                self.assertEqual(response.status_code, 422)
                self.assertIsInstance(response.json()["detail"], str)


def base64_decode(text):
    import base64
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class AdminRouteAuditTests(ApiTestCase):
    """Every /admin route requires an admin; nothing deletes on GET."""

    def admin_routes(self):
        from fastapi.routing import APIRoute
        return [route for route in main.app.routes
                if isinstance(route, APIRoute) and route.path.startswith("/admin")]

    @staticmethod
    def calls(dependant):
        for sub in dependant.dependencies:
            yield sub.call
            yield from AdminRouteAuditTests.calls(sub)

    def test_every_admin_route_depends_on_require_admin(self):
        routes = self.admin_routes()
        self.assertGreater(len(routes), 20)
        for route in routes:
            with self.subTest(path=route.path, methods=route.methods):
                guarded = admin_account.require_admin in set(self.calls(route.dependant))
                self.assertEqual(guarded, route.path != "/admin/auth/login")

    def test_every_admin_route_refuses_anonymous_requests(self):
        for route in self.admin_routes():
            if route.path == "/admin/auth/login":
                continue
            path = route.path.replace("{user_id}", "1").replace("{log_id}", "1")
            for method in route.methods:
                with self.subTest(method=method, path=path):
                    kwargs = {"json": {}} if method in {"POST", "PUT", "PATCH"} else {}
                    response = self.client.request(method, path, **kwargs)
                    self.assertEqual(response.status_code, 401, response.text)
                    self.assertEqual(response.json()["detail"], ADMIN_EXPIRED)
                    user_token = security.create_token("1", "", "session", 600)
                    response = self.client.request(method, path, headers=bearer(user_token), **kwargs)
                    self.assertEqual(response.status_code, 401)

    def test_no_get_route_deletes(self):
        for route in self.admin_routes():
            if "GET" in route.methods:
                with self.subTest(path=route.path):
                    self.assertFalse(any(word in route.path for word in ("delete", "purge", "reset", "bulk")))
        deleting = sorted(route.path for route in self.admin_routes() if "DELETE" in route.methods)
        self.assertEqual(deleting, ["/admin/logs/{log_id}", "/admin/users/{user_id}"])


class HttpHardeningTests(ApiTestCase):
    def test_security_headers_on_every_response(self):
        _user_id, token, _password = self.active_user()
        responses = [
            self.client.get("/"),
            self.client.get("/auth/me", headers=bearer(token)),
            self.client.get("/auth/me"),
            self.admin("GET", "/admin/settings"),
            self.client.post("/auth/login", json={}),
        ]
        for response in responses:
            with self.subTest(status=response.status_code, url=str(response.url)):
                self.assertEqual(response.headers["x-content-type-options"], "nosniff")
                self.assertEqual(response.headers["x-frame-options"], "DENY")
                self.assertEqual(response.headers["referrer-policy"], "no-referrer")
                self.assertEqual(response.headers["cache-control"], "no-store")

    def test_sse_keeps_its_own_cache_header(self):
        events = self.client.get("/download/progress")
        self.assertEqual(events.headers["cache-control"], "no-cache, no-transform")
        self.assertEqual(events.headers["x-content-type-options"], "nosniff")

    def test_cors_allows_only_the_frontend_without_credentials(self):
        allowed = "http://localhost:3000"
        preflight = self.client.options("/auth/login", headers={
            "Origin": allowed,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization, content-type",
        })
        self.assertEqual(preflight.status_code, 200)
        self.assertEqual(preflight.headers["access-control-allow-origin"], allowed)
        self.assertNotIn("access-control-allow-credentials", preflight.headers)
        methods = {m.strip() for m in preflight.headers["access-control-allow-methods"].split(",")}
        self.assertEqual(methods, {"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"})

        evil = self.client.options("/auth/login", headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
        })
        self.assertEqual(evil.status_code, 400)
        self.assertNotIn("access-control-allow-origin", evil.headers)
        odd_header = self.client.options("/auth/login", headers={
            "Origin": allowed,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-something-else",
        })
        self.assertEqual(odd_header.status_code, 400)
        simple = self.client.get("/", headers={"Origin": "https://evil.example"})
        self.assertNotIn("access-control-allow-origin", simple.headers)

    def test_allowed_origins_come_from_frontend_url(self):
        with patch.dict(os.environ, {"FRONTEND_URL": "https://unistream.example/, app.example.org"}):
            self.assertEqual(
                main._allowed_origins(),
                ["http://localhost:3000", "https://unistream.example", "https://app.example.org"],
            )

    def test_unexpected_errors_are_generic_500s(self):
        _user_id, token, _password = self.active_user()
        boom = RuntimeError("relation users has password=hunter2 at /srv/secret.py line 3")
        with patch.object(storage, "get_user_by_id", side_effect=boom), \
                self.assertLogs("main", level="ERROR") as logs:
            response = TestClient(main.app, raise_server_exceptions=False).get("/auth/me", headers=bearer(token))
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {"detail": main.INTERNAL_ERROR_MESSAGE})
        self.assertNotIn("hunter2", response.text)
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertIn("hunter2", "".join(logs.output))  # the details stay in the server log

    def test_oversized_bodies_are_refused(self):
        response = self.client.post(
            "/auth/login", content=b'{"login": "' + b"a" * (2 * 1024 * 1024) + b'"}',
            headers={"content-type": "application/json"},
        )
        self.assertEqual((response.status_code, response.json()["detail"]), (413, "This request is too large."))

        def chunks():
            yield b'{"login": "'
            for _ in range(40):
                yield b"a" * 65536
            yield b'"}'

        response = self.client.post("/auth/login", content=chunks(), headers={"content-type": "application/json"})
        self.assertEqual(response.status_code, 413)


class InputLimitTests(ApiTestCase):
    def test_registration_fields_have_maximum_lengths(self):
        cases = [
            ({"name": "A" * 81}, "Name must be at most 80 characters."),
            ({"email": "a" * 64 + "@" + "b" * 190 + ".com"}, "Email is too long."),
            ({"phone": "+880 1712 345 678 999"}, "Phone number must be at most 20 characters."),
            ({"note": "n" * 121}, "Institution / department must be at most 120 characters."),
            ({"agree": True}, "Unexpected field: Agree."),
        ]
        for change, message in cases:
            with self.subTest(change=str(change)[:30]):
                body = {"name": "Rahim Uddin", "email": "rahim@example.com", "phone": "01712345678", **change}
                response = self.client.post("/auth/register", json=body)
                self.assertEqual((response.status_code, response.json()["detail"]), (422, message))

    def test_sign_in_and_password_fields_have_maximum_lengths(self):
        response = self.client.post("/auth/login", json={"login": "a" * 250 + "@x.com", "password": "Password1"})
        self.assertEqual((response.status_code, response.json()["detail"]),
                         (422, "Email or phone must be at most 254 characters."))
        response = self.client.post("/auth/login", json={"login": "a@example.com", "password": "p1" * 65})
        self.assertEqual((response.status_code, response.json()["detail"]),
                         (422, "Password must be at most 128 characters."))
        response = self.client.post("/auth/reset-password", json={"token": "t" * 2049, "password": "Fresh pass 99"})
        self.assertEqual(response.status_code, 422)
        response = self.client.post("/auth/forgot-password", json={"email": "a@example.com", "extra": 1})
        self.assertEqual(response.status_code, 422)

        _user_id, token, password = self.active_user()
        response = self.client.post("/auth/change-password", headers=bearer(token),
                                    json={"current_password": password, "new_password": "Ab1" * 43})
        self.assertEqual((response.status_code, response.json()["detail"]),
                         (422, "Password must be at most 128 characters."))
        response = self.client.post("/video-info", headers=bearer(token),
                                    json={"url": "https://youtu.be/" + "a" * 2040})
        self.assertEqual(response.status_code, 422)
        response = self.client.post("/video-info", headers=bearer(token),
                                    json={"url": FACEBOOK_URL, "identifier": "rahim@example.com"})
        self.assertEqual(response.status_code, 422)

    def test_admin_fields_have_maximum_lengths(self):
        user = self.admin("POST", "/admin/users", json={
            "name": "Karim Ahmed", "email": "karim@example.com", "phone": "01612345678", "send_credentials": False,
        }).json()["user"]
        response = self.admin("PATCH", f"/admin/users/{user['id']}", json={"note": "n" * 301})
        self.assertEqual((response.status_code, response.json()["detail"]),
                         (422, "Note must be at most 300 characters."))
        self.assertEqual(self.admin("PATCH", f"/admin/users/{user['id']}", json={"note": "n" * 300}).status_code, 200)
        self.assertEqual(self.admin("PATCH", f"/admin/users/{user['id']}", json={"status": "approved"}).status_code, 422)
        long_id = "1" * 65
        self.assertEqual(self.admin("PATCH", f"/admin/users/{long_id}", json={"name": "X Y"}).status_code, 422)
        self.assertEqual(self.admin("DELETE", f"/admin/users/{long_id}").status_code, 422)
        self.assertEqual(self.admin("DELETE", f"/admin/logs/{long_id}").status_code, 422)
        response = self.admin("POST", "/admin/users/bulk", json={"ids": [long_id], "action": "block"})
        self.assertEqual((response.status_code, response.json()["detail"]), (422, "User ID is not valid."))
        response = self.admin("POST", "/admin/logs/delete", json={"ids": [long_id]})
        self.assertEqual((response.status_code, response.json()["detail"]), (422, "Log ID is not valid."))
        response = self.admin("POST", "/admin/logs/purge", json={"all": True, "confirm": "DELETE"})
        self.assertEqual(response.status_code, 422)

    def test_youtube_check_only_probes_supported_sites(self):
        for url in ("http://127.0.0.1:8000/admin", "https://evil.example/watch?v=1", "https://youtube.com@evil.example/"):
            with self.subTest(url=url):
                response = self.admin("GET", "/admin/youtube-check", params={"url": url})
                self.assertEqual((response.status_code, response.json()["detail"]),
                                 (400, "Enter a YouTube, Facebook or Instagram video link to check."))

    def test_download_check_runs_the_real_facebook_extraction(self):
        seen = []

        class FakeYoutubeDL:
            def __init__(self, options):
                seen.append(options)

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def extract_info(self, url, download):
                return {"formats": [
                    {"format_id": "v", "height": 720, "vcodec": "vp09", "acodec": "none", "protocol": "https"},
                    {"format_id": "a", "vcodec": "none", "acodec": "mp4a"},
                ]}

        url = "https://www.facebook.com/watch/?v=647537299265662"
        no_cookies = {"FACEBOOK_COOKIES_BASE64": "", "INSTAGRAM_COOKIES_BASE64": ""}
        with patch.object(yt_dlp, "YoutubeDL", FakeYoutubeDL), patch.dict(os.environ, no_cookies):
            response = self.admin("GET", "/admin/youtube-check", params={"url": url})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        report = body["clients"]["facebook — no cookies configured"]["facebook"]
        self.assertEqual((report["heights"], report["audio_stream"]), ([720], True))
        self.assertEqual(body["social_cookies"], {"instagram": False, "facebook": False})
        # Only the supported extractors, as for a real download.
        self.assertNotIn("generic", seen[0]["allowed_extractors"])


class AuthRateLimitTests(ApiTestCase):
    def test_reset_attempts_are_limited_per_ip(self):
        limit, _window = auth_router.RESET_PER_IP
        headers = {"x-forwarded-for": "192.0.2.90"}
        for _ in range(limit):
            response = self.client.post("/auth/reset-password", headers=headers,
                                        json={"token": "nonsense", "password": "Fresh pass 99"})
            self.assertEqual(response.status_code, 400)
        response = self.client.post("/auth/reset-password", headers=headers,
                                    json={"token": "nonsense", "password": "Fresh pass 99"})
        self.assertEqual(response.status_code, 429)

    def test_change_password_is_limited_per_user(self):
        _user_id, token, password = self.active_user()
        limit, _window = auth_router.CHANGE_PASSWORD_PER_USER
        for _ in range(limit):
            response = self.client.post("/auth/change-password", headers=bearer(token),
                                        json={"current_password": "wrong-pass-1", "new_password": "Another pass 7"})
            self.assertEqual(response.status_code, 400)
        response = self.client.post("/auth/change-password", headers=bearer(token),
                                    json={"current_password": password, "new_password": "Another pass 7"})
        self.assertEqual(response.status_code, 429)
        self.assertRegex(response.json()["detail"], r"Try again in \d+ minutes")

    def test_sign_in_lockouts_do_not_reveal_accounts(self):
        self.active_user()
        limit, _window = auth_router.LOGIN_ATTEMPTS_PER_LOGIN
        for index in range(limit):
            self.login("rahim@example.com", "wrong-pass-1", ip=f"192.0.2.{index}")
            self.login("nobody@example.com", "wrong-pass-1", ip=f"192.0.2.{index + 100}")
        existing = self.login("rahim@example.com", "wrong-pass-1", ip="192.0.2.250")
        unknown = self.login("nobody@example.com", "wrong-pass-1", ip="192.0.2.251")
        self.assertEqual((existing.status_code, unknown.status_code), (429, 429))
        self.assertEqual(existing.json(), unknown.json())

    def test_auth_endpoints_share_a_per_ip_cap(self):
        with patch.object(dependencies, "AUTH_REQUESTS_PER_IP", (3, 900)):
            headers = {"x-forwarded-for": "192.0.2.180"}
            for _ in range(2):
                self.client.post("/auth/forgot-password", json={"email": "a@example.com"}, headers=headers)
            self.client.post("/admin/auth/login", json={"username": "x", "password": "y"}, headers=headers)
            response = self.client.post("/auth/login", json={"login": "a@example.com", "password": "Password1"},
                                        headers=headers)
            self.assertEqual(response.status_code, 429)
            self.assertIn("from your network", response.json()["detail"])
            # Reading the session is not capped, and other networks are unaffected.
            self.assertEqual(self.client.get("/auth/me", headers=headers).status_code, 401)
            other = self.client.post("/auth/forgot-password", json={"email": "a@example.com"},
                                     headers={"x-forwarded-for": "192.0.2.181"})
            self.assertEqual(other.status_code, 200)

if __name__ == "__main__":
    unittest.main()
