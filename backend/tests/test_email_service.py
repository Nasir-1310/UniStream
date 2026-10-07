import os
import smtplib
import socket
import unittest
from email import message_from_bytes
from email.policy import default as default_policy
from unittest.mock import patch

import httpx

import email_service


EMAIL_ENV_KEYS = (
    "EMAIL_PROVIDER", "EMAIL_FROM", "EMAIL_FROM_NAME", "BREVO_API_KEY", "RESEND_API_KEY",
    "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_SSL", "FRONTEND_URL",
    "APP_TIMEZONE",
)


def email_env(**values):
    """Patch os.environ so only the given email settings are present."""
    env = {key: "" for key in EMAIL_ENV_KEYS}
    env.update(values)
    return patch.dict(os.environ, env)


def response(status: int, body=None, text: str | None = None) -> httpx.Response:
    request = httpx.Request("POST", "https://example.invalid/")
    if text is not None:
        return httpx.Response(status, text=text, request=request)
    return httpx.Response(status, json=body if body is not None else {}, request=request)


class FakeSMTP:
    """Records the conversation instead of opening a socket."""

    instances: list["FakeSMTP"] = []
    fail_with: Exception | None = None

    def __init__(self, host, port, timeout=None, context=None, **_kwargs):
        self.host, self.port, self.timeout, self.context = host, port, timeout, context
        self.calls: list[str] = []
        self.logged_in = None
        self.sent = None
        FakeSMTP.instances.append(self)
        if FakeSMTP.fail_with is not None:
            raise FakeSMTP.fail_with

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.calls.append("quit")
        return False

    def ehlo(self):
        self.calls.append("ehlo")

    def starttls(self, context=None):
        self.calls.append("starttls")
        self.tls_context = context

    def login(self, user, password):
        self.calls.append("login")
        self.logged_in = (user, password)

    def send_message(self, message):
        self.calls.append("send")
        self.sent = message


class NoNetworkTestCase(unittest.TestCase):
    """Fails loudly if anything tries to open a real connection."""

    def setUp(self):
        def refuse(*_args, **_kwargs):
            raise AssertionError("tests must not touch the network")

        guards = [
            patch.object(socket, "create_connection", side_effect=refuse),
            patch.object(httpx.Client, "send", side_effect=refuse),
        ]
        for guard in guards:
            guard.start()
            self.addCleanup(guard.stop)
        FakeSMTP.instances = []
        FakeSMTP.fail_with = None


class AppUrlTests(unittest.TestCase):
    def test_default_and_normalisation(self):
        with email_env():
            self.assertEqual(email_service.app_url(), "http://localhost:3000")
        with email_env(FRONTEND_URL="https://unistream.vercel.app/"):
            self.assertEqual(email_service.app_url(), "https://unistream.vercel.app")
        with email_env(FRONTEND_URL="unistream.vercel.app"):
            self.assertEqual(email_service.app_url(), "https://unistream.vercel.app")
        with email_env(FRONTEND_URL=" https://a.example , https://b.example "):
            self.assertEqual(email_service.app_url(), "https://a.example")


class EmailStatusTests(unittest.TestCase):
    def test_not_configured(self):
        with email_env():
            status = email_service.email_status()
        self.assertFalse(status["configured"])
        self.assertIsNone(status["provider"])
        self.assertIsNone(status["from_email"])
        self.assertEqual(status["from_name"], "UniStream Saver")
        self.assertIn("BREVO_API_KEY", status["issue"])

    def test_auto_prefers_brevo_then_resend_then_smtp(self):
        with email_env(EMAIL_FROM="admin@example.com", BREVO_API_KEY="k1", RESEND_API_KEY="k2", SMTP_HOST="h"):
            self.assertEqual(email_service.email_status()["provider"], "brevo")
        with email_env(EMAIL_FROM="admin@example.com", RESEND_API_KEY="k2", SMTP_HOST="h"):
            self.assertEqual(email_service.email_status()["provider"], "resend")
        with email_env(EMAIL_FROM="admin@example.com", SMTP_HOST="h"):
            status = email_service.email_status()
        self.assertEqual(status["provider"], "smtp")
        self.assertTrue(status["configured"])
        self.assertIsNone(status["issue"])

    def test_explicit_provider_and_missing_pieces(self):
        with email_env(EMAIL_PROVIDER="resend", EMAIL_FROM="a@example.com", BREVO_API_KEY="k"):
            status = email_service.email_status()
        self.assertEqual(status["provider"], "resend")
        self.assertFalse(status["configured"])
        self.assertIn("RESEND_API_KEY", status["issue"])

        with email_env(BREVO_API_KEY="k"):
            status = email_service.email_status()
        self.assertFalse(status["configured"])
        self.assertIn("EMAIL_FROM", status["issue"])

        with email_env(BREVO_API_KEY="k", EMAIL_FROM="not-an-address"):
            self.assertIn("not a valid", email_service.email_status()["issue"])

        with email_env(EMAIL_PROVIDER="smtp", SMTP_HOST="h", SMTP_USER="u", EMAIL_FROM="a@example.com"):
            self.assertIn("SMTP_PASSWORD", email_service.email_status()["issue"])

        with email_env(EMAIL_PROVIDER="smtp", SMTP_HOST="h", SMTP_PORT="abc", EMAIL_FROM="a@example.com"):
            self.assertIn("SMTP_PORT", email_service.email_status()["issue"])

        with email_env(EMAIL_PROVIDER="carrier-pigeon", BREVO_API_KEY="k", EMAIL_FROM="a@example.com"):
            status = email_service.email_status()
        self.assertFalse(status["configured"])
        self.assertIn("EMAIL_PROVIDER", status["issue"])

    def test_none_disables_sending(self):
        with email_env(EMAIL_PROVIDER="none", BREVO_API_KEY="k", EMAIL_FROM="a@example.com"):
            status = email_service.email_status()
        self.assertFalse(status["configured"])
        self.assertIsNone(status["provider"])

    def test_sender_name_and_address_forms(self):
        with email_env(BREVO_API_KEY="k", EMAIL_FROM="UniStream Team <Team@Example.com>"):
            status = email_service.email_status()
        self.assertEqual(status["from_email"], "team@example.com")
        self.assertEqual(status["from_name"], "UniStream Team")
        with email_env(BREVO_API_KEY="k", EMAIL_FROM="team@example.com", EMAIL_FROM_NAME='Uni "Saver" <x>, Inc'):
            self.assertEqual(email_service.email_status()["from_name"], "Uni Saver x Inc")

    def test_status_never_contains_secrets(self):
        with email_env(BREVO_API_KEY="xkeysib-SECRET", EMAIL_FROM="a@example.com", SMTP_PASSWORD="pw-SECRET"):
            self.assertNotIn("SECRET", repr(email_service.email_status()))


class BrevoTests(NoNetworkTestCase):
    def test_sends_expected_request(self):
        with email_env(BREVO_API_KEY="xkeysib-123", EMAIL_FROM="admin@example.com"), \
                patch.object(email_service.httpx, "post", return_value=response(201, {"messageId": "m"})) as post:
            email_service.send_email("student@gmail.com", "Hello\r\nBcc: x@evil.com", "<p>Hi</p>", "Hi")
        url = post.call_args.args[0]
        kwargs = post.call_args.kwargs
        self.assertEqual(url, "https://api.brevo.com/v3/smtp/email")
        self.assertEqual(kwargs["headers"]["api-key"], "xkeysib-123")
        self.assertEqual(kwargs["timeout"], 15.0)
        payload = kwargs["json"]
        self.assertEqual(payload["sender"], {"name": "UniStream Saver", "email": "admin@example.com"})
        self.assertEqual(payload["to"], [{"email": "student@gmail.com"}])
        self.assertEqual(payload["subject"], "Hello Bcc: x@evil.com")
        self.assertEqual(payload["htmlContent"], "<p>Hi</p>")
        self.assertEqual(payload["textContent"], "Hi")

    def test_errors_are_short_and_do_not_leak_the_key(self):
        cases = [
            (response(401, {"code": "unauthorized", "message": "Key not found"}), "BREVO_API_KEY"),
            (response(400, {"code": "invalid_parameter", "message": "sender xkeysib-123 is not valid"}), "HTTP 400"),
            (response(429, {"message": "Too many"}), "HTTP 429"),
            (response(500, text="<html>oops</html>"), "HTTP 500"),
        ]
        for resp, expected in cases:
            with self.subTest(status=resp.status_code), \
                    email_env(BREVO_API_KEY="xkeysib-123", EMAIL_FROM="admin@example.com"), \
                    patch.object(email_service.httpx, "post", return_value=resp), \
                    self.assertLogs("email_service", level="WARNING"):
                with self.assertRaises(email_service.EmailError) as ctx:
                    email_service.send_email("student@gmail.com", "S", "<p>h</p>", "t")
            self.assertIn(expected, str(ctx.exception))
            self.assertNotIn("xkeysib-123", str(ctx.exception))
            self.assertLess(len(str(ctx.exception)), 260)

    def test_timeouts_and_connection_errors(self):
        for exc, expected in (
            (httpx.ReadTimeout("slow"), "did not respond within 15 seconds"),
            (httpx.ConnectError("dns"), "Could not reach Brevo"),
        ):
            with self.subTest(exc=type(exc).__name__), \
                    email_env(BREVO_API_KEY="k", EMAIL_FROM="admin@example.com"), \
                    patch.object(email_service.httpx, "post", side_effect=exc), \
                    self.assertLogs("email_service", level="WARNING"):
                with self.assertRaises(email_service.EmailError) as ctx:
                    email_service.send_email("student@gmail.com", "S", "h", "t")
            self.assertIn(expected, str(ctx.exception))


class ResendTests(NoNetworkTestCase):
    def test_sends_expected_request(self):
        with email_env(RESEND_API_KEY="re_123", EMAIL_FROM="noreply@uni.example", EMAIL_FROM_NAME="UniStream"), \
                patch.object(email_service.httpx, "post", return_value=response(200, {"id": "x"})) as post:
            email_service.send_email("student@gmail.com", "S", "<p>h</p>", "t")
        self.assertEqual(post.call_args.args[0], "https://api.resend.com/emails")
        kwargs = post.call_args.kwargs
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer re_123")
        self.assertEqual(kwargs["json"]["from"], "UniStream <noreply@uni.example>")
        self.assertEqual(kwargs["json"]["to"], ["student@gmail.com"])
        self.assertEqual(kwargs["json"]["html"], "<p>h</p>")
        self.assertEqual(kwargs["json"]["text"], "t")

    def test_domain_error_is_reported(self):
        body = {"statusCode": 403, "name": "validation_error", "message": "The uni.example domain is not verified."}
        with email_env(RESEND_API_KEY="re_123", EMAIL_FROM="noreply@uni.example"), \
                patch.object(email_service.httpx, "post", return_value=response(403, body)), \
                self.assertLogs("email_service", level="WARNING"):
            with self.assertRaises(email_service.EmailError) as ctx:
                email_service.send_email("student@gmail.com", "S", "h", "t")
        self.assertIn("domain is not verified", str(ctx.exception))


class SmtpTests(NoNetworkTestCase):
    def _send(self, **env):
        values = {"SMTP_HOST": "smtp.example.com", "EMAIL_FROM": "admin@example.com"}
        values.update(env)
        with email_env(**values), \
                patch.object(email_service.smtplib, "SMTP", FakeSMTP), \
                patch.object(email_service.smtplib, "SMTP_SSL", FakeSMTP):
            email_service.send_email("student@gmail.com", "Subject ✓", "<p>Hi ✓</p>", "Hi ✓")
        return FakeSMTP.instances[-1]

    def test_starttls_on_587_with_login(self):
        server = self._send(SMTP_USER="user", SMTP_PASSWORD="pass word")
        self.assertEqual((server.host, server.port, server.timeout), ("smtp.example.com", 587, 15.0))
        self.assertEqual(server.calls, ["ehlo", "starttls", "ehlo", "login", "send", "quit"])
        self.assertEqual(server.logged_in, ("user", "pass word"))
        message = message_from_bytes(server.sent.as_bytes(), policy=default_policy)
        self.assertEqual(message["To"], "student@gmail.com")
        self.assertEqual(message["Subject"], "Subject ✓")
        self.assertIn("admin@example.com", message["From"])
        self.assertTrue(message["Message-ID"].endswith("@example.com>"))
        self.assertEqual(message.get_body(("plain",)).get_content().strip(), "Hi ✓")
        self.assertEqual(message.get_body(("html",)).get_content().strip(), "<p>Hi ✓</p>")

    def test_implicit_tls(self):
        server = self._send(SMTP_SSL="true")
        self.assertEqual(server.port, 465)
        self.assertIsNotNone(server.context)
        self.assertNotIn("starttls", server.calls)
        self.assertNotIn("login", server.calls)
        server = self._send(SMTP_PORT="465")
        self.assertNotIn("starttls", server.calls)
        server = self._send(SMTP_PORT="2525")
        self.assertIn("starttls", server.calls)

    def test_error_mapping(self):
        cases = [
            (smtplib.SMTPAuthenticationError(535, b"bad"), "SMTP_USER / SMTP_PASSWORD"),
            (smtplib.SMTPNotSupportedError("no tls"), "STARTTLS"),
            (smtplib.SMTPRecipientsRefused({}), "recipient"),
            (smtplib.SMTPSenderRefused(550, b"no", "a@example.com"), "EMAIL_FROM"),
            (smtplib.SMTPServerDisconnected("gone"), "SMTP error"),
            (TimeoutError("timed out"), "Render free instances block SMTP"),
            (ConnectionRefusedError(111, "Connection refused"), "Could not connect to smtp.example.com:587"),
        ]
        for exc, expected in cases:
            FakeSMTP.fail_with = exc
            with self.subTest(exc=type(exc).__name__), self.assertLogs("email_service", level="WARNING"):
                with self.assertRaises(email_service.EmailError) as ctx:
                    self._send(SMTP_USER="user", SMTP_PASSWORD="hunter2")
            self.assertIn(expected, str(ctx.exception))
            self.assertNotIn("hunter2", str(ctx.exception))


class SendEmailGuardTests(NoNetworkTestCase):
    def test_not_configured(self):
        with email_env(), patch.object(email_service.httpx, "post") as post:
            with self.assertRaises(email_service.EmailError) as ctx:
                email_service.send_email("student@gmail.com", "S", "h", "t")
        self.assertIn("not configured", str(ctx.exception))
        post.assert_not_called()

    def test_rejects_bad_recipients(self):
        for to in ("", "nobody", "a@b", "a@example.com\r\nBcc: x@evil.com", "a@example.com, b@example.com"):
            with self.subTest(to=to), \
                    email_env(BREVO_API_KEY="k", EMAIL_FROM="admin@example.com"), \
                    patch.object(email_service.httpx, "post") as post:
                with self.assertRaises(email_service.EmailError):
                    email_service.send_email(to, "S", "h", "t")
                post.assert_not_called()

    def test_recipients_follow_the_sign_up_email_rules(self):
        for to in ("Student <student@gmail.com>", "student@gmail.com;other@gmail.com",
                   "student@gmail.com\nBcc: x@evil.com", "stu dent@gmail.com", "a..b@gmail.com",
                   "student@gmail", "x" * 250 + "@gmail.com", None, 42):
            with self.subTest(to=to), \
                    email_env(BREVO_API_KEY="k", EMAIL_FROM="admin@example.com"), \
                    patch.object(email_service.httpx, "post") as post:
                with self.assertRaises(email_service.EmailError) as ctx:
                    email_service.send_email(to, "S", "h", "t")
                self.assertEqual(str(ctx.exception), "The recipient email address is not valid.")
                post.assert_not_called()

        with email_env(BREVO_API_KEY="k", EMAIL_FROM="admin@example.com"), \
                patch.object(email_service.httpx, "post", return_value=response(201)) as post:
            email_service.send_email("  Student@Gmail.com ", "Line one\r\nBcc: x@evil.com " + "s" * 300, "h", "t")
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["to"], [{"email": "student@gmail.com"}])
        self.assertNotIn("\n", payload["subject"])
        self.assertNotIn("\r", payload["subject"])
        self.assertLessEqual(len(payload["subject"]), 200)

    def test_logs_mask_the_recipient(self):
        with email_env(BREVO_API_KEY="k", EMAIL_FROM="admin@example.com"), \
                patch.object(email_service.httpx, "post", return_value=response(201)), \
                self.assertLogs("email_service", level="INFO") as logs:
            email_service.send_email("student@gmail.com", "S", "h", "t")
        output = "\n".join(logs.output)
        self.assertIn("st***@gmail.com", output)
        self.assertNotIn("student@gmail.com", output)


class TemplateTests(NoNetworkTestCase):
    def _credentials(self, **overrides):
        kwargs = dict(
            to="student@gmail.com",
            name="Nasir Uddin",
            login="student@gmail.com",
            password="Kx7m-Pq4t-Zr9w",
            daily_limit=4,
            login_url="https://unistream.example/",
            phone="+8801712345678",
        )
        kwargs.update(overrides)
        with email_env(FRONTEND_URL="https://unistream.example/", APP_TIMEZONE="Asia/Dhaka"):
            return email_service.build_credentials_email(**kwargs)

    def test_credentials_email_content(self):
        subject, html_body, text = self._credentials()
        self.assertEqual(subject, "Your UniStream Saver account is ready")
        for fragment in (
            "UniStream Saver",
            "Hi Nasir Uddin,",
            "student@gmail.com",
            "+8801712345678",
            "Kx7m-Pq4t-Zr9w",
            "monospace",
            'href="https://unistream.example/"',
            'href="https://unistream.example/account"',
            "4 videos per day",
            "Bangladesh time",
            "change this password",
            '<meta name="viewport"',
        ):
            self.assertIn(fragment, html_body)
        for fragment in (
            "Temporary password: Kx7m-Pq4t-Zr9w",
            "Email: student@gmail.com",
            "Phone: +8801712345678",
            "Sign in: https://unistream.example/",
            "https://unistream.example/account",
            "4 videos per day",
        ):
            self.assertIn(fragment, text)
        self.assertNotIn("<", text.replace("<country", ""))

    def test_limit_wording(self):
        self.assertIn("Unlimited downloads", self._credentials(daily_limit=None)[1])
        self.assertIn("Unlimited downloads", self._credentials(daily_limit=-1)[2])
        self.assertIn("1 video per day", self._credentials(daily_limit=1)[2])
        self.assertIn("paused", self._credentials(daily_limit=0)[2])

    def test_new_password_wording(self):
        subject, html_body, text = self._credentials(new_password=True)
        self.assertIn("new", subject.lower())
        self.assertIn("previous password no longer works", html_body)
        self.assertIn("previous password no longer works", text)

    def test_everything_interpolated_is_escaped(self):
        evil = '<script>alert("x")</script>&'
        subject, html_body, _ = self._credentials(
            name=evil, login=f"a{evil}@x.com", phone=evil, password='<b>"pw"</b>', to=f"t{evil}@x.com",
        )
        self.assertNotIn("<script>", html_body)
        self.assertNotIn('<b>"pw"', html_body)
        self.assertIn("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;", html_body)
        self.assertIn("&lt;b&gt;&quot;pw&quot;&lt;/b&gt;", html_body)

    def test_unsafe_links_fall_back_to_the_app(self):
        _, html_body, text = self._credentials(login_url="javascript:alert(1)")
        self.assertNotIn("javascript:", html_body)
        self.assertNotIn("javascript:", text)
        self.assertIn('href="https://unistream.example/"', html_body)

        with email_env(FRONTEND_URL="https://unistream.example"):
            _, reset_html, _ = email_service.build_password_reset_email(
                to="a@b.com", name="A", reset_url='data:text/html,<script>"',
            )
        self.assertNotIn("data:text", reset_html)
        self.assertIn('href="https://unistream.example/forgot-password"', reset_html)

    def test_reset_email(self):
        url = "https://unistream.example/reset-password?token=abc.def&x=1"
        with email_env(FRONTEND_URL="https://unistream.example"):
            subject, html_body, text = email_service.build_password_reset_email(
                to="student@gmail.com", name="", reset_url=url,
            )
        self.assertEqual(subject, "Reset your UniStream Saver password")
        self.assertIn('href="https://unistream.example/reset-password?token=abc.def&amp;x=1"', html_body)
        self.assertIn("60 minutes", html_body)
        self.assertIn("ignore this email", html_body)
        self.assertIn("Hi there,", html_body)
        self.assertIn(url, text)
        self.assertIn("60 minutes", text)
        self.assertIn("ignore this email", text)

    def test_send_helpers_use_send_email(self):
        with email_env(BREVO_API_KEY="k", EMAIL_FROM="admin@example.com", FRONTEND_URL="https://u.example"), \
                patch.object(email_service.httpx, "post", return_value=response(201)) as post:
            email_service.send_credentials_email(
                to="student@gmail.com", name="Nasir", login="student@gmail.com",
                password="Kx7m-Pq4t-Zr9w", daily_limit=4, login_url="https://u.example/",
            )
            email_service.send_password_reset_email(
                to="student@gmail.com", name="Nasir", reset_url="https://u.example/reset-password?token=t",
            )
            email_service.send_test_email("admin@example.com")
        subjects = [call.kwargs["json"]["subject"] for call in post.call_args_list]
        self.assertEqual(subjects, [
            "Your UniStream Saver account is ready",
            "Reset your UniStream Saver password",
            "UniStream Saver test email",
        ])
        first = post.call_args_list[0].kwargs["json"]
        self.assertIn("Kx7m-Pq4t-Zr9w", first["htmlContent"])
        self.assertIn("Kx7m-Pq4t-Zr9w", first["textContent"])
        test_payload = post.call_args_list[2].kwargs["json"]
        self.assertIn("Brevo", test_payload["textContent"])
        self.assertIn("admin@example.com", test_payload["textContent"])

    def test_send_propagates_errors(self):
        with email_env(), self.assertRaises(email_service.EmailError):
            email_service.send_test_email("admin@example.com")


if __name__ == "__main__":
    unittest.main()
