import os
import unittest
from unittest.mock import MagicMock, patch

import httpx

import warp_proxy
import yt_dlp_config


class WarpProxyTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(self._reset)
        self._reset()

    @staticmethod
    def _reset():
        warp_proxy._state.update(status="off", detail=None)
        warp_proxy._process = None

    def test_off_unless_opted_in(self):
        for value, expected in (("", False), ("false", False), ("true", True), ("1", True)):
            with self.subTest(value=value), patch.dict(os.environ, {"YOUTUBE_WARP": value}):
                self.assertEqual(warp_proxy.enabled(), expected)

        with patch.dict(os.environ, {"YOUTUBE_WARP": ""}), \
                patch.object(warp_proxy.threading, "Thread") as thread:
            warp_proxy.start_in_background()
        thread.assert_not_called()
        self.assertEqual(warp_proxy.status(), "off")

    def test_not_started_off_linux(self):
        with patch.dict(os.environ, {"YOUTUBE_WARP": "true"}), \
                patch.object(warp_proxy.platform, "system", return_value="Windows"), \
                patch.object(warp_proxy.threading, "Thread") as thread:
            warp_proxy.start_in_background()
        thread.assert_not_called()
        self.assertTrue(warp_proxy.status().startswith("failed"))

    def test_proxy_only_while_wireproxy_runs(self):
        self.assertIsNone(warp_proxy.proxy_url())
        warp_proxy._state.update(status="ready")
        warp_proxy._process = MagicMock(poll=MagicMock(return_value=None))
        self.assertEqual(warp_proxy.proxy_url(), "socks5://127.0.0.1:40000")

        warp_proxy._process.poll.return_value = 1  # wireproxy exited
        self.assertIsNone(warp_proxy.proxy_url())
        self.assertEqual(warp_proxy.status(), "failed: wireproxy stopped")

    def test_download_rejects_a_changed_binary(self):
        response = httpx.Response(200, content=b"tampered", request=httpx.Request("GET", "https://x/y"))
        with patch.object(warp_proxy.httpx, "get", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                warp_proxy._download("https://x/y", "0" * 64)

    def test_youtube_uses_warp_unless_a_proxy_is_configured(self):
        warp_proxy._state.update(status="ready")
        warp_proxy._process = MagicMock(poll=MagicMock(return_value=None))
        with patch.dict(os.environ, {"YOUTUBE_PROXY": "", "YOUTUBE_WARP": "true"}):
            self.assertEqual(yt_dlp_config.youtube_proxy(), "socks5://127.0.0.1:40000")
            self.assertEqual(yt_dlp_config.youtube_proxy_status(), "Cloudflare WARP (ready)")
        with patch.dict(os.environ, {"YOUTUBE_PROXY": "http://u:p@proxy:1", "YOUTUBE_WARP": "true"}):
            self.assertEqual(yt_dlp_config.youtube_proxy(), "http://u:p@proxy:1")
            self.assertEqual(yt_dlp_config.youtube_proxy_status(), "configured")


if __name__ == "__main__":
    unittest.main()
