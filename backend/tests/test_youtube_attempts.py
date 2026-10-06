import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yt_dlp
from fastapi.testclient import TestClient

import main
import yt_dlp_config
from routers import download as download_router


COMBINED_ONLY = [
    {"format_id": "18", "height": 360, "vcodec": "avc1", "acodec": "mp4a"},
]
FULL_LADDER = COMBINED_ONLY + [
    {"format_id": "137", "height": 1080, "vcodec": "avc1", "acodec": "none"},
    {"format_id": "140", "vcodec": "none", "acodec": "mp4a", "abr": 129},
]


def fake_youtube_dl(on_extract):
    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def extract_info(self, url, download):
            return on_extract(self.options, url, download)

    return FakeYoutubeDL


class YoutubeAttemptTests(unittest.TestCase):
    def setUp(self):
        cookie_patch = patch.object(
            yt_dlp_config, "_configured_cookiefile", return_value="cookies.txt"
        )
        cookie_patch.start()
        self.addCleanup(cookie_patch.stop)

    def test_youtube_tries_anonymous_before_cookies(self):
        attempts = yt_dlp_config.youtube_ydl_attempts("https://youtu.be/example")

        self.assertEqual([label for label, _ in attempts], ["anonymous", "cookies"])
        self.assertNotIn("cookiefile", attempts[0][1])
        self.assertEqual(attempts[1][1]["cookiefile"], "cookies.txt")

    def test_other_sites_never_receive_youtube_cookies(self):
        attempts = yt_dlp_config.youtube_ydl_attempts("https://www.facebook.com/watch?v=1")

        self.assertEqual(attempts, [("default", {})])

    def test_video_info_falls_back_when_only_a_360p_stream_is_listed(self):
        seen = []

        def extract(options, _url, _download):
            seen.append(options.get("cookiefile"))
            formats = FULL_LADDER if options.get("cookiefile") else COMBINED_ONLY
            return {"title": "Lecture", "extractor_key": "Youtube", "formats": formats}

        with patch.object(main, "get_user", return_value={"status": "approved"}), \
                patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(extract)):
            response = TestClient(main.app).post(
                "/video-info",
                json={"url": "https://youtu.be/example", "identifier": "student@example.com"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen, [None, "cookies.txt"])
        self.assertEqual(
            [item["resolution"] for item in response.json()["formats"]],
            ["1080p", "360p", "129kbps"],
        )

    def test_video_info_skips_cookies_when_anonymous_lists_every_resolution(self):
        seen = []

        def extract(options, _url, _download):
            seen.append(options.get("cookiefile"))
            return {"title": "Lecture", "extractor_key": "Youtube", "formats": FULL_LADDER}

        with patch.object(main, "get_user", return_value={"status": "approved"}), \
                patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(extract)):
            response = TestClient(main.app).post(
                "/video-info",
                json={"url": "https://youtu.be/example", "identifier": "student@example.com"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen, [None])

    def test_download_retries_with_cookies_instead_of_downgrading(self):
        calls = []
        tmp_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp_dir, ignore_errors=True)

        def extract(options, _url, _download):
            calls.append((options.get("cookiefile"), options["format"]))
            out_dir = Path(options["outtmpl"]).parent
            if not options.get("cookiefile"):
                (out_dir / "Lecture.f137.mp4.part").write_bytes(b"x" * 100)
                raise yt_dlp.utils.DownloadError("Requested format is not available")
            (out_dir / "Lecture.mp4").write_bytes(b"media")
            return {"title": "Lecture", "extractor_key": "Youtube"}

        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(extract)):
            download_router._download_with_fallback(
                "https://youtu.be/example", "137", "mp4", tmp_dir
            )

        self.assertEqual(calls, [
            (None, "137+bestaudio"),
            ("cookies.txt", "137+bestaudio/best"),
        ])
        self.assertEqual([p.name for p in Path(tmp_dir).iterdir()], ["Lecture.mp4"])


if __name__ == "__main__":
    unittest.main()
