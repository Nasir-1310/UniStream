import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

import link_resolver


def fake_client(routes, seen):
    """httpx.Client whose GETs answer from `routes` {url: (status, location)}."""

    def handler(request: httpx.Request):
        url = str(request.url)
        seen.append(url)
        status, location = routes.get(url, (200, None))
        headers = {"location": location} if location else {}
        return httpx.Response(status, headers=headers, text="<html></html>")

    transport = httpx.MockTransport(handler)
    real_client = httpx.Client

    def factory(**kwargs):
        return real_client(transport=transport, **kwargs)

    return factory


class LinkResolverTests(unittest.TestCase):
    def setUp(self):
        link_resolver.clear_cache()
        self.addCleanup(link_resolver.clear_cache)

    def resolve(self, url, routes):
        seen = []
        with patch.object(link_resolver.httpx, "Client", fake_client(routes, seen)):
            return link_resolver.resolve_share_url(url), seen

    def test_only_share_and_short_links_are_resolved(self):
        for url in (
            "https://www.facebook.com/share/v/1MSKQhixa7/",
            "https://www.facebook.com/share/r/1AbCdEf/",
            "https://fb.watch/abc123/",
            "https://www.instagram.com/share/reel/BAbc/",
        ):
            self.assertTrue(link_resolver.needs_resolution(url), url)
        for url in (
            "https://www.facebook.com/watch/?v=123",
            "https://www.facebook.com/reel/123",
            "https://www.instagram.com/reel/abc/",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://evil.example/share/v/x",
        ):
            self.assertFalse(link_resolver.needs_resolution(url), url)

    def test_share_link_follows_redirects_on_facebook(self):
        share = "https://www.facebook.com/share/v/1MSKQhixa7/"
        target = "https://www.facebook.com/watch/?v=987654321"
        resolved, seen = self.resolve(share, {share: (302, target)})
        self.assertEqual(resolved, target)
        self.assertEqual(seen, [share])

    def test_login_wall_redirect_uses_its_next_target(self):
        share = "https://www.facebook.com/share/r/1AbCdEf/"
        login = "https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Freel%2F555%2F"
        resolved, _seen = self.resolve(share, {share: (302, login)})
        self.assertEqual(resolved, "https://www.facebook.com/reel/555/")

    def test_redirect_off_site_is_never_followed(self):
        share = "https://fb.watch/abc123/"
        resolved, seen = self.resolve(share, {share: (302, "http://127.0.0.1:9/internal")})
        self.assertEqual(resolved, share)
        # Browser pass, then crawler pass: neither ever requests the off-site target.
        self.assertEqual(seen, [share, share])

    def test_configured_session_is_sent_to_facebook_first(self):
        share = "https://www.facebook.com/share/v/1MSKQhixa7/"
        target = "https://www.facebook.com/reel/1088470043774115"
        cookie_file = Path(tempfile.mkdtemp()) / "facebook.txt"
        self.addCleanup(shutil.rmtree, cookie_file.parent, ignore_errors=True)
        cookie_file.write_text(
            "# Netscape HTTP Cookie File\n"
            "#HttpOnly_.facebook.com\tTRUE\t/\tTRUE\t2147483647\txs\tsecret-session\n"
        )
        sent = []

        def handler(request: httpx.Request):
            sent.append(request.headers.get("cookie"))
            if request.headers.get("cookie"):
                return httpx.Response(302, headers={"location": target})
            return httpx.Response(400)  # what Facebook gives anonymous browsers

        real_client = httpx.Client
        transport = httpx.MockTransport(handler)
        with patch.object(link_resolver.httpx, "Client", lambda **kw: real_client(transport=transport, **kw)), \
                patch("yt_dlp_config.social_cookiefile", return_value=str(cookie_file)):
            resolved = link_resolver.resolve_share_url(share)

        self.assertEqual(resolved, target)
        self.assertEqual(sent, ["xs=secret-session"])

    def test_unresolvable_link_is_returned_unchanged(self):
        share = "https://www.facebook.com/share/v/nothing/"
        self.assertEqual(self.resolve(share, {})[0], share)

    def test_network_errors_never_raise(self):
        def broken(**_kwargs):
            raise httpx.ConnectError("down")

        with patch.object(link_resolver.httpx, "Client", broken):
            url = "https://fb.watch/abc123/"
            self.assertEqual(link_resolver.resolve_share_url(url), url)

    def page_resolve(self, url, pages):
        """GETs answer 200 with pages[(url, is_crawler)] as the body."""
        seen = []

        def handler(request: httpx.Request):
            crawler = "facebookexternalhit" in request.headers.get("user-agent", "")
            seen.append((str(request.url), crawler))
            return httpx.Response(200, text=pages.get((str(request.url), crawler), "<html></html>"))

        real_client = httpx.Client
        transport = httpx.MockTransport(handler)
        with patch.object(link_resolver.httpx, "Client", lambda **kw: real_client(transport=transport, **kw)):
            return link_resolver.resolve_share_url(url), seen

    def test_video_link_is_read_from_the_page_metadata(self):
        share = "https://www.facebook.com/share/v/1E34kKxDkN/"
        page = '<meta property="og:url" content="https://www.facebook.com/watch/?v=111&amp;x=1" />'
        resolved, _seen = self.page_resolve(share, {(share, False): page})
        self.assertEqual(resolved, "https://www.facebook.com/watch/?v=111&x=1")

    def test_crawler_pass_is_used_after_a_login_wall(self):
        share = "https://www.facebook.com/share/r/1AbCdEf/"
        page = '<link rel="canonical" href="https://www.facebook.com/reel/777/">'
        resolved, seen = self.page_resolve(share, {(share, True): page})
        self.assertEqual(resolved, "https://www.facebook.com/reel/777/")
        self.assertEqual(seen, [(share, False), (share, True)])

    def test_page_links_off_site_are_ignored(self):
        share = "https://www.facebook.com/share/v/evil/"
        page = '<meta property="og:url" content="http://127.0.0.1:9/x">'
        resolved, _seen = self.page_resolve(share, {(share, False): page, (share, True): page})
        self.assertEqual(resolved, share)

    def test_results_are_cached(self):
        share = "https://www.facebook.com/share/v/cached/"
        target = "https://www.facebook.com/reel/42"
        self.resolve(share, {share: (301, target)})
        resolved, seen = self.resolve(share, {})
        self.assertEqual(resolved, target)
        self.assertEqual(seen, [])


if __name__ == "__main__":
    unittest.main()
