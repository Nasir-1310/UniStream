"""Storage tests.

StorageContract runs against SQLite always. It also runs against a real
PostgREST (the API Supabase serves) when UNISTREAM_TEST_POSTGREST_URL and
UNISTREAM_TEST_POSTGREST_KEY (a service_role JWT) point at a DISPOSABLE
database with supabase_migration_v2.sql applied: those tests delete every row.
"""

import os
import shutil
import sqlite3
import tempfile
import threading
import unittest
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
from postgrest.exceptions import APIError

import storage


BACKEND_DIR = Path(__file__).resolve().parent.parent
POSTGREST_URL = os.getenv("UNISTREAM_TEST_POSTGREST_URL", "").strip()
POSTGREST_KEY = os.getenv("UNISTREAM_TEST_POSTGREST_KEY", "").strip()

V1_SQLITE_SCHEMA = """
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    name TEXT,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE download_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    platform TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


def api_error(code, message="boom", details=None):
    return APIError({"code": code, "message": message, "details": details, "hint": None})


class StorageStateMixin:
    """Save and restore the module globals the tests switch around."""

    def save_storage_state(self):
        self._saved = {
            name: getattr(storage, name)
            for name in ("SUPABASE_CONFIGURED", "LOCAL_DB_PATH", "_local_conn", "_supabase")
        }
        storage._clear_caches()

    def restore_storage_state(self):
        if storage._local_conn is not None and storage._local_conn is not self._saved["_local_conn"]:
            storage._local_conn.close()
        for name, value in self._saved.items():
            setattr(storage, name, value)
        storage._clear_caches()

    def use_sqlite(self, path):
        storage.SUPABASE_CONFIGURED = False
        storage.LOCAL_DB_PATH = Path(path)
        storage._local_conn = None


class StorageContract:
    """Behaviour both backends must share. Subclasses provide a clean store."""

    def make_user(self, n, **overrides):
        values = {
            "name": f"Student {n}",
            "email": f"student{n}@example.com",
            "phone": f"+88017100000{n:02d}",
        }
        values.update(overrides)
        return storage.create_user(**values)

    # Users -------------------------------------------------------------

    def test_create_user_normalises_and_reads_back(self):
        user = storage.create_user(
            name="Nasir Uddin", email="  Nasir@Example.COM ", phone="+8801712345678",
            note="CSE, DU", status="approved", daily_limit=10,
        )

        self.assertIsInstance(user["id"], str)
        self.assertEqual(user["identifier"], "nasir@example.com")
        self.assertEqual(user["email"], "nasir@example.com")
        self.assertEqual(user["phone"], "+8801712345678")
        self.assertEqual(user["status"], "approved")
        self.assertEqual(user["daily_limit"], 10)
        self.assertIs(user["temp_password"], False)
        self.assertIsNone(user["password_hash"])
        self.assertEqual((user["downloads_today"], user["total_downloads"]), (0, 0))
        self.assertIsNone(user["usage_date"])
        self.assertRegex(user["created_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$")
        self.assertIsNotNone(user["approved_at"])

        self.assertEqual(storage.get_user_by_id(user["id"]), user)
        self.assertEqual(storage.get_user_by_login("nasir@example.com")["id"], user["id"])
        self.assertEqual(storage.get_user_by_login("NASIR@example.com")["id"], user["id"])
        self.assertEqual(storage.get_user_by_login("+8801712345678")["id"], user["id"])
        self.assertEqual(storage.get_user(" Nasir@Example.com ")["id"], user["id"])
        self.assertIsNone(storage.get_user_by_login("+8801999999999"))
        self.assertIsNone(storage.get_user_by_login(""))

    def test_pending_account_has_no_approval_time(self):
        user = self.make_user(1)
        self.assertEqual(user["status"], "pending")
        self.assertIsNone(user["approved_at"])
        self.assertIsNone(user["daily_limit"])

    def test_unknown_or_malformed_ids_are_not_found(self):
        for user_id in ("", "abc", "999999", str(uuid.uuid4()), "1; DROP TABLE users"):
            self.assertIsNone(storage.get_user_by_id(user_id))
            self.assertIsNone(storage.update_user(user_id, {"name": "X Y"}))
            self.assertFalse(storage.delete_user(user_id))

    def test_duplicate_email_or_phone_is_rejected(self):
        first = self.make_user(1)

        with self.assertRaises(storage.DuplicateUserError) as email_error:
            self.make_user(2, email="STUDENT1@example.com")
        self.assertEqual(email_error.exception.field, "email")
        with self.assertRaises(storage.DuplicateUserError) as phone_error:
            self.make_user(2, phone=first["phone"])
        self.assertEqual(phone_error.exception.field, "phone")
        self.assertIsInstance(phone_error.exception, ValueError)

        self.assertEqual(storage.find_conflicts("student1@example.com", None), "email")
        self.assertEqual(storage.find_conflicts(None, first["phone"]), "phone")
        self.assertIsNone(storage.find_conflicts(first["email"], first["phone"], exclude_id=first["id"]))
        self.assertIsNone(storage.find_conflicts("free@example.com", "+8801799999999"))
        self.assertEqual(storage.user_status_counts()["total"], 1)

    def test_update_user_fields_and_login_follow_email(self):
        user = self.make_user(1)
        other = self.make_user(2)
        sent = datetime(2026, 10, 6, 10, 0, tzinfo=timezone.utc)

        updated = storage.update_user(user["id"], {
            "name": "New Name",
            "email": "New@Example.com",
            "note": None,
            "status": "approved",
            "daily_limit": -1,
            "password_hash": "scrypt$hash",
            "temp_password": True,
            "approved_at": sent,
            "credentials_sent_at": sent.isoformat(),
            "downloads_today": 3,
            "usage_date": date(2026, 10, 6),
        })

        self.assertEqual(updated["name"], "New Name")
        self.assertEqual(updated["email"], "new@example.com")
        self.assertEqual(updated["identifier"], "new@example.com")
        self.assertEqual(updated["daily_limit"], -1)
        self.assertEqual(updated["password_hash"], "scrypt$hash")
        self.assertIs(updated["temp_password"], True)
        self.assertEqual(updated["approved_at"], "2026-10-06T10:00:00+00:00")
        self.assertEqual(updated["credentials_sent_at"], "2026-10-06T10:00:00+00:00")
        self.assertEqual((updated["downloads_today"], updated["usage_date"]), (3, "2026-10-06"))
        self.assertIsNone(storage.get_user_by_login("student1@example.com"))
        self.assertEqual(storage.get_user_by_login("new@example.com")["id"], user["id"])

        self.assertIsNone(storage.update_user(user["id"], {"daily_limit": None})["daily_limit"])
        self.assertEqual(storage.update_user(user["id"], {})["id"], user["id"])

        with self.assertRaises(storage.DuplicateUserError) as conflict:
            storage.update_user(user["id"], {"phone": other["phone"]})
        self.assertEqual(conflict.exception.field, "phone")
        with self.assertRaises(storage.DuplicateUserError):
            storage.update_user(user["id"], {"email": other["email"]})
        for bad in ({"identifier": "x"}, {"status": "admin"}, {"daily_limit": -2},
                    {"daily_limit": True}, {"downloads_today": -1}, {"usage_date": "06/10/2026"}):
            with self.assertRaises(ValueError, msg=bad):
                storage.update_user(user["id"], bad)

    def test_delete_user_keeps_logs_detached(self):
        user = self.make_user(1)
        storage.add_download_log(user_id=user["id"], identifier=user["email"], url="https://youtu.be/a")

        self.assertTrue(storage.delete_user(user["id"]))
        self.assertFalse(storage.delete_user(user["id"]))
        self.assertIsNone(storage.get_user_by_id(user["id"]))
        logs = storage.list_download_logs()["items"]
        self.assertEqual(len(logs), 1)
        self.assertIsNone(logs[0]["user_id"])
        self.assertEqual(logs[0]["identifier"], "student1@example.com")

    def test_log_for_an_account_deleted_mid_download_is_kept_detached(self):
        user = self.make_user(1)
        self.assertTrue(storage.delete_user(user["id"]))

        storage.add_download_log(user_id=user["id"], identifier=user["email"],
                                 url="https://youtu.be/a", title="Late")

        log = storage.list_download_logs()["items"][0]
        self.assertEqual((log["title"], log["user_id"]), ("Late", None))

    def test_list_users_search_filters_sorts_and_pages(self):
        people = [
            self.make_user(1, name="Charlie", note="100% sure"),
            self.make_user(2, name="Alice", note="1000 sure"),
            self.make_user(3, name="Bob", note="a_b"),
            self.make_user(4, name="Rahim (CSE), DU", note="axb"),
            self.make_user(5, name="নাসির উদ্দিন"),
        ]
        storage.update_user(people[1]["id"], {"status": "approved"})
        storage.update_user(people[2]["id"], {"status": "blocked"})

        def names(**kwargs):
            return [user["name"] for user in storage.list_users(**kwargs)["items"]]

        newest_first = storage.list_users()
        self.assertEqual(newest_first["total"], 5)
        self.assertEqual([u["id"] for u in newest_first["items"]], [p["id"] for p in reversed(people)])
        self.assertEqual(names(sort="name", order="asc")[:3], ["Alice", "Bob", "Charlie"])
        self.assertEqual(names(status="approved"), ["Alice"])
        self.assertEqual(names(status="all"), names())
        self.assertEqual(names(q="100%"), ["Charlie"])
        self.assertEqual(names(q="a_b"), ["Bob"])
        self.assertEqual(names(q="(CSE), DU"), ["Rahim (CSE), DU"])
        self.assertEqual(names(q="নাসি"), ["নাসির উদ্দিন"])
        self.assertEqual(names(q="STUDENT2@EXAMPLE"), ["Alice"])
        self.assertEqual(names(q="+8801710000003"), ["Bob"])
        self.assertEqual(names(q='x"y\\'), [])
        self.assertEqual(names(q="sure", status="pending"), ["Charlie"])

        first_page = storage.list_users(page=1, page_size=2)
        third_page = storage.list_users(page=3, page_size=2)
        past_end = storage.list_users(page=9, page_size=2)
        self.assertEqual((len(first_page["items"]), first_page["total"]), (2, 5))
        self.assertEqual([u["id"] for u in third_page["items"]], [people[0]["id"]])
        self.assertEqual((past_end["items"], past_end["total"]), ([], 5))
        self.assertEqual(len(storage.list_users(page_size=1000)["items"]), 5)
        with self.assertRaises(ValueError):
            storage.list_users(status="admin")

    def test_sort_by_last_login_puts_never_logged_in_last(self):
        first, second, never = self.make_user(1), self.make_user(2), self.make_user(3)
        storage.update_user(first["id"], {"last_login_at": datetime(2026, 1, 1, tzinfo=timezone.utc)})
        storage.update_user(second["id"], {"last_login_at": datetime(2026, 2, 1, tzinfo=timezone.utc)})

        ordered = storage.list_users(sort="last_login_at", order="desc")["items"]
        self.assertEqual([u["id"] for u in ordered], [second["id"], first["id"], never["id"]])
        ordered = storage.list_users(sort="last_login_at", order="asc")["items"]
        self.assertEqual([u["id"] for u in ordered], [first["id"], second["id"], never["id"]])

    def test_user_status_counts(self):
        for n in range(1, 5):
            self.make_user(n)
        storage.update_user(storage.get_user_by_login("student1@example.com")["id"], {"status": "approved"})
        storage.update_user(storage.get_user_by_login("student2@example.com")["id"], {"status": "blocked"})

        self.assertEqual(
            storage.user_status_counts(),
            {"total": 4, "pending": 2, "approved": 1, "blocked": 1},
        )

    def test_download_counter_increments_and_rolls_over_daily(self):
        user = self.make_user(1)
        monday, tuesday = date(2026, 10, 5), date(2026, 10, 6)

        self.assertEqual(storage.record_user_download(user["id"], monday), 1)
        self.assertEqual(storage.record_user_download(user["id"], monday), 2)
        self.assertEqual(storage.record_user_download(user["id"], tuesday), 1)

        user = storage.get_user_by_id(user["id"])
        self.assertEqual(user["downloads_today"], 1)
        self.assertEqual(user["usage_date"], "2026-10-06")
        self.assertEqual(user["total_downloads"], 3)
        self.assertIsNotNone(user["last_download_at"])
        self.assertEqual(storage.record_user_download(str(uuid.uuid4()), tuesday), 0)
        self.assertEqual(storage.record_user_download("nope", tuesday), 0)

    # Logs --------------------------------------------------------------

    def add_logs(self):
        alice, bob = self.make_user(1), self.make_user(2)
        storage.add_download_log(
            user_id=alice["id"], identifier=alice["email"], url="https://youtu.be/one",
            title="Physics lecture 1", platform="YouTube", quality="1080p MP4", file_size=1234,
        )
        storage.add_download_log(
            user_id=bob["id"], identifier=bob["email"], url="https://www.facebook.com/reel/2",
            title="Campus reel", platform="Facebook", quality="MP3",
        )
        storage.add_download_log(
            user_id=alice["id"], identifier=alice["email"], url="https://www.instagram.com/p/3",
            title="100% (fun), really_cool", platform="Instagram", file_size=-5,
        )
        return alice, bob

    def test_logs_are_listed_newest_first_with_filters(self):
        alice, bob = self.add_logs()
        now = datetime.now(timezone.utc)

        page = storage.list_download_logs()
        self.assertEqual(page["total"], 3)
        self.assertEqual([log["platform"] for log in page["items"]], ["Instagram", "Facebook", "YouTube"])
        first = page["items"][-1]
        self.assertEqual(first["user_id"], alice["id"])
        self.assertEqual((first["quality"], first["file_size"]), ("1080p MP4", 1234))
        self.assertIsNone(page["items"][0]["file_size"])
        self.assertRegex(first["created_at"], r"\+00:00$")

        def titles(**filters):
            return [log["title"] for log in storage.list_download_logs(**filters)["items"]]

        self.assertEqual(titles(platform="youtube"), ["Physics lecture 1"])
        self.assertEqual(titles(user_id=bob["id"]), ["Campus reel"])
        self.assertEqual(titles(user_id="not-an-id"), [])
        self.assertEqual(titles(q="physics"), ["Physics lecture 1"])
        self.assertEqual(titles(q="facebook.com/reel"), ["Campus reel"])
        self.assertEqual(titles(q="student2@"), ["Campus reel"])
        self.assertEqual(titles(q="100% (fun), really_"), ["100% (fun), really_cool"])
        self.assertEqual(titles(q="really%cool"), [])
        self.assertEqual(len(titles(date_from=now - timedelta(hours=1), date_to=now + timedelta(hours=1))), 3)
        self.assertEqual(titles(date_to=now - timedelta(hours=1)), [])
        self.assertEqual(titles(date_from=now + timedelta(hours=1)), [])

        paged = storage.list_download_logs(page=2, page_size=2)
        self.assertEqual((paged["total"], [log["title"] for log in paged["items"]]), (3, ["Physics lecture 1"]))
        self.assertEqual(storage.list_download_logs(page=5, page_size=2)["items"], [])

    def test_iter_download_logs_walks_every_page_in_order(self):
        self.add_logs()
        user = self.make_user(3)
        for n in range(4):
            storage.add_download_log(user_id=user["id"], identifier=user["email"],
                                     url=f"https://youtu.be/{n}", title=f"Batch {n}", platform="YouTube")
        expected = [log["id"] for log in storage.list_download_logs(page_size=200)["items"]]

        with patch.object(storage, "REMOTE_PAGE_SIZE", 2):
            exported = [log["id"] for log in storage.iter_download_logs()]
            limited = [log["id"] for log in storage.iter_download_logs(limit=3)]
            youtube = [log["title"] for log in storage.iter_download_logs(platform="YouTube")]

        self.assertEqual(exported, expected)
        self.assertEqual(limited, expected[:3])
        self.assertEqual(youtube, ["Batch 3", "Batch 2", "Batch 1", "Batch 0", "Physics lecture 1"])
        self.assertEqual(list(storage.iter_download_logs(user_id="bad")), [])

    def test_delete_and_purge_logs(self):
        self.add_logs()
        ids = [log["id"] for log in storage.list_download_logs()["items"]]

        self.assertEqual(storage.delete_download_logs([ids[0], ids[0], "junk", str(uuid.uuid4()), "424242"]), 1)
        self.assertEqual(storage.delete_download_logs([]), 0)
        self.assertEqual(storage.count_download_logs(), 2)
        self.assertEqual(storage.purge_download_logs(before=datetime.now(timezone.utc) - timedelta(days=1)), 0)
        self.assertEqual(storage.count_download_logs(), 2)
        self.assertEqual(storage.purge_download_logs(before=datetime.now(timezone.utc) + timedelta(minutes=5)), 2)
        self.add_logs_for_purge_all()
        self.assertEqual(storage.purge_download_logs(before=None), 2)
        self.assertEqual(storage.count_download_logs(), 0)

    def add_logs_for_purge_all(self):
        for n in range(2):
            storage.add_download_log(user_id=None, identifier="x@example.com", url=f"https://youtu.be/{n}")

    def test_download_stats_group_by_day_and_platform(self):
        self.add_logs()
        storage.add_download_log(user_id=None, identifier="x@example.com", url="https://youtu.be/z",
                                 title="Again", platform="YouTube")
        today = datetime.now(timezone.utc).date()

        stats = storage.download_stats(since=datetime.now(timezone.utc) - timedelta(days=2), tz="UTC")
        self.assertEqual(
            stats,
            [
                {"day": today.isoformat(), "platform": "Facebook", "downloads": 1},
                {"day": today.isoformat(), "platform": "Instagram", "downloads": 1},
                {"day": today.isoformat(), "platform": "YouTube", "downloads": 2},
            ],
        )
        self.assertEqual(storage.download_stats(since=datetime.now(timezone.utc) + timedelta(hours=1), tz="UTC"), [])

    # Settings and schema --------------------------------------------------

    def test_settings_have_seeded_default_and_round_trip(self):
        self.assertEqual(storage.get_setting("default_daily_limit"), "4")
        self.assertIsNone(storage.get_setting("missing_key"))
        self.assertEqual(storage.get_setting("missing_key", "fallback"), "fallback")

        storage.set_setting("default_daily_limit", "7")
        storage.set_setting("default_daily_limit", 8)
        self.assertEqual(storage.get_setting("default_daily_limit"), "8")

    def test_schema_is_ready(self):
        status = storage.schema_status(refresh=True)
        self.assertEqual((status["ready"], status["missing"]), (True, []))
        self.assertIn("checked_at", status)
        diagnostics = storage.storage_diagnostics()
        self.assertTrue(diagnostics["reachable"])
        self.assertTrue(diagnostics["schema"]["ready"])
        self.assertEqual(diagnostics["download_log_count"], 0)


class SQLiteStorageTests(StorageStateMixin, StorageContract, unittest.TestCase):
    def setUp(self):
        self.save_storage_state()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.use_sqlite(Path(self.temp_dir.name) / "test.sqlite3")

    def tearDown(self):
        self.restore_storage_state()
        self.temp_dir.cleanup()

    def insert_raw_log(self, created_at, platform="YouTube"):
        conn = storage._get_local_conn()
        with storage._local_lock:
            conn.execute(
                "INSERT INTO download_logs (identifier, url, title, platform, created_at) VALUES (?, ?, ?, ?, ?)",
                ("x@example.com", "https://youtu.be/x", "t", platform, storage._db_ts(created_at)),
            )
            conn.commit()

    def test_stats_use_the_local_calendar_day(self):
        # 17:59 UTC is 23:59 in Dhaka; 18:00 UTC is already the next day there.
        self.insert_raw_log(datetime(2026, 10, 5, 17, 59, tzinfo=timezone.utc))
        self.insert_raw_log(datetime(2026, 10, 5, 18, 0, tzinfo=timezone.utc))
        self.insert_raw_log(datetime(2026, 10, 1, tzinfo=timezone.utc), platform="Facebook")

        since = datetime(2026, 10, 4, tzinfo=timezone.utc)
        self.assertEqual(
            storage.download_stats(since=since, tz="Asia/Dhaka"),
            [
                {"day": "2026-10-05", "platform": "YouTube", "downloads": 1},
                {"day": "2026-10-06", "platform": "YouTube", "downloads": 1},
            ],
        )
        self.assertEqual(
            storage.download_stats(since=since, tz="UTC"),
            [{"day": "2026-10-05", "platform": "YouTube", "downloads": 2}],
        )
        with self.assertRaises(ValueError):
            storage.download_stats(since=since, tz="Mars/Base")

    def test_date_range_start_is_inclusive_and_end_exclusive(self):
        moment = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)
        self.insert_raw_log(moment)

        self.assertEqual(storage.list_download_logs(date_from=moment)["total"], 1)
        self.assertEqual(storage.list_download_logs(date_to=moment)["total"], 0)
        self.assertEqual(storage.list_download_logs(date_to=moment + timedelta(milliseconds=1))["total"], 1)
        # Naive datetimes are UTC.
        self.assertEqual(storage.list_download_logs(date_from=moment.replace(tzinfo=None))["total"], 1)

    def test_purge_before_counts_only_older_rows(self):
        self.insert_raw_log(datetime(2025, 1, 1, tzinfo=timezone.utc))
        self.insert_raw_log(datetime(2026, 1, 1, tzinfo=timezone.utc))

        self.assertEqual(storage.purge_download_logs(before=datetime(2025, 6, 1, tzinfo=timezone.utc)), 1)
        self.assertEqual(storage.count_download_logs(), 1)

    def test_parallel_downloads_are_counted_exactly(self):
        user = self.make_user(1)
        today = date(2026, 10, 6)

        def worker():
            for _ in range(25):
                storage.record_user_download(user["id"], today)

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        user = storage.get_user_by_id(user["id"])
        self.assertEqual((user["downloads_today"], user["total_downloads"]), (200, 200))

    def test_long_titles_and_urls_are_truncated(self):
        storage.add_download_log(user_id=None, identifier="x@example.com",
                                 url="https://youtu.be/" + "a" * 5000, title="t" * 5000)
        log = storage.list_download_logs()["items"][0]
        self.assertEqual(len(log["title"]), storage.MAX_LOG_TITLE_LENGTH)
        self.assertEqual(len(log["url"]), storage.MAX_LOG_URL_LENGTH)

    def test_migration_sql_is_served_from_the_backend_copy(self):
        backend_copy = (BACKEND_DIR / "sql" / "migration_v2.sql").read_text(encoding="utf-8")
        root_copy = (BACKEND_DIR.parent / "supabase_migration_v2.sql").read_text(encoding="utf-8")
        self.assertEqual(storage.migration_sql(), backend_copy)
        self.assertEqual(backend_copy, root_copy, "keep both migration files identical")
        self.assertIn("record_user_download", backend_copy)


class LegacySQLiteMigrationTests(StorageStateMixin, unittest.TestCase):
    def setUp(self):
        self.save_storage_state()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path = Path(self.temp_dir.name) / "legacy.sqlite3"

    def tearDown(self):
        self.restore_storage_state()
        self.temp_dir.cleanup()

    def build_v1_database(self):
        conn = sqlite3.connect(self.path)
        conn.executescript(V1_SQLITE_SCHEMA)
        conn.executemany(
            "INSERT INTO users (identifier, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
            [
                ("nasir@example.com", "approved", "2026-07-15 18:32:08", "2026-07-15 18:32:47"),
                ("pending@example.com", "pending", "2026-07-15 18:31:33", "2026-07-15 18:31:33"),
                ("01712345678", "pending", "2026-07-01 00:00:00", "2026-07-01 00:00:00"),
                ("+8801712345678", "approved", "2026-07-02 00:00:00", "2026-07-02 00:00:00"),
                ("8801812345678", "blocked", "2026-07-03 00:00:00", "2026-07-03 00:00:00"),
                ("not-a-phone", "pending", "2026-07-04 00:00:00", "2026-07-04 00:00:00"),
            ],
        )
        conn.executemany(
            "INSERT INTO download_logs (identifier, url, title, platform, created_at) VALUES (?, ?, ?, ?, ?)",
            [
                ("nasir@example.com", "https://www.facebook.com/share/v/1/", "Leo", "Facebook", "2026-07-15 18:34:06"),
                ("nasir@example.com", "https://www.facebook.com/share/v/1/", "", "", "2026-07-15 18:34:18"),
                ("nasir@example.com", "https://youtu.be/abc", "Lecture", "Youtube", "2026-07-16 18:34:18"),
                ("+8801712345678", "https://www.instagram.com/reel/x/", "Reel", "Instagram", "2026-07-17 00:00:00"),
                ("ghost@example.com", "https://www.tiktok.com/@a/video/1", "Tik", "TikTok", "2026-07-18 00:00:00"),
                ("ghost@example.com", "https://evilyoutube.com/x", "Fake", "", "2026-07-18 01:00:00"),
            ],
        )
        conn.commit()
        conn.close()

    def open_with_storage(self):
        if storage._local_conn is not None:
            storage._local_conn.close()
        self.use_sqlite(self.path)
        storage._get_local_conn()

    def test_v1_database_is_upgraded_in_place_without_losing_rows(self):
        self.build_v1_database()
        self.open_with_storage()

        users = {u["identifier"]: u for u in storage.list_users(page_size=100)["items"]}
        self.assertEqual(len(users), 6)
        nasir = users["nasir@example.com"]
        self.assertEqual(nasir["email"], "nasir@example.com")
        self.assertEqual(nasir["approved_at"], "2026-07-15T18:32:47+00:00")
        self.assertEqual(nasir["created_at"], "2026-07-15T18:32:08+00:00")
        self.assertEqual(nasir["total_downloads"], 2)  # untitled duplicate not counted
        self.assertEqual(nasir["last_download_at"], "2026-07-16T18:34:18+00:00")
        self.assertIsNone(nasir["password_hash"])
        # Two identifiers map to the same number: the approved account owns it.
        self.assertEqual(users["+8801712345678"]["phone"], "+8801712345678")
        self.assertIsNone(users["01712345678"]["phone"])
        self.assertEqual(users["8801812345678"]["phone"], "+8801812345678")
        self.assertIsNone(users["not-a-phone"]["phone"])
        self.assertIsNone(users["pending@example.com"]["approved_at"])
        self.assertEqual(storage.get_user_by_login("+8801712345678")["id"], users["+8801712345678"]["id"])
        self.assertEqual(storage.get_user_by_login("01712345678")["id"], users["01712345678"]["id"])

        logs = storage.list_download_logs(page_size=200)["items"]
        self.assertEqual(len(logs), 6)
        self.assertEqual(
            [log["platform"] for log in logs],
            ["", "TikTok", "Instagram", "YouTube", "Facebook", "Facebook"],
        )
        self.assertEqual({log["user_id"] for log in logs if log["identifier"] == "nasir@example.com"}, {nasir["id"]})
        self.assertIsNone(logs[0]["user_id"])
        self.assertEqual(storage.get_setting("default_daily_limit"), "4")

        with self.assertRaises(storage.DuplicateUserError):
            storage.create_user(name="Again", email="Nasir@example.com", phone="+8801700000000")
        new = storage.create_user(name="New", email="new@example.com", phone="+8801700000001")
        self.assertEqual(storage.list_users()["items"][0]["id"], new["id"])

        raw = sqlite3.connect(self.path)
        self.assertEqual(raw.execute("PRAGMA user_version").fetchone()[0], 2)
        formats = {row[0] for row in raw.execute("SELECT length(created_at) FROM download_logs")}
        self.assertEqual(formats, {len("2026-07-15T18:34:06.000+00:00")})
        raw.close()

    def test_upgrade_is_idempotent(self):
        self.build_v1_database()
        self.open_with_storage()
        before = (storage.list_users(page_size=100), storage.list_download_logs(page_size=200))

        self.open_with_storage()

        self.assertEqual((storage.list_users(page_size=100), storage.list_download_logs(page_size=200)), before)

    def test_committed_seed_database_upgrades_and_keeps_rows(self):
        seed = BACKEND_DIR / "unistream_local.sqlite3"
        shutil.copy2(seed, self.path)
        raw = sqlite3.connect(self.path)
        counts = [raw.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in ("users", "download_logs")]
        raw.close()

        self.open_with_storage()

        self.assertEqual(storage.user_status_counts()["total"], counts[0])
        self.assertEqual(storage.count_download_logs(), counts[1])
        self.assertTrue(storage.schema_status()["ready"])


@unittest.skipUnless(POSTGREST_URL and POSTGREST_KEY, "set UNISTREAM_TEST_POSTGREST_URL/_KEY to run")
class PostgrestStorageTests(StorageStateMixin, StorageContract, unittest.TestCase):
    """The Supabase code path against a real PostgREST (disposable database!)."""

    def setUp(self):
        from supabase import ClientOptions, create_client

        self.save_storage_state()
        client = create_client("http://localhost", POSTGREST_KEY, options=ClientOptions(postgrest_client_timeout=10))
        client.rest_url = POSTGREST_URL.rstrip("/")
        storage._supabase = client
        storage.SUPABASE_CONFIGURED = True
        storage._local_conn = None
        storage.purge_download_logs(before=None)
        client.table("users").delete().not_.is_("id", "null").execute()
        storage.set_setting("default_daily_limit", "4")
        storage._clear_caches()

    def tearDown(self):
        self.restore_storage_state()

    def test_remote_bulk_reads_use_server_counts(self):
        user = self.make_user(1)
        storage.add_download_log(user_id=user["id"], identifier=user["email"], url="https://youtu.be/x")
        self.assertEqual(storage.count_download_logs(), 1)
        self.assertEqual(storage.delete_download_logs([storage.list_download_logs()["items"][0]["id"]]), 1)


class SupabaseHelperTests(unittest.TestCase):
    """Query building and error handling that need no network."""

    def test_search_is_escaped_for_postgrest_and_like(self):
        term = storage._clean_search('  a,b(c)%_*  "q"\\ \x00 ')
        self.assertEqual(term, "a,b(c)%_* q")
        self.assertEqual(
            storage._postgrest_search(("name", "email"), term),
            'name.ilike."*a,b(c)\\\\%\\\\__ q*",email.ilike."*a,b(c)\\\\%\\\\__ q*"',
        )
        self.assertEqual(storage._clean_search("x" * 300), "x" * 100)
        self.assertEqual(storage._clean_search(None), "")
        self.assertEqual(storage._postgrest_quote('a"b\\c'), '"a\\"b\\\\c"')
        clause, params = storage._local_search(("name",), "50%_off")
        self.assertEqual(clause, "(COALESCE(name, '') LIKE ? ESCAPE '\\')")
        self.assertEqual(params, ["%50\\%\\_off%"])

    def test_schema_errors_are_recognised(self):
        for code in ("42703", "42883", "42P01", "PGRST202", "PGRST204", "PGRST205"):
            self.assertTrue(storage._is_schema_error(api_error(code)), code)
        self.assertTrue(storage._is_schema_error(api_error(
            None, "Could not find the 'phone' column of 'users' in the schema cache")))
        for error in (api_error("23505"), api_error("PGRST116"), OSError("down"), ValueError("x")):
            self.assertFalse(storage._is_schema_error(error))

    def test_transient_errors_are_retried_and_writes_only_when_unsent(self):
        transient = [httpx.ConnectError("x"), httpx.ReadTimeout("x"), api_error("57014"),
                     api_error("PGRST001"), api_error("40001"), api_error(502), OSError("reset")]
        permanent = [api_error("23514"), api_error("PGRST116"), api_error("22P02"), api_error(404),
                     ValueError("bug"), KeyError("bug")]
        for error in transient:
            self.assertTrue(storage._is_transient(error), repr(error))
        for error in permanent:
            self.assertFalse(storage._is_transient(error), repr(error))

        unsent = [httpx.ConnectError("x"), httpx.ConnectTimeout("x"), httpx.PoolTimeout("x"),
                  api_error("PGRST000"), api_error("PGRST003")]
        maybe_sent = [httpx.ReadTimeout("x"), api_error("57014"), api_error(502), OSError("reset")]
        for error in unsent:
            self.assertTrue(storage._never_reached_database(error), repr(error))
        for error in maybe_sent:
            self.assertFalse(storage._never_reached_database(error), repr(error))

    def test_duplicate_field_comes_from_the_constraint(self):
        self.assertEqual(storage._duplicate_field(
            'duplicate key value violates unique constraint "users_phone_key"'), "phone")
        self.assertEqual(storage._duplicate_field(
            'duplicate key value violates unique constraint "users_email_key"',
            "Key (email)=(phone@example.com) already exists."), "email")
        self.assertEqual(storage._duplicate_field(None, "Key (phone)=(+880) already exists."), "phone")
        self.assertEqual(storage._duplicate_field("UNIQUE constraint failed: users.phone"), "phone")
        self.assertEqual(storage._duplicate_field("UNIQUE constraint failed: users.identifier"), "email")
        self.assertEqual(storage._duplicate_field(None), "email")

    def test_content_range_totals(self):
        self.assertEqual(storage._content_range_total("0-24/310"), 310)
        self.assertEqual(storage._content_range_total("*/12"), 12)
        self.assertEqual(storage._content_range_total("*/0"), 0)
        self.assertEqual(storage._content_range_total("0-4/*"), 5)
        self.assertEqual(storage._content_range_total(None), 0)

    def test_execute_for_count_reads_the_header_and_raises_api_errors(self):
        class FakeSession:
            def __init__(self, response):
                self.response = response
                self.calls = []

            def request(self, method, path, **kwargs):
                self.calls.append((method, path, kwargs))
                return self.response

        class FakeBuilder:
            def __init__(self, response):
                self.session = FakeSession(response)
                self.http_method, self.path, self.json = "DELETE", "/download_logs", {}
                self.params = httpx.QueryParams({"id": "not.is.null"})
                self.headers = httpx.Headers({"Prefer": "return=minimal,count=exact"})

        request = httpx.Request("DELETE", "http://db/download_logs")
        ok = FakeBuilder(httpx.Response(204, headers={"content-range": "*/42"}, request=request))
        self.assertEqual(storage._execute_for_count(ok), 42)
        self.assertEqual(ok.session.calls[0][2]["headers"]["prefer"], "return=minimal,count=exact")

        failed = FakeBuilder(httpx.Response(400, json={"code": "42703", "message": "column x"}, request=request))
        with self.assertRaises(APIError) as error:
            storage._execute_for_count(failed)
        self.assertEqual(error.exception.code, "42703")

        gateway = FakeBuilder(httpx.Response(502, text="<html>Bad gateway</html>", request=request))
        with self.assertRaises(APIError) as error:
            storage._execute_for_count(gateway)
        self.assertTrue(storage._is_transient(error.exception))

    def test_legacy_value_mapping(self):
        self.assertEqual(storage._legacy_phone("01712345678"), "+8801712345678")
        self.assertEqual(storage._legacy_phone(" 8801712345678 "), "+8801712345678")
        self.assertEqual(storage._legacy_phone("+8801712345678"), "+8801712345678")
        for value in ("01212345678", "0171234567", "+15551234567", "a@b.com", None, "০১৭১২৩৪৫৬৭৮"):
            self.assertIsNone(storage._legacy_phone(value), value)

        self.assertEqual(storage._legacy_platform_label("Youtube", ""), "YouTube")
        self.assertEqual(storage._legacy_platform_label("FacebookReel", ""), "Facebook")
        self.assertEqual(storage._legacy_platform_label("", "https://m.youtube.com/watch?v=1"), "YouTube")
        self.assertEqual(storage._legacy_platform_label(None, "https://fb.watch/x"), "Facebook")
        self.assertEqual(storage._legacy_platform_label("", "https://instagr.am/p/x"), "Instagram")
        self.assertIsNone(storage._legacy_platform_label("", "https://evilyoutube.com/x"))
        self.assertIsNone(storage._legacy_platform_label("TikTok", "https://www.tiktok.com/x"))
        self.assertIsNone(storage._legacy_platform_label("", "ftp://youtube.com/x"))

    def test_timestamps_are_normalised(self):
        self.assertEqual(storage._iso("2026-07-15 18:31:33"), "2026-07-15T18:31:33+00:00")
        self.assertEqual(storage._iso("2026-10-06T16:00:00.123456+06:00"), "2026-10-06T10:00:00+00:00")
        self.assertEqual(storage._iso("2026-10-06T10:00:00Z"), "2026-10-06T10:00:00+00:00")
        self.assertIsNone(storage._iso(None))
        moment = datetime(2026, 10, 6, 10, 0, 0, 987654, tzinfo=timezone.utc)
        self.assertEqual(storage._db_ts(moment), "2026-10-06T10:00:00.987+00:00")
        self.assertEqual(storage._remote_ts(moment.replace(tzinfo=None)), "2026-10-06T10:00:00.987654+00:00")


class RemoteRetryTests(StorageStateMixin, unittest.TestCase):
    def setUp(self):
        self.save_storage_state()
        self.temp_dir = tempfile.TemporaryDirectory()
        storage.LOCAL_DB_PATH = Path(self.temp_dir.name) / "never.sqlite3"
        storage._local_conn = None
        storage.SUPABASE_CONFIGURED = True
        self.sleep = patch.object(storage.time, "sleep").start()
        self.addCleanup(patch.stopall)
        storage._supabase = object()

    def tearDown(self):
        self.restore_storage_state()
        self.temp_dir.cleanup()

    def failing(self, *errors):
        calls = []

        def callback(_client):
            calls.append(1)
            error = errors[min(len(calls), len(errors)) - 1]
            if error is None:
                return "ok"
            raise error

        return callback, calls

    def test_configured_remote_failure_never_falls_back_to_sqlite(self):
        with (
            patch.object(storage, "_get_supabase", side_effect=OSError("network down")),
            self.assertRaises(storage.StorageUnavailableError),
        ):
            storage.get_user("student@example.com")

        self.assertTrue(storage.SUPABASE_CONFIGURED)
        self.assertIsNone(storage._local_conn)
        self.assertFalse(storage.LOCAL_DB_PATH.exists())

    def test_export_errors_surface_before_streaming_starts(self):
        with (
            patch.object(storage, "_get_supabase", side_effect=httpx.ConnectError("down")),
            self.assertRaises(storage.StorageUnavailableError),
        ):
            storage.iter_download_logs()  # no next(): the first batch is eager

    def test_transient_failures_are_retried(self):
        callback, calls = self.failing(httpx.ConnectError("x"), api_error("57014"), None)
        self.assertEqual(storage._remote("read", callback), "ok")
        self.assertEqual(len(calls), 3)
        self.assertIsNone(storage._last_remote_error)

        callback, calls = self.failing(httpx.ReadTimeout("x"))
        with self.assertRaises(storage.StorageUnavailableError) as error:
            storage._remote("read", callback)
        self.assertEqual(len(calls), 3)
        self.assertIsInstance(error.exception.__cause__, httpx.ReadTimeout)
        self.assertIn("read: ReadTimeout", storage._last_remote_error)

    def test_permanent_errors_fail_fast(self):
        callback, calls = self.failing(api_error("22P02", "invalid input syntax"))
        with self.assertRaises(storage.StorageUnavailableError):
            storage._remote("read", callback)
        self.assertEqual(len(calls), 1)

    def test_writes_retry_only_when_the_request_never_arrived(self):
        callback, calls = self.failing(httpx.ReadTimeout("x"), None)
        with self.assertRaises(storage.StorageUnavailableError):
            storage._remote("count", callback, idempotent=False)
        self.assertEqual(len(calls), 1)

        callback, calls = self.failing(httpx.ConnectError("x"), api_error("PGRST003"), None)
        self.assertEqual(storage._remote("count", callback, idempotent=False), "ok")
        self.assertEqual(len(calls), 3)

    def test_schema_and_duplicate_errors_are_specific(self):
        storage._schema_cache = {"status": {"ready": True, "missing": []}, "expires": float("inf")}
        callback, calls = self.failing(api_error("PGRST204", "Could not find the 'email' column"))
        with self.assertRaises(storage.SchemaOutdatedError) as error:
            storage._remote("update user", callback)
        self.assertEqual(len(calls), 1)
        self.assertIsInstance(error.exception, storage.StorageUnavailableError)
        self.assertIn("supabase_migration_v2.sql", str(error.exception))
        self.assertIn("upgrade required", str(error.exception))
        self.assertIsNone(storage._schema_cache, "a schema error must force a fresh probe")

        callback, calls = self.failing(api_error(
            "23505", 'duplicate key value violates unique constraint "users_phone_key"'))
        with self.assertRaises(storage.DuplicateUserError) as duplicate:
            storage._remote("create user", callback, idempotent=False)
        self.assertEqual((duplicate.exception.field, len(calls)), ("phone", 1))

    def test_schema_probe_lists_what_is_missing(self):
        class Query:
            def __init__(self, client, columns):
                self.client, self.columns = client, columns

            def limit(self, _n):
                return self

            def execute(self):
                missing = [c for c in self.columns if c in self.client.missing]
                if missing:
                    raise api_error("42703", f"column {missing[0]} does not exist")
                return None

        class Table:
            def __init__(self, client, name):
                self.client, self.name = client, name

            def select(self, columns):
                if self.name in self.client.missing:
                    raise api_error("42P01", f'relation "public.{self.name}" does not exist')
                return Query(self.client, [f"{self.name}.{c}" for c in columns.split(",")])

        class Rpc:
            def __init__(self, client, name):
                self.client, self.name = client, name

            def execute(self):
                if f"{self.name}()" in self.client.missing:
                    raise api_error("PGRST202", "Could not find the function")
                if self.client.network_down:
                    raise httpx.ConnectError("down")

        class FakeClient:
            def __init__(self, missing, network_down=False):
                self.missing, self.network_down = set(missing), network_down

            def table(self, name):
                return Table(self, name)

            def rpc(self, name, _params):
                return Rpc(self, name)

        storage._supabase = FakeClient(["users.phone", "users.usage_date", "app_settings", "download_stats()"])
        status = storage.schema_status()
        self.assertEqual(status["ready"], False)
        self.assertEqual(status["missing"], ["users.phone", "users.usage_date", "app_settings", "download_stats()"])

        storage._supabase = FakeClient([])
        self.assertFalse(storage.schema_status()["ready"], "outdated result is cached briefly")
        self.assertEqual(storage.schema_status(refresh=True), {**storage.schema_status(), "ready": True, "missing": []})

        storage._supabase = FakeClient([], network_down=True)
        with self.assertRaises(storage.StorageUnavailableError):
            storage.schema_status(refresh=True)
        diagnostics_schema = storage._diagnostic_schema()
        self.assertTrue(diagnostics_schema["ready"], "last good result still cached")


if __name__ == "__main__":
    unittest.main()
