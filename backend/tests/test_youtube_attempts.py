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
SAFARI_HLS = COMBINED_ONLY + [
    {"format_id": "96", "height": 1080, "vcodec": "avc1", "acodec": "mp4a", "protocol": "m3u8_native"},
    {"format_id": "95", "height": 720, "vcodec": "avc1", "acodec": "mp4a", "protocol": "m3u8_native"},
]
STORYBOARDS_ONLY = [
    {"format_id": "sb0", "height": 90, "vcodec": "none", "acodec": "none"},
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
        auth_patch = patch.object(
            yt_dlp_config, "youtube_auth_mode", return_value="base64_cookie_secret"
        )
        auth_patch.start()
        self.addCleanup(auth_patch.stop)
        proxy_patch = patch.dict("os.environ", {"YOUTUBE_PROXY": ""})
        proxy_patch.start()
        self.addCleanup(proxy_patch.stop)

    def post_video_info(self, extract, url="https://youtu.be/example"):
        with patch.object(main, "get_user", return_value={"status": "approved"}), \
                patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(extract)):
            return TestClient(main.app).post(
                "/video-info", json={"url": url, "identifier": "student@example.com"},
            )

    def test_youtube_tries_anonymous_before_cookies(self):
        attempts = yt_dlp_config.youtube_ydl_attempts("https://youtu.be/example")

        self.assertEqual(
            [label for label, _ in attempts], ["anonymous", "cookies_safari", "cookies"]
        )
        self.assertNotIn("cookiefile", attempts[0][1])
        self.assertEqual(attempts[1][1]["cookiefile"], "cookies.txt")
        self.assertEqual(attempts[2][1]["cookiefile"], "cookies.txt")

    def test_safari_attempt_reads_the_player_response_from_the_watch_page(self):
        attempts = dict(yt_dlp_config.youtube_ydl_attempts("https://youtu.be/example"))

        youtube_args = attempts["cookies_safari"]["extractor_args"]["youtube"]
        self.assertEqual(youtube_args["player_client"], ["web_safari"])
        self.assertEqual(youtube_args["webpage_client"], ["web_safari"])

    def test_cookie_attempt_keeps_the_web_client_for_the_watch_page_stream(self):
        attempts = dict(yt_dlp_config.youtube_ydl_attempts("https://youtu.be/example"))

        clients = attempts["cookies"]["extractor_args"]["youtube"]["player_client"]
        self.assertIn("web", clients)

    def test_youtube_proxy_applies_to_every_youtube_attempt_only(self):
        with patch.dict("os.environ", {"YOUTUBE_PROXY": "http://proxy.example:8080"}):
            youtube = yt_dlp_config.youtube_ydl_attempts("https://youtu.be/example")
            other = yt_dlp_config.youtube_ydl_attempts("https://www.facebook.com/watch?v=1")

        for _label, options in youtube:
            self.assertEqual(options["proxy"], "http://proxy.example:8080")
        self.assertEqual(other, [("default", {})])

    def test_prefer_attempt_moves_the_listing_source_first(self):
        attempts = [("anonymous", {}), ("cookies_safari", {}), ("cookies", {})]

        self.assertEqual(
            [label for label, _ in yt_dlp_config.prefer_attempt(attempts, "cookies_safari")],
            ["cookies_safari", "anonymous", "cookies"],
        )
        self.assertEqual(yt_dlp_config.prefer_attempt(attempts, None), attempts)

    def test_other_sites_never_receive_youtube_cookies(self):
        attempts = yt_dlp_config.youtube_ydl_attempts("https://www.facebook.com/watch?v=1")

        self.assertEqual(attempts, [("default", {})])

    def test_video_info_falls_back_when_only_a_360p_stream_is_listed(self):
        seen = []

        def extract(options, _url, _download):
            seen.append(options.get("cookiefile"))
            formats = FULL_LADDER if options.get("cookiefile") else COMBINED_ONLY
            return {"title": "Lecture", "extractor_key": "Youtube", "formats": formats}

        response = self.post_video_info(extract)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(sorted(seen, key=str), sorted([None, "cookies.txt", "cookies.txt"], key=str))
        self.assertEqual(
            [item["resolution"] for item in response.json()["formats"]],
            ["1080p", "360p", "129kbps"],
        )

    def test_video_info_explains_rejected_cookies(self):
        def extract(options, _url, _download):
            if options.get("cookiefile"):
                raise yt_dlp.utils.DownloadError("Sign in to confirm you're not a bot")
            return {"title": "Lecture", "extractor_key": "Youtube", "formats": COMBINED_ONLY}

        response = self.post_video_info(extract)

        self.assertEqual(response.status_code, 200)
        self.assertIn("rejected the configured session cookies", response.json()["notice"])

    def test_video_info_lists_the_safari_hls_ladder_when_the_api_is_refused(self):
        def extract(options, _url, _download):
            youtube_args = options["extractor_args"]["youtube"]
            if youtube_args.get("webpage_client") == ["web_safari"]:
                formats = SAFARI_HLS
            elif options.get("cookiefile"):
                formats = COMBINED_ONLY
            else:
                raise yt_dlp.utils.DownloadError("Sign in to confirm you're not a bot")
            return {"title": "Lecture", "extractor_key": "Youtube", "formats": formats}

        response = self.post_video_info(extract)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(
            [item["resolution"] for item in body["formats"]], ["1080p", "720p", "360p", "128kbps"]
        )
        self.assertEqual(body["source"], "cookies_safari")
        self.assertIsNone(body["notice"])

    def test_video_info_explains_a_server_ip_that_youtube_refuses(self):
        def extract(_options, _url, _download):
            return {"title": "Lecture", "extractor_key": "Youtube", "formats": STORYBOARDS_ONLY}

        response = self.post_video_info(extract)

        self.assertEqual(response.status_code, 400)
        self.assertIn("refusing this server's IP address", response.json()["detail"])

    def test_video_info_explains_a_360p_only_listing_as_an_ip_block(self):
        def extract(_options, _url, _download):
            return {"title": "Lecture", "extractor_key": "Youtube", "formats": COMBINED_ONLY}

        response = self.post_video_info(extract)

        self.assertEqual(response.status_code, 200)
        self.assertIn("YOUTUBE_PROXY", response.json()["notice"])

    def test_other_sites_keep_formats_without_a_known_height(self):
        def extract(options, _url, _download):
            self.assertNotIn("ignore_no_formats_error", options)
            return {
                "title": "Clip", "extractor_key": "Facebook",
                "formats": [{"format_id": "hd", "url": "https://example.com/v.mp4"}],
            }

        response = self.post_video_info(extract, url="https://www.facebook.com/watch?v=1")

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["notice"])

    def test_player_api_403_is_reported_as_an_ip_block(self):
        message = yt_dlp_config.youtube_error_message(
            "https://youtu.be/example",
            Exception("Unable to download API page: HTTP Error 403: Forbidden"),
        )
        self.assertIn("refusing this server's IP address", message)

    def test_video_info_prefers_anonymous_when_both_list_every_resolution(self):
        seen = []

        def extract(options, _url, _download):
            seen.append(options.get("cookiefile"))
            return {"title": "Lecture", "extractor_key": "Youtube", "formats": FULL_LADDER}

        response = self.post_video_info(extract)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source"], "anonymous")
        self.assertIsNone(response.json()["notice"])

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
            ("cookies.txt", "137+bestaudio"),
        ])

    def test_download_starts_with_the_attempt_that_listed_the_format(self):
        calls = []
        tmp_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp_dir, ignore_errors=True)

        def extract(options, _url, _download):
            calls.append(options["extractor_args"]["youtube"].get("webpage_client"))
            (Path(options["outtmpl"]).parent / "Lecture.mp4").write_bytes(b"media")
            return {"title": "Lecture", "extractor_key": "Youtube"}

        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(extract)):
            download_router._download_with_fallback(
                "https://youtu.be/example", "96", "mp4", tmp_dir,
                height=1080, source="cookies_safari",
            )

        self.assertEqual(calls, [["web_safari"]])
        self.assertEqual([p.name for p in Path(tmp_dir).iterdir()], ["Lecture.mp4"])

    def test_download_matches_the_chosen_height_across_clients(self):
        selector = download_router._video_format_selector("137", 1080, False)
        self.assertEqual(
            selector, "137+bestaudio/bv*[height=1080]+bestaudio/b[height=1080]"
        )

        # A chosen height is never silently downgraded, even on the last attempt.
        self.assertEqual(download_router._video_format_selector("137", 1080, True), selector)
        self.assertEqual(
            download_router._video_format_selector("137", None, True),
            "137+bestaudio/bv*+bestaudio/best",
        )

    def test_cookie_attempt_uses_the_tv_client_for_the_full_ladder(self):
        attempts = dict(yt_dlp_config.youtube_ydl_attempts("https://youtu.be/example"))

        clients = attempts["cookies"]["extractor_args"]["youtube"]["player_client"]
        self.assertEqual(clients[0], "tv")

    def test_youtube_attempts_point_yt_dlp_at_deno(self):
        with patch.object(yt_dlp_config, "_find_deno", return_value="/venv/bin/deno"):
            attempts = yt_dlp_config.youtube_ydl_attempts("https://youtu.be/example")

        for _label, options in attempts:
            self.assertEqual(options["js_runtimes"], {"deno": {"path": "/venv/bin/deno"}})


    def test_youtube_attempts_extract_one_video_from_a_playlist_link(self):
        for _label, options in yt_dlp_config.youtube_ydl_attempts("https://youtu.be/example"):
            self.assertTrue(options["noplaylist"])

    def test_video_info_rejects_a_youtube_playlist(self):
        def extract(_options, _url, _download):
            return {"_type": "playlist", "title": "Course", "entries": []}

        response = self.post_video_info(extract, url="https://www.youtube.com/playlist?list=PL1")

        self.assertEqual(response.status_code, 400)
        self.assertIn("playlist", response.json()["detail"])

    def test_video_info_reports_the_real_reason_for_a_private_video(self):
        def extract(_options, _url, _download):
            raise yt_dlp.utils.DownloadError(
                "ERROR: [youtube] example: Private video. Sign in if you've been granted access"
            )

        response = self.post_video_info(extract)

        self.assertEqual(response.status_code, 400)
        self.assertIn("Private video", response.json()["detail"])
        self.assertNotIn("YOUTUBE_PROXY", response.json()["detail"])

    def test_anonymous_bot_check_is_not_blamed_on_the_cookies(self):
        def extract(options, _url, _download):
            if options.get("cookiefile"):
                raise yt_dlp.utils.DownloadError("Requested format is not available")
            raise yt_dlp.utils.DownloadError("Sign in to confirm you're not a bot")

        response = self.post_video_info(extract)

        self.assertEqual(response.status_code, 400)
        self.assertIn("refusing this server's IP address", response.json()["detail"])

    def test_video_info_names_an_unsolved_stream_challenge(self):
        def extract(options, _url, _download):
            options["logger"].warning(
                "[youtube] example: n challenge solving failed: Some formats may be missing."
            )
            return {"title": "Lecture", "extractor_key": "Youtube", "formats": COMBINED_ONLY}

        response = self.post_video_info(extract)

        self.assertEqual(response.status_code, 200)
        self.assertIn("challenge could not be solved", response.json()["notice"])

    def test_failed_listing_names_an_unsolved_stream_challenge(self):
        def extract(options, _url, _download):
            options["logger"].warning(
                "[youtube] example: n challenge solving failed: Some formats may be missing."
            )
            raise yt_dlp.utils.DownloadError("Requested format is not available")

        response = self.post_video_info(extract)

        self.assertEqual(response.status_code, 400)
        self.assertIn("challenge could not be solved", response.json()["detail"])

    def test_download_fails_instead_of_downgrading_a_chosen_height(self):
        tmp_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp_dir, ignore_errors=True)

        def extract(options, _url, _download):
            self.assertNotIn("best", options["format"].split("/"))
            raise yt_dlp.utils.DownloadError("Requested format is not available")

        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(extract)), \
                self.assertRaisesRegex(RuntimeError, "did not provide the 1080p stream"):
            download_router._download_with_fallback(
                "https://youtu.be/example", "96", "mp4", tmp_dir, height=1080,
            )

    def test_download_moves_on_after_a_failure_mid_stream(self):
        calls = []
        tmp_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp_dir, ignore_errors=True)

        def extract(options, _url, _download):
            calls.append(options.get("cookiefile"))
            if len(calls) == 1:
                raise ValueError("write to closed file")
            (Path(options["outtmpl"]).parent / "Lecture.mp4").write_bytes(b"media")
            return {"title": "Lecture", "extractor_key": "Youtube"}

        with patch.object(yt_dlp, "YoutubeDL", fake_youtube_dl(extract)):
            download_router._download_with_fallback(
                "https://youtu.be/example", "96", "mp4", tmp_dir, height=1080,
            )

        self.assertEqual(len(calls), 2)

    def test_downloads_fail_on_a_lost_hls_segment_and_mp3_avoids_hd_video(self):
        video = download_router._build_ydl_opts_video("96", "out", True, 1080)
        audio = download_router._build_ydl_opts_audio("out")

        for options in (video, audio):
            self.assertFalse(options["skip_unavailable_fragments"])
        self.assertEqual(audio["format"], "bestaudio/best[height<=480]/best")


class PrivateCookieFileTests(unittest.TestCase):
    def test_each_instance_gets_a_copy_and_rotated_cookies_are_kept(self):
        tmp_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp_dir, ignore_errors=True)
        shared = Path(tmp_dir) / "cookies.txt"
        shared.write_text("# Netscape HTTP Cookie File\noriginal\n")

        with yt_dlp_config.private_cookiefile({"cookiefile": str(shared)}) as options:
            private = Path(options["cookiefile"])
            self.assertNotEqual(private, shared)
            self.assertEqual(private.read_text(), shared.read_text())
            private.write_text("# Netscape HTTP Cookie File\nrotated\n")

        self.assertIn("rotated", shared.read_text())
        self.assertFalse(private.exists())

    def test_options_without_a_cookie_file_pass_through(self):
        with yt_dlp_config.private_cookiefile({"proxy": "x"}) as options:
            self.assertEqual(options, {"proxy": "x"})


if __name__ == "__main__":
    unittest.main()
