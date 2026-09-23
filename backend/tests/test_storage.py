import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import storage


class LocalStorageInvariantsTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_configured = storage.SUPABASE_CONFIGURED
        self.original_path = storage.LOCAL_DB_PATH
        self.original_conn = storage._local_conn

        storage.SUPABASE_CONFIGURED = False
        storage.LOCAL_DB_PATH = Path(self.temp_dir.name) / "test.sqlite3"
        storage._local_conn = None

    def tearDown(self):
        if storage._local_conn is not None:
            storage._local_conn.close()
        storage._local_conn = self.original_conn
        storage.LOCAL_DB_PATH = self.original_path
        storage.SUPABASE_CONFIGURED = self.original_configured
        self.temp_dir.cleanup()

    def test_pending_request_never_overwrites_admin_approval(self):
        storage.upsert_pending_user("Student@Example.com")
        storage.update_user_status("student@example.com", "approved")

        user = storage.upsert_pending_user("STUDENT@example.com")

        self.assertEqual(user["status"], "approved")

    def test_pending_request_never_overwrites_admin_block(self):
        storage.upsert_user("blocked@example.com", "blocked")

        user = storage.upsert_pending_user("blocked@example.com")

        self.assertEqual(user["status"], "blocked")

    def test_completed_download_is_recorded_with_metadata(self):
        storage.record_download(
            "student@example.com",
            "https://example.com/video",
            title="Course lecture",
            platform="Example",
        )

        logs = storage.list_download_logs()

        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["title"], "Course lecture")
        self.assertEqual(logs[0]["platform"], "Example")

    def test_configured_remote_failure_never_falls_back_to_sqlite(self):
        storage.SUPABASE_CONFIGURED = True

        with (
            patch.object(storage, "_get_supabase", side_effect=OSError("network down")),
            patch.object(storage.time, "sleep"),
            self.assertRaises(storage.StorageUnavailableError),
        ):
            storage.get_user("student@example.com")

        self.assertTrue(storage.SUPABASE_CONFIGURED)
        self.assertIsNone(storage._local_conn)


if __name__ == "__main__":
    unittest.main()
