import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
import storage
from routers import download as download_router


class AccessControlApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_configured = storage.SUPABASE_CONFIGURED
        self.original_path = storage.LOCAL_DB_PATH
        self.original_conn = storage._local_conn
        self.original_secret = main.ADMIN_SECRET

        storage.SUPABASE_CONFIGURED = False
        storage.LOCAL_DB_PATH = Path(self.temp_dir.name) / "test.sqlite3"
        storage._local_conn = None
        main.ADMIN_SECRET = "test-admin-secret"
        self.client = TestClient(main.app)

    def tearDown(self):
        if storage._local_conn is not None:
            storage._local_conn.close()
        storage._local_conn = self.original_conn
        storage.LOCAL_DB_PATH = self.original_path
        storage.SUPABASE_CONFIGURED = self.original_configured
        main.ADMIN_SECRET = self.original_secret
        self.temp_dir.cleanup()

    def test_admin_approval_survives_repeated_access_checks(self):
        response = self.client.post(
            "/admin/users",
            headers={"x-admin-secret": "test-admin-secret"},
            json={"identifier": "Student@Example.com"},
        )
        self.assertEqual(response.status_code, 200)

        for _ in range(2):
            response = self.client.post(
                "/check-access",
                json={"identifier": "student@example.com"},
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["access"])

        self.assertEqual(storage.get_user("student@example.com")["status"], "approved")

    def test_status_change_requires_admin_secret(self):
        storage.upsert_pending_user("student@example.com")

        response = self.client.patch(
            "/admin/users/status",
            headers={"x-admin-secret": "wrong-secret"},
            json={"identifier": "student@example.com", "status": "approved"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(storage.get_user("student@example.com")["status"], "pending")

    def test_blank_identifier_is_rejected(self):
        response = self.client.post("/check-access", json={"identifier": "   "})
        self.assertEqual(response.status_code, 422)

    def test_completed_progress_download_creates_one_audit_log(self):
        storage.upsert_user("student@example.com", "approved")

        class FakeYoutubeDL:
            def __init__(self, options):
                self.options = options

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def extract_info(self, _url, download):
                self.assert_download = download
                output = Path(self.options["outtmpl"]).parent / "Course lecture.mp4"
                output.write_bytes(b"fake-media")
                for hook in self.options.get("progress_hooks", []):
                    hook({
                        "status": "downloading",
                        "downloaded_bytes": 10,
                        "total_bytes": 10,
                        "speed": 1024,
                        "eta": 0,
                    })
                    hook({"status": "finished", "filename": str(output)})
                return {"title": "Course lecture", "extractor_key": "Youtube"}

        with patch.object(download_router.yt_dlp, "YoutubeDL", FakeYoutubeDL):
            response = self.client.get(
                "/download/progress",
                params={
                    "url": "https://youtu.be/example",
                    "format_id": "137",
                    "identifier": "student@example.com",
                    "ext": "mp4",
                },
            )

        self.assertEqual(response.status_code, 200)
        events = [
            json.loads(line.removeprefix("data: "))
            for line in response.text.splitlines()
            if line.startswith("data: ")
        ]
        complete = next(event for event in events if event["status"] == "complete")
        token = complete["token"]
        token_entry = download_router._jobs[f"token:{token}"]
        output_parent = Path(token_entry["filename"]).parent

        try:
            file_response = self.client.get("/download/file", params={"token": token})
            self.assertEqual(file_response.status_code, 200)
            self.assertEqual(file_response.content, b"fake-media")
        finally:
            download_router._jobs.pop(f"token:{token}", None)
            shutil.rmtree(output_parent, ignore_errors=True)

        logs = storage.list_download_logs()
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["identifier"], "student@example.com")
        self.assertEqual(logs[0]["title"], "Course lecture")
        self.assertEqual(logs[0]["platform"], "Youtube")


if __name__ == "__main__":
    unittest.main()
