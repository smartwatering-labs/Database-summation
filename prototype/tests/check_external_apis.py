"""Opt-in read-only external checks. No catalogs are saved to disk."""
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine.geocoding import GeocodingService
from engine.environment import EnvironmentService
from engine.location_catalog import LocationCatalog


def main():
    catalog=LocationCatalog();countries=catalog.countries()
    print('External countries:',len(countries),flush=True)
    china=next(x for x in countries if x['id']=='CN')
    provinces=catalog.children(china)
    assert len(provinces)==34
    print('China province-level entries:',len(provinces),flush=True)
    city_lists={};failed=[]
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs={pool.submit(catalog.children,p):p for p in provinces if not p['terminal']}
        for job in as_completed(jobs):
            p=jobs[job]
            try:
                rows=job.result();city_lists[p['id']]=rows
                print(p['name'],len(rows),'cities / prefectures',flush=True)
            except Exception as error:
                failed.append(p['name']);print(p['name'],str(error),flush=True)
    assert not failed,failed
    assert len(city_lists['320000'])==13
    assert len(city_lists['710000'])==22
    assert any(x['id']=='659012' for x in city_lists['650000'])
    samples=[next(p for p in provinces if p['id']=='310000'),city_lists['320000'][0]]
    samples.extend([city_lists['710000'][0],next(x for x in city_lists['650000'] if x['id']=='659012')])
    for code in ('JP','GB'):
        cities=catalog.children(next(c for c in countries if c['id']==code))
        assert 1<=len(cities)<=8
        print(code,'major cities:',[x['name'] for x in cities],flush=True)
        samples.append(cities[0])
    for node in samples:
        location=catalog.select(node,GeocodingService())
        weather=EnvironmentService().get_coordinates(location)
        print(location['displayName'],weather['source'],weather['temperatureC'],flush=True)
    print('PASS: all 34 provinces, all child lists, Jiangsu 13 cities, Taiwan 22 counties/cities, new Baiyang city, 6 weather samples.',flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
