import base64
import json
import logging
import os
import threading
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from starlette.requests import Request

import security


class FakeClock:
    def __init__(self, start: float = 1000.0):
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def make_request(headers: dict | None = None, client=("198.51.100.9", 4321)) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": client,
    }
    return Request(scope)


class NameValidationTests(unittest.TestCase):
    def test_trims_and_collapses_whitespace(self):
        self.assertEqual(security.validate_name("  Nasir   Uddin \n"), "Nasir Uddin")

    def test_accepts_bengali_and_punctuation(self):
        self.assertEqual(security.validate_name("নাসির উদ্দিন"), "নাসির উদ্দিন")
        self.assertEqual(security.validate_name("Md. Abdul-Karim O'Neil"), "Md. Abdul-Karim O'Neil")
        # Zero-width joiner is part of Bengali spelling (e.g. র‍্যাব).
        self.assertEqual(security.validate_name("র‍্যাব Khan"), "র‍্যাব Khan")

    def test_rejections_have_specific_messages(self):
        cases = {
            "": "Please enter your full name.",
            "   ": "Please enter your full name.",
            "A": "at least 2",
            "x" * 81: "at most 80",
            "12345": "must contain letters",
            "Bad\x00Name": "invalid characters",
            "Evil‮Name": "invalid characters",
        }
        for value, message in cases.items():
            with self.subTest(value=value), self.assertRaises(ValueError) as ctx:
                security.validate_name(value)
            self.assertIn(message, str(ctx.exception))
        with self.assertRaises(ValueError):
            security.validate_name(None)

    def test_length_boundaries(self):
        self.assertEqual(security.validate_name("Al"), "Al")
        self.assertEqual(len(security.validate_name("a" * 80)), 80)


class EmailValidationTests(unittest.TestCase):
    def test_normalises_case_and_whitespace(self):
        self.assertEqual(security.validate_email("  Student.Name+tag@Gmail.COM "), "student.name+tag@gmail.com")
        self.assertEqual(security.validate_email("a@du.ac.bd"), "a@du.ac.bd")

    def test_rejections_have_specific_messages(self):
        cases = {
            "": "Please enter your email address.",
            "john doe@gmail.com": "can't contain spaces",
            "johngmail.com": "Enter a valid email address",
            "a@b@gmail.com": "Only one @",
            "@gmail.com": "username before @",
            "john@gmail": "Missing domain",
            "john..doe@gmail.com": "Invalid email",
            "john.@gmail.com": "Invalid email",
            ".john@gmail.com": "Invalid email",
            "john@-gmail.com": "Invalid email",
            "john@gmail.c": "Invalid email",
            "jo<hn>@gmail.com": "Invalid email",
            "a" * 250 + "@gmail.com": "too long",
        }
        for value, message in cases.items():
            with self.subTest(value=value), self.assertRaises(ValueError) as ctx:
                security.validate_email(value)
            self.assertIn(message, str(ctx.exception))


class PhoneValidationTests(unittest.TestCase):
    def test_bangladeshi_formats_normalise_to_e164(self):
        expected = "+8801712345678"
        for value in (
            "01712345678",
            "017-1234-5678",
            "017 1234 5678",
            "(017) 1234.5678",
            "8801712345678",
            "+8801712345678",
            "+880 1712-345678",
            "+88 01712 345678",
            "+88001712345678",
            "008801712345678",
            " 01712345678 ",
        ):
            with self.subTest(value=value):
                self.assertEqual(security.validate_phone(value), expected)

    def test_every_operator_013_to_019(self):
        for op in "3456789":
            with self.subTest(op=op):
                self.assertEqual(security.validate_phone(f"01{op}12345678"), f"+8801{op}12345678")

    def test_international_numbers_need_country_code(self):
        self.assertEqual(security.validate_phone("+44 7911 123456"), "+447911123456")
        self.assertEqual(security.validate_phone("+1 (415) 555-2671"), "+14155552671")
        self.assertEqual(security.validate_phone("0044 7911 123456"), "+447911123456")

    def test_specific_error_messages(self):
        cases = {
            "": "Please enter your phone number.",
            "0171234567": "Too short",
            "1712345678": "Too short",
            "+880171234567": "Too short",
            "017123456789": "Too long",
            "+880171234567890": "Too long",
            "02912345678": "Must start with 01",
            "+88021234567890": "Too long",
            "01212345678": "Unknown operator",
            "01112345678": "Unknown operator",
            "+8801212345678": "Unknown operator",
            "017-ABC-45678": "can only contain digits",
            "+0123456789": "Invalid country code",
            "+12345": "Too short",
            "+1234567890123456": "Too long",
        }
        for value, message in cases.items():
            with self.subTest(value=value), self.assertRaises(ValueError) as ctx:
                security.validate_phone(value)
            self.assertIn(message, str(ctx.exception))

    def test_messages_mention_examples(self):
        with self.assertRaises(ValueError) as ctx:
            security.validate_phone("01212345678")
        self.assertIn("013–019", str(ctx.exception))
        with self.assertRaises(ValueError) as ctx:
            security.validate_phone("0171234567")
        self.assertIn("11 digits", str(ctx.exception))


class LoginClassificationTests(unittest.TestCase):
    def test_email_or_phone(self):
        self.assertEqual(security.classify_login(" Me@Example.COM "), "me@example.com")
        self.assertEqual(security.classify_login("01812-345678"), "+8801812345678")
        self.assertEqual(security.classify_login("+8801812345678"), "+8801812345678")

    def test_invalid_values(self):
        for value, message in {
            "": "email address or phone number",
            "hello": "valid email address or phone number",
            "me@": "Missing domain",
            "0181234": "Too short",
        }.items():
            with self.subTest(value=value), self.assertRaises(ValueError) as ctx:
                security.classify_login(value)
            self.assertIn(message, str(ctx.exception))


class PasswordTests(unittest.TestCase):
    def test_validate_password_rules(self):
        self.assertEqual(security.validate_password("abcdefg1"), "abcdefg1")
        self.assertEqual(security.validate_password(" pass word 9 "), " pass word 9 ")
        cases = {
            "": "Please enter a password.",
            "abc1": "at least 8",
            "a1" * 65: "at most 128",
            "abcdefgh": "one letter and one number",
            "12345678": "one letter and one number",
        }
        for value, message in cases.items():
            with self.subTest(value=value), self.assertRaises(ValueError) as ctx:
                security.validate_password(value)
            self.assertIn(message, str(ctx.exception))

    def test_hash_format_and_verification(self):
        stored = security.hash_password("Secret123")
        parts = stored.split("$")
        self.assertEqual(parts[:4], ["scrypt", "16384", "8", "1"])
        self.assertEqual(len(base64.b64decode(parts[4])), 16)
        self.assertEqual(len(base64.b64decode(parts[5])), 32)
        self.assertTrue(security.verify_password("Secret123", stored))
        self.assertFalse(security.verify_password("secret123", stored))
        self.assertFalse(security.verify_password("Secret1234", stored))
        self.assertNotIn("Secret123", stored)

    def test_salted_hashes_differ(self):
        self.assertNotEqual(security.hash_password("Secret123"), security.hash_password("Secret123"))

    def test_unicode_is_normalised(self):
        stored = security.hash_password("Café-pass1")  # composed é
        self.assertTrue(security.verify_password("Café-pass1", stored))  # decomposed

    def test_malformed_or_missing_hashes_are_rejected(self):
        good = security.hash_password("Secret123")
        salt, digest = good.split("$")[4:]
        for stored in (
            None,
            "",
            "plaintext",
            "bcrypt$16384$8$1$abc$def",
            f"scrypt$16384$8$1${salt}",
            f"scrypt$16385$8$1${salt}${digest}",  # n not a power of two
            f"scrypt$1048576$8$1${salt}${digest}",  # n far too large
            f"scrypt$16384$8$1$!!!${digest}",
            f"scrypt$16384$8$1${salt}$",
            12345,
        ):
            with self.subTest(stored=stored):
                self.assertFalse(security.verify_password("Secret123", stored))
        self.assertFalse(security.verify_password(None, good))
        self.assertFalse(security.verify_password("", good))
        self.assertFalse(security.verify_password("x" * 600, good))

    def test_missing_hash_still_spends_a_hash_computation(self):
        with patch.object(security, "_scrypt", wraps=security._scrypt) as spy:
            self.assertFalse(security.verify_password("Secret123", None))
        self.assertEqual(spy.call_count, 1)

    def test_hash_password_rejects_empty(self):
        with self.assertRaises(ValueError):
            security.hash_password("")

    def test_generate_password_shape(self):
        alphabet = set(security._PW_ALPHABET)
        seen = set()
        for _ in range(200):
            pw = security.generate_password()
            seen.add(pw)
            self.assertRegex(pw, r"^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$")
            letters = pw.replace("-", "")
            self.assertTrue(set(letters) <= alphabet)
            self.assertFalse(set(letters) & set("0O1lIo"))
            self.assertTrue(any(c.isupper() for c in letters))
            self.assertTrue(any(c.islower() for c in letters))
            self.assertTrue(any(c.isdigit() for c in letters))
            self.assertEqual(security.validate_password(pw), pw)
        self.assertEqual(len(seen), 200)

    def test_password_version(self):
        self.assertEqual(security.password_version(None), "")
        self.assertEqual(security.password_version(""), "")
        first = security.password_version("scrypt$a")
        self.assertEqual(len(first), 16)
        self.assertEqual(first, security.password_version("scrypt$a"))
        self.assertNotEqual(first, security.password_version("scrypt$b"))


class TokenTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"AUTH_SECRET": "t" * 40})
        self.env.start()
        security._auth_secret.cache_clear()

    def tearDown(self):
        self.env.stop()
        security._auth_secret.cache_clear()

    def test_round_trip(self):
        token = security.create_token(42, "abc123", "session", security.SESSION_TTL_SECONDS)
        claims = security.verify_token(token, "session")
        self.assertEqual(claims["sub"], "42")
        self.assertEqual(claims["pv"], "abc123")
        self.assertEqual(claims["purpose"], "session")
        self.assertAlmostEqual(claims["exp"], datetime.now().timestamp() + 30 * 24 * 3600, delta=5)

    def test_wrong_purpose_is_rejected(self):
        reset = security.create_token("u1", "pv", "reset", security.RESET_TTL_SECONDS)
        self.assertIsNone(security.verify_token(reset, "session"))
        self.assertIsNotNone(security.verify_token(reset, "reset"))

    def test_expired_token_is_rejected(self):
        token = security.create_token("u1", "pv", "reset", 60)
        later = security.time.time() + 61
        with patch.object(security.time, "time", return_value=later):
            self.assertIsNone(security.verify_token(token, "reset"))

    def test_tampering_is_detected(self):
        token = security.create_token("u1", "pv", "session", 600)
        payload_b64, sig = token.split(".")
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4)))
        payload["sub"] = "admin"
        forged_payload = base64.urlsafe_b64encode(
            json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
        ).rstrip(b"=").decode()
        self.assertIsNone(security.verify_token(f"{forged_payload}.{sig}", "session"))
        flipped = sig[:-2] + ("A" if sig[-2] != "A" else "B") + sig[-1]
        self.assertIsNone(security.verify_token(f"{payload_b64}.{flipped}", "session"))

    def test_malformed_tokens(self):
        for token in (None, "", "abc", "a.b.c", ".", "abc.", ".abc", "é.é", "x" * 5000, 123):
            with self.subTest(token=token):
                self.assertIsNone(security.verify_token(token, "session"))

    def test_other_secret_cannot_verify(self):
        token = security.create_token("u1", "pv", "session", 600)
        with patch.dict(os.environ, {"AUTH_SECRET": "z" * 40}):
            security._auth_secret.cache_clear()
            self.assertIsNone(security.verify_token(token, "session"))

    def test_invalid_arguments(self):
        with self.assertRaises(ValueError):
            security.create_token("u1", "pv", "Session Token", 60)
        with self.assertRaises(ValueError):
            security.create_token("u1", "pv", "session", 0)
        with self.assertRaises(ValueError):
            security.create_token("", "pv", "session", 60)

    def test_password_change_changes_pv(self):
        old = security.password_version(security.hash_password("Secret123"))
        new = security.password_version(security.hash_password("Secret123"))
        token = security.create_token("u1", old, "session", 600)
        self.assertNotEqual(security.verify_token(token, "session")["pv"], new)


class DownloadTicketTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"AUTH_SECRET": "t" * 40})
        self.env.start()
        security._auth_secret.cache_clear()

    def tearDown(self):
        self.env.stop()
        security._auth_secret.cache_clear()

    def ticket(self, **overrides):
        args = {"url": "https://youtu.be/x", "format_id": "137", "ext": "mp4", "height": 1080, "source": "web"}
        args.update(overrides)
        return security.create_download_ticket("u1", "pv1", **args)

    def test_round_trip_carries_the_download(self):
        claims = security.verify_download_ticket(self.ticket())
        self.assertEqual(
            {key: claims[key] for key in ("sub", "pv", "purpose", "url", "format_id", "ext", "height", "source")},
            {"sub": "u1", "pv": "pv1", "purpose": "download", "url": "https://youtu.be/x",
             "format_id": "137", "ext": "mp4", "height": 1080, "source": "web"},
        )
        self.assertAlmostEqual(claims["exp"] - security.time.time(), 60, delta=2)
        # Every ticket is different, even for the same download.
        self.assertNotEqual(claims["jti"], security.verify_download_ticket(self.ticket())["jti"])

    def test_long_urls_fit(self):
        url = "https://www.youtube.com/watch?v=x&" + "a" * 2000
        self.assertEqual(security.verify_download_ticket(self.ticket(url=url))["url"], url)

    def test_expires_after_a_minute(self):
        ticket = self.ticket()
        later = security.time.time() + 61
        with patch.object(security.time, "time", return_value=later):
            self.assertIsNone(security.verify_download_ticket(ticket))

    def test_purposes_cannot_be_swapped(self):
        ticket = self.ticket()
        for purpose in ("session", "reset", "admin"):
            self.assertIsNone(security.verify_token(ticket, purpose))
            other = security.create_token("u1", "pv1", purpose, 600)
            self.assertIsNone(security.verify_download_ticket(other))

    def test_tampering_and_bad_claims_are_rejected(self):
        payload_b64, signature = self.ticket().split(".")
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4)))
        payload["url"] = "https://evil.example/"
        forged = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
        self.assertIsNone(security.verify_download_ticket(f"{forged}.{signature}"))

        good = json.loads(base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4)))
        for change in ({"ext": "exe"}, {"height": True}, {"height": 0}, {"height": "1080"},
                       {"jti": "short"}, {"url": ""}, {"url": 5}, {"format_id": ""},
                       {"source": 7}, {"format_id": "x" * 201}):
            with self.subTest(change=change):
                signed = security._encode_signed({**good, **change})
                self.assertIsNone(security.verify_download_ticket(signed))
        self.assertIsNotNone(security.verify_download_ticket(security._encode_signed(good)))
        for bad in (None, "", "garbage", "a.b", "x" * 9000):
            self.assertIsNone(security.verify_download_ticket(bad))

    def test_invalid_arguments(self):
        with self.assertRaises(ValueError):
            self.ticket(ext="exe")
        with self.assertRaises(ValueError):
            security.create_download_ticket("", "pv", url="https://youtu.be/x", format_id="1", ext="mp3")


class UsedTicketsTests(unittest.TestCase):
    def test_each_ticket_is_consumed_once(self):
        clock = FakeClock(1000.0)
        used = security.UsedTickets(clock=clock)
        self.assertTrue(used.consume("jti-aaaaaaaa", 1060))
        self.assertFalse(used.consume("jti-aaaaaaaa", 1060))
        self.assertTrue(used.consume("jti-bbbbbbbb", 1060))

    def test_expired_ids_are_forgotten(self):
        clock = FakeClock(1000.0)
        used = security.UsedTickets(clock=clock)
        for index in range(100):
            used.consume(f"old-{index:08d}", 1060)
        clock.advance(61)
        used.consume("fresh-00000001", 1121)
        self.assertEqual(used.size(), 1)

    def test_memory_is_bounded_without_forgetting_live_ids(self):
        clock = FakeClock(1000.0)
        used = security.UsedTickets(max_entries=3, clock=clock)
        for index in range(3):
            self.assertTrue(used.consume(f"live-{index:08d}", 1060))
        # Full of unexpired ids: refuse rather than forget one (no replay).
        self.assertFalse(used.consume("another-0001", 1060))
        self.assertFalse(used.consume("live-00000000", 1060))
        clock.advance(61)
        self.assertTrue(used.consume("another-0001", 1121))

    def test_thread_safety(self):
        used = security.UsedTickets()
        results = []

        def worker():
            results.append(used.consume("same-ticket-id", security.time.time() + 60))

        threads = [threading.Thread(target=worker) for _ in range(16)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(results.count(True), 1)

    def test_module_level_instance(self):
        self.assertIsInstance(security.used_tickets, security.UsedTickets)


class AdminRulesTests(unittest.TestCase):
    def test_username_rules(self):
        self.assertEqual(security.validate_admin_username("  Owner.BD_1-x "), "owner.bd_1-x")
        cases = {
            "": "Please enter a username.",
            None: "Please enter a username.",
            "ab": "Username must be at least 3 characters.",
            "a" * 33: "Username must be at most 32 characters.",
            "no spaces": "Username can only contain letters, numbers, dots, dashes and underscores.",
            "name@site": "Username can only contain letters, numbers, dots, dashes and underscores.",
            "nämé": "Username can only contain letters, numbers, dots, dashes and underscores.",
        }
        for value, message in cases.items():
            with self.subTest(value=value):
                with self.assertRaises(ValueError) as ctx:
                    security.validate_admin_username(value)
                self.assertEqual(str(ctx.exception), message)

    def test_password_rules(self):
        self.assertEqual(security.validate_admin_password("Dhaka admin 2026"), "Dhaka admin 2026")
        cases = {
            "": "Please enter a new password.",
            "short12": "Admin password must be at least 10 characters.",
            "a1" * 65: "Admin password must be at most 128 characters.",
            "onlyletters": "Admin password must include at least one letter and one number.",
            "1234567890": "Admin password must include at least one letter and one number.",
        }
        for value, message in cases.items():
            with self.subTest(value=value):
                with self.assertRaises(ValueError) as ctx:
                    security.validate_admin_password(value)
                self.assertEqual(str(ctx.exception), message)

    def test_secret_matches(self):
        self.assertTrue(security.secret_matches("abc", "abc"))
        self.assertFalse(security.secret_matches("abc", "abd"))
        self.assertFalse(security.secret_matches("abc", "abcd"))
        self.assertFalse(security.secret_matches("", ""))
        self.assertFalse(security.secret_matches(None, "abc"))
        self.assertFalse(security.secret_matches("abc", None))

    def test_bootstrap_version(self):
        with patch.dict(os.environ, {"AUTH_SECRET": "t" * 40}):
            security._auth_secret.cache_clear()
            first = security.bootstrap_version("secret-1", None)
            self.assertTrue(first.startswith("boot-"))
            self.assertEqual(first, security.bootstrap_version("secret-1", None))
            self.assertNotEqual(first, security.bootstrap_version("secret-2", None))
            self.assertNotEqual(first, security.bootstrap_version("secret-1", "scrypt$hash"))
            self.assertNotIn("secret-1", first)
            # Keyed with the signing secret: not computable from the password alone.
            with patch.dict(os.environ, {"AUTH_SECRET": "z" * 40}):
                security._auth_secret.cache_clear()
                self.assertNotEqual(first, security.bootstrap_version("secret-1", None))
        security._auth_secret.cache_clear()


class SecretTests(unittest.TestCase):
    KEYS = ("AUTH_SECRET", "ADMIN_SECRET", "SUPABASE_SERVICE_KEY")

    def _env(self, **values):
        env = {key: "" for key in self.KEYS}
        env.update(values)
        return patch.dict(os.environ, env)

    def tearDown(self):
        security._auth_secret.cache_clear()

    def _secret(self, **values) -> bytes:
        with self._env(**values):
            security._auth_secret.cache_clear()
            return security._auth_secret()

    def test_configured_requires_32_characters(self):
        with self._env(AUTH_SECRET="s" * 32):
            self.assertTrue(security.auth_secret_configured())
        with self._env(AUTH_SECRET="short"):
            self.assertFalse(security.auth_secret_configured())
        with self._env():
            self.assertFalse(security.auth_secret_configured())

    def test_fallback_is_stable_and_depends_on_inputs(self):
        a = self._secret(ADMIN_SECRET="admin", SUPABASE_SERVICE_KEY="svc")
        b = self._secret(ADMIN_SECRET="admin", SUPABASE_SERVICE_KEY="svc")
        c = self._secret(ADMIN_SECRET="admin2", SUPABASE_SERVICE_KEY="svc")
        explicit = self._secret(AUTH_SECRET="e" * 40, ADMIN_SECRET="admin")
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertNotEqual(a, explicit)
        self.assertEqual(len(a), 32)

    def test_short_secret_is_mixed_into_fallback(self):
        with self.assertLogs("security", level="WARNING"):
            short = self._secret(AUTH_SECRET="short", ADMIN_SECRET="admin")
        self.assertNotEqual(short, self._secret(ADMIN_SECRET="admin"))

    def test_random_secret_when_nothing_is_set(self):
        with self.assertLogs("security", level="WARNING") as logs:
            first = self._secret()
        self.assertIn("random per-process", "\n".join(logs.output))
        with self.assertLogs("security", level="WARNING"):
            second = self._secret()
        self.assertNotEqual(first, second)


class RateLimiterTests(unittest.TestCase):
    def test_allows_up_to_limit_then_reports_retry_after(self):
        clock = FakeClock()
        limiter = security.RateLimiter(clock=clock)
        for _ in range(3):
            self.assertEqual(limiter.hit("login", "1.2.3.4", 3, 60), (True, 0))
        allowed, retry = limiter.hit("login", "1.2.3.4", 3, 60)
        self.assertFalse(allowed)
        self.assertEqual(retry, 60)
        clock.advance(59.5)
        self.assertEqual(limiter.hit("login", "1.2.3.4", 3, 60), (False, 1))
        clock.advance(0.5)
        self.assertEqual(limiter.hit("login", "1.2.3.4", 3, 60), (True, 0))

    def test_window_slides(self):
        clock = FakeClock()
        limiter = security.RateLimiter(clock=clock)
        limiter.hit("b", "k", 2, 100)
        clock.advance(50)
        limiter.hit("b", "k", 2, 100)
        self.assertEqual(limiter.hit("b", "k", 2, 100), (False, 50))
        clock.advance(50)
        self.assertEqual(limiter.hit("b", "k", 2, 100), (True, 0))
        self.assertEqual(limiter.hit("b", "k", 2, 100), (False, 50))

    def test_buckets_and_keys_are_independent(self):
        limiter = security.RateLimiter(clock=FakeClock())
        self.assertTrue(limiter.hit("login", "a", 1, 60)[0])
        self.assertFalse(limiter.hit("login", "a", 1, 60)[0])
        self.assertTrue(limiter.hit("login", "b", 1, 60)[0])
        self.assertTrue(limiter.hit("register", "a", 1, 60)[0])

    def test_check_clear_and_reset(self):
        limiter = security.RateLimiter(clock=FakeClock())
        self.assertEqual(limiter.check("admin", "ip", 2, 60), (True, 0))
        limiter.hit("admin", "ip", 2, 60)
        self.assertEqual(limiter.check("admin", "ip", 2, 60), (True, 0))
        limiter.hit("admin", "ip", 2, 60)
        self.assertFalse(limiter.check("admin", "ip", 2, 60)[0])
        limiter.clear("admin", "ip")
        self.assertTrue(limiter.check("admin", "ip", 2, 60)[0])
        limiter.hit("admin", "ip", 1, 60)
        limiter.reset()
        self.assertTrue(limiter.hit("admin", "ip", 1, 60)[0])

    def test_zero_limit_always_blocks(self):
        limiter = security.RateLimiter(clock=FakeClock())
        self.assertEqual(limiter.hit("b", "k", 0, 30), (False, 30))

    def test_memory_is_bounded(self):
        clock = FakeClock()
        limiter = security.RateLimiter(max_keys=100, clock=clock)
        for i in range(1000):
            limiter.hit("b", str(i), 5, 60)
        self.assertEqual(limiter.size(), 100)
        # Most recent keys survive LRU eviction.
        self.assertFalse(limiter.hit("b", "999", 1, 60)[0])
        clock.advance(120)
        limiter.hit("b", "fresh", 5, 60)
        self.assertEqual(limiter.size(), 1)
        self.assertFalse(limiter.check("b", "fresh", 1, 60)[0])

    def test_flooding_one_bucket_cannot_evict_another(self):
        limiter = security.RateLimiter(max_keys=50, clock=FakeClock())
        for _ in range(3):
            limiter.hit("login-id", "victim@example.com", 3, 900)
        for i in range(500):
            limiter.hit("login-ip", f"10.0.{i // 256}.{i % 256}", 10, 900)
        self.assertEqual(limiter.check("login-id", "victim@example.com", 3, 900)[0], False)
        self.assertEqual(limiter.size(), 51)

    def test_thread_safety(self):
        limiter = security.RateLimiter()
        results = []
        lock = threading.Lock()

        def worker():
            for _ in range(50):
                allowed, _ = limiter.hit("b", "shared", 100, 60)
                with lock:
                    results.append(allowed)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sum(results), 100)
        self.assertEqual(len(results), 400)

    def test_module_level_instance(self):
        self.assertIsInstance(security.rate_limiter, security.RateLimiter)


class ClientIpTests(unittest.TestCase):
    def test_first_forwarded_entry_wins(self):
        request = make_request({"X-Forwarded-For": "203.0.113.7, 10.0.0.1, 10.0.0.2"})
        self.assertEqual(security.client_ip(request), "203.0.113.7")

    def test_skips_garbage_and_strips_ports(self):
        self.assertEqual(
            security.client_ip(make_request({"x-forwarded-for": "unknown, 203.0.113.8:5555"})),
            "203.0.113.8",
        )
        self.assertEqual(
            security.client_ip(make_request({"x-forwarded-for": "[2001:db8::1]:443"})),
            "2001:db8::1",
        )
        self.assertEqual(
            security.client_ip(make_request({"x-forwarded-for": "2001:DB8::2"})),
            "2001:db8::2",
        )

    def test_falls_back_to_peer(self):
        self.assertEqual(security.client_ip(make_request()), "198.51.100.9")
        self.assertEqual(security.client_ip(make_request({"x-forwarded-for": "nonsense"})), "198.51.100.9")
        self.assertEqual(security.client_ip(make_request(client=None)), "unknown")


class PlatformTests(unittest.TestCase):
    def test_supported_links(self):
        cases = {
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ": "youtube",
            "https://youtube.com/shorts/abc": "youtube",
            "https://m.youtube.com/watch?v=x": "youtube",
            "https://music.youtube.com/watch?v=x": "youtube",
            "https://youtu.be/dQw4w9WgXcQ?t=3": "youtube",
            "https://www.youtube-nocookie.com/embed/x": "youtube",
            "HTTPS://WWW.YOUTUBE.COM./watch?v=x": "youtube",
            "https://www.facebook.com/watch/?v=123": "facebook",
            "https://m.facebook.com/story.php?id=1": "facebook",
            "https://web.facebook.com/reel/1": "facebook",
            "https://fb.watch/abcd/": "facebook",
            "https://fb.com/123": "facebook",
            "https://www.fb.com/123": "facebook",
            "https://www.instagram.com/reel/Cabc/": "instagram",
            "http://instagram.com/p/xyz": "instagram",
            "https://instagr.am/p/xyz": "instagram",
            "https://www.youtube.com:443/watch?v=x": "youtube",
            "http://m.facebook.com:80/watch?v=1": "facebook",
            "https://www.youtube.com/watch?v=x&feature=share@home": "youtube",
            "https://youtube.com/" + "a" * 2000: "youtube",
        }
        for url, platform in cases.items():
            with self.subTest(url=url):
                self.assertEqual(security.detect_platform(url), platform)
                self.assertEqual(security.ensure_supported_url(url), platform)

    def test_unsupported_and_spoofed_links(self):
        for url in (
            "https://www.tiktok.com/@user/video/1",
            "https://vm.tiktok.com/abc/",
            "https://twitter.com/x/status/1",
            "https://vimeo.com/1",
            "https://youtube.com.evil.example/watch?v=x",
            "https://evilyoutube.com/watch?v=x",
            "https://evil.example/https://youtube.com/watch?v=x",
            "https://www.youtube.com@evil.example/",
            "https://notfacebook.com/x",
            "https://instagram.com.evil.example/p/x",
            "ftp://youtube.com/x",
            "javascript:alert(1)//youtube.com",
            "youtube.com/watch?v=x",
            "//youtube.com/watch?v=x",
            "https://",
            "https://you tube.com/x",
            "https://youtube.com/watch?v=x\nfoo",
            "http://[invalid",
            "",
            None,
            "https://youtube.com/" + "a" * 5000,
            "https://youtube.com/" + "a" * 2030,
            # Credentials before the host: parsers disagree on which part is the host.
            "https://youtube.com@evil.example/watch?v=x",
            "https://user:pass@www.youtube.com/watch?v=x",
            "https://@youtube.com/watch?v=x",
            "https://evil.example\\@youtube.com/watch?v=x",
            "https://evil.example\\.youtube.com/",
            "https://youtube.com\\@evil.example/",
            # IP literals and other ways to name a host by number.
            "http://142.250.183.14/watch?v=x",
            "http://[::1]/youtube.com",
            "http://[2607:f8b0::200e]/watch",
            "http://2130706433/",
            "http://169.254.169.254/latest/meta-data/",
            # Ports other than the default ones, and malformed ports.
            "https://www.youtube.com:8080/watch?v=x",
            "https://www.youtube.com:0/",
            "https://www.youtube.com:99999/",
            "https://www.youtube.com:abc/",
            # Encoded, non-ASCII and control-character hosts.
            "https://%79outube.com/watch?v=x",
            "https://youtube.com%2F@evil.example/",
            "https://y\u043eutube.com/watch?v=x",
            "https://youtube.com\x00.evil.example/",
            "https://youtube.com\x7f/",
            "https://youtube..com/",
            "https://-youtube.com/",
        ):
            with self.subTest(url=url):
                self.assertIsNone(security.detect_platform(url))
                with self.assertRaises(ValueError) as ctx:
                    security.ensure_supported_url(url)
                self.assertEqual(
                    str(ctx.exception), "Only YouTube, Facebook and Instagram links are supported."
                )

    def test_labels(self):
        self.assertEqual(
            security.PLATFORM_LABELS,
            {"youtube": "YouTube", "facebook": "Facebook", "instagram": "Instagram"},
        )
        self.assertEqual(security.platform_label("youtube"), "YouTube")
        self.assertEqual(security.platform_label(None), "")
        self.assertEqual(security.platform_label("tiktok"), "")


class TimezoneTests(unittest.TestCase):
    def setUp(self):
        security._load_timezone.cache_clear()

    def test_default_is_dhaka(self):
        with patch.dict(os.environ, {"APP_TIMEZONE": ""}):
            self.assertEqual(security.app_timezone_name(), "Asia/Dhaka")
            self.assertEqual(
                security.app_timezone().utcoffset(datetime(2026, 1, 1)), timedelta(hours=6)
            )

    def test_env_override_and_invalid_fallback(self):
        with patch.dict(os.environ, {"APP_TIMEZONE": "Europe/London"}):
            self.assertEqual(security.app_timezone_name(), "Europe/London")
        with patch.dict(os.environ, {"APP_TIMEZONE": "Mars/Olympus"}):
            with self.assertLogs("security", level="WARNING"):
                self.assertEqual(security.app_timezone_name(), "Asia/Dhaka")

    def test_local_today_rolls_over_at_local_midnight(self):
        with patch.dict(os.environ, {"APP_TIMEZONE": "Asia/Dhaka"}):
            before = datetime(2026, 10, 6, 17, 59, 59, tzinfo=timezone.utc)  # 23:59:59 Dhaka
            after = datetime(2026, 10, 6, 18, 0, 0, tzinfo=timezone.utc)  # 00:00 Dhaka
            self.assertEqual(security.local_today(before), date(2026, 10, 6))
            self.assertEqual(security.local_today(after), date(2026, 10, 7))
            # Naive datetimes are treated as UTC.
            self.assertEqual(security.local_today(datetime(2026, 10, 6, 18, 0)), date(2026, 10, 7))

    def test_next_reset_at_is_next_local_midnight(self):
        with patch.dict(os.environ, {"APP_TIMEZONE": "Asia/Dhaka"}):
            now = datetime(2026, 10, 6, 10, 0, tzinfo=timezone.utc)  # 16:00 Dhaka
            reset = security.next_reset_at(now)
            self.assertIsNotNone(reset.tzinfo)
            self.assertEqual(reset.astimezone(timezone.utc), datetime(2026, 10, 6, 18, 0, tzinfo=timezone.utc))
            self.assertEqual(reset.isoformat(), "2026-10-07T00:00:00+06:00")
            self.assertGreater(security.next_reset_at(), datetime.now(timezone.utc))

    def test_local_midnight(self):
        with patch.dict(os.environ, {"APP_TIMEZONE": "Asia/Dhaka"}):
            start = security.local_midnight(date(2026, 10, 6))
            self.assertEqual(start.astimezone(timezone.utc), datetime(2026, 10, 5, 18, 0, tzinfo=timezone.utc))

    def test_fixed_offset_fallback_without_tz_database(self):
        def missing(_name):
            raise security.ZoneInfoNotFoundError("no tzdata")

        with patch.object(security, "ZoneInfo", side_effect=missing):
            security._load_timezone.cache_clear()
            with patch.dict(os.environ, {"APP_TIMEZONE": ""}), self.assertLogs("security", level="WARNING"):
                tz = security.app_timezone()
                self.assertEqual(tz.utcoffset(None), timedelta(hours=6))
                self.assertEqual(security.app_timezone_name(), "Asia/Dhaka")
        security._load_timezone.cache_clear()


if __name__ == "__main__":
    logging.basicConfig(level=logging.CRITICAL)
    unittest.main()
