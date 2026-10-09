"""Many people at once: lookups and downloads wait their turn fairly, and a
long line never stalls the rest of the API."""

import asyncio
import threading
import time
import unittest
from unittest.mock import patch

import httpx
import yt_dlp

import extraction_cache
import main
from routers import download as download_router
from tests.test_api import ApiTestCase, bearer

FULL_LADDER = [
    {"format_id": "137", "height": 1080, "vcodec": "avc1", "acodec": "none"},
    {"format_id": "140", "vcodec": "none", "acodec": "mp4a", "abr": 129},
]


class AnalysisLineTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        extraction_cache.clear()
        self.addCleanup(extraction_cache.clear)
        main._YOUTUBE_ANALYSIS = main.AnalysisGate(slots=1, max_waiting=6)

    def test_youtube_lookups_run_one_at_a_time_and_the_rest_wait_or_are_told_to_retry(self):
        _user_id, token, _password = self.active_user()
        running, peak, lock = [0], [0], threading.Lock()

        class SlowYoutubeDL:
            sanitize_info = staticmethod(lambda info, remove_private_keys=False: info)

            def __init__(self, options):
                self.options = options

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def extract_info(self, url, download):
                with lock:
                    running[0] += 1
                    peak[0] = max(peak[0], running[0])
                time.sleep(0.15)
                with lock:
                    running[0] -= 1
                video_id = url.rsplit("/", 1)[-1]
                return {"id": video_id, "title": "Lecture", "extractor_key": "Youtube", "formats": FULL_LADDER}

        async def scenario():
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                lookups = [
                    client.post("/video-info", headers=bearer(token),
                                json={"url": f"https://youtu.be/video{n:06d}"})
                    for n in range(9)
                ]
                tasks = [asyncio.create_task(request) for request in lookups]
                await asyncio.sleep(0.3)
                # Meanwhile the rest of the API answers at once.
                started = time.monotonic()
                me = await client.get("/auth/me", headers=bearer(token))
                me_seconds = time.monotonic() - started
                return await asyncio.gather(*tasks), me, me_seconds

        with patch.object(yt_dlp, "YoutubeDL", SlowYoutubeDL):
            responses, me, me_seconds = asyncio.run(scenario())

        codes = sorted(response.status_code for response in responses)
        # One running plus six in line are served; later arrivals are told to retry.
        self.assertEqual(codes, [200] * 7 + [429] * 2)
        busy = next(r for r in responses if r.status_code == 429)
        self.assertIn("Lots of people are getting videos right now", busy.json()["detail"])
        self.assertEqual(peak[0], 1)
        self.assertEqual(me.status_code, 200)
        self.assertLess(me_seconds, 0.5)


class DownloadLineTests(unittest.TestCase):
    def test_first_come_first_served_with_positions(self):
        queue = download_router.DownloadQueue(slots=1, max_waiting=10)
        jobs = ["a", "b", "c"]
        for job in jobs:
            download_router._jobs[job] = {"status": "starting"}
            self.addCleanup(download_router._jobs.pop, job, None)
        started, positions = [], {job: [] for job in jobs}

        async def worker(job):
            ok = await queue.wait_turn(job, positions[job].append)
            started.append(job)
            await asyncio.sleep(0.05)
            queue.release()
            return ok

        async def scenario():
            return await asyncio.gather(*(worker(job) for job in jobs))

        self.assertEqual(asyncio.run(scenario()), [True, True, True])
        self.assertEqual(started, ["a", "b", "c"])
        self.assertEqual(positions["a"], [])
        self.assertEqual(positions["b"][0], 1)
        self.assertEqual(positions["c"][0], 2)
        self.assertEqual((queue.active, queue.waiting), (0, 0))

    def test_someone_who_leaves_drops_out_of_the_line(self):
        queue = download_router.DownloadQueue(slots=1, max_waiting=10)
        download_router._jobs["gone"] = {"status": "starting"}
        queue.active = 1  # someone else is downloading

        async def scenario():
            waiter = asyncio.create_task(queue.wait_turn("gone"))
            await asyncio.sleep(0.05)
            download_router._jobs.pop("gone", None)  # the page closed
            return await waiter

        self.assertFalse(asyncio.run(scenario()))
        self.assertEqual(queue.waiting, 0)

    def test_a_full_line_turns_new_downloads_away(self):
        queue = download_router.DownloadQueue(slots=1, max_waiting=2)
        self.assertFalse(queue.full())
        queue.active = 1
        queue._line.extend(["x", "y"])
        self.assertTrue(queue.full())


if __name__ == "__main__":
    unittest.main()
