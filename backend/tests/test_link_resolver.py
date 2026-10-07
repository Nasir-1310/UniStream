import unittest
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
        self.assertEqual(seen, [share])

    def test_unresolvable_link_is_returned_unchanged(self):
        share = "https://www.facebook.com/share/v/nothing/"
        self.assertEqual(self.resolve(share, {})[0], share)

    def test_network_errors_never_raise(self):
        def broken(**_kwargs):
            raise httpx.ConnectError("down")

        with patch.object(link_resolver.httpx, "Client", broken):
            url = "https://fb.watch/abc123/"
            self.assertEqual(link_resolver.resolve_share_url(url), url)

    def test_results_are_cached(self):
        share = "https://www.facebook.com/share/v/cached/"
        target = "https://www.facebook.com/reel/42"
        self.resolve(share, {share: (301, target)})
        resolved, seen = self.resolve(share, {})
        self.assertEqual(resolved, target)
        self.assertEqual(seen, [])


if __name__ == "__main__":
    unittest.main()
