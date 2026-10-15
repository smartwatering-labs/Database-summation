"""Isolated browser-test server: real app/rules/BLE demo, deterministic upstreams.

Run from prototype: python tests/serve_ui_fixture.py
Never imported by the production application; database removed on exit.
"""
import io
import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app
from waitress import serve

if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='watering-ui-test-') as directory:
        app = create_app({'TESTING': True, 'DATABASE': str(Path(directory) / 'test.sqlite3'),
                          'WEATHER_ENABLED': True, 'DEMO_ENABLED': True})
        country = dict(id='CN', kind='country', name='中国', englishName='China', countryCode='CN', terminal=False)
        city = dict(id='310000', kind='province', name='上海市', country='中国', countryCode='CN',
                    province='上海市', terminal=True, latitude=31.23, longitude=121.47, provider='UI test fixture')
        weather = {'current': {'temperature_2m': 25, 'relative_humidity_2m': 60, 'time': '2026-09-23T12:00'},
                   'elevation': 5, 'daily': {'precipitation_sum': [1,3], 'sunshine_duration': [3600,7200]}, 'timezone': 'Asia/Shanghai'}
        catalog = app.extensions['location_catalog']
        with patch.object(catalog, 'countries', return_value=[country]), \
             patch.object(catalog, 'children', return_value=[city]), \
             patch('engine.environment.urlopen', side_effect=lambda *a, **k: io.BytesIO(json.dumps(weather).encode())):
            print('UI FIXTURE ONLY http://127.0.0.1:5001', flush=True)
            serve(app, host='127.0.0.1', port=5001)
