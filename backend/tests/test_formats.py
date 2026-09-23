import unittest

from main import _parse_formats


class FormatParsingTests(unittest.TestCase):
    def test_lists_every_height_high_to_low_and_mp3(self):
        formats = [
            {"format_id": "18", "height": 360, "vcodec": "avc1", "acodec": "mp4a"},
            {"format_id": "136", "height": 720, "vcodec": "avc1", "acodec": "none"},
            {"format_id": "247", "height": 720, "vcodec": "vp9", "acodec": "none"},
            {"format_id": "137", "height": 1080, "vcodec": "avc1", "acodec": "none"},
            {"format_id": "140-drc", "vcodec": "none", "acodec": "mp4a", "abr": 129},
            {"format_id": "140", "vcodec": "none", "acodec": "mp4a", "abr": 129},
        ]

        parsed = _parse_formats(formats, {})

        self.assertEqual(
            [item["resolution"] for item in parsed],
            ["1080p", "720p", "360p", "129kbps"],
        )
        self.assertEqual(parsed[1]["format_id"], "136")
        self.assertEqual(parsed[-1]["format_id"], "140")
        self.assertEqual(parsed[-1]["ext"], "mp3")

    def test_offers_mp3_when_only_a_combined_stream_exists(self):
        parsed = _parse_formats([
            {"format_id": "18", "height": 360, "vcodec": "avc1", "acodec": "mp4a"},
        ], {})

        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[-1]["format_id"], "bestaudio")
        self.assertEqual(parsed[-1]["ext"], "mp3")


if __name__ == "__main__":
    unittest.main()
