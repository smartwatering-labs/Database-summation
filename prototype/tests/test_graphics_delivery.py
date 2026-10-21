"""Verify lossless public asset negotiation without caching private API data."""
import gzip
import tempfile
import unittest
from pathlib import Path
from app import create_app, ROOT


class GraphicsDeliveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.app = create_app({'TESTING': True, 'DATABASE': str(Path(cls.directory.name) / 'test.sqlite3'), 'WEATHER_ENABLED': False, 'GEOCODING_ENABLED': False})
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_graphics_are_lossless_and_conditional(self):
        for packed in (ROOT / 'static').rglob('*.gz'):
            original = packed.with_suffix('')
            url = '/static/' + original.relative_to(ROOT / 'static').as_posix()
            response = self.client.get(url, buffered=True, headers={'Accept-Encoding': 'gzip'})
            self.assertEqual(response.status_code, 200, url)
            self.assertEqual(response.headers.get('Content-Encoding'), 'gzip', url)
            self.assertEqual(gzip.decompress(response.data), original.read_bytes(), url)
            self.assertIn('Accept-Encoding', response.headers['Vary'])
            self.assertLess(len(response.data), original.stat().st_size * .5)
            cached = self.client.get(url, buffered=True, headers={'Accept-Encoding': 'gzip', 'If-None-Match': response.headers['ETag']})
            self.assertEqual(cached.status_code, 304)
            self.assertEqual(cached.data, b'')
            self.assertEqual(self.client.head(url, buffered=True, headers={'Accept-Encoding': 'gzip'}).data, b'')

    def test_identity_fallback_and_private_cache_policy(self):
        url = '/static/assets/models/watering-box-9-30ver.glb'
        original = (ROOT / url.lstrip('/')).read_bytes()
        for accepted in ['', 'gzip;q=0, identity']:
            response = self.client.get(url, buffered=True, headers={'Accept-Encoding': accepted})
            self.assertIsNone(response.headers.get('Content-Encoding'))
            self.assertEqual(response.data, original)
        for url in ['/', '/api/settings', '/api/plants']:
            response = self.client.get(url, buffered=True, headers={'Accept-Encoding': 'gzip'})
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertIsNone(response.headers.get('Content-Encoding'))

    def test_stale_compressed_copy_is_not_served(self):
        import os
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'example.js'
            source.write_text('const latest = true;', encoding='utf-8')
            packed = Path(folder) / 'example.js.gz'
            packed.write_bytes(gzip.compress(b'old code'))
            os.utime(packed, (1, 1))
            static_folder = self.app.static_folder
            try:
                self.app.static_folder = folder
                response = self.client.get('/static/example.js', buffered=True, headers={'Accept-Encoding': 'gzip'})
                self.assertIsNone(response.headers.get('Content-Encoding'))
                self.assertEqual(response.data, source.read_bytes())
            finally:
                self.app.static_folder = static_folder


if __name__ == '__main__':
    unittest.main()
