"""External JSON catalogs, held only for the duration of each HTTP request."""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from .validation import ValidationError, number


class LocationCatalog:
    def __init__(self, enabled=True):
        self.enabled = enabled
        self.countries_url = os.getenv('COUNTRIES_API_URL', 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json')
        self.china_url = os.getenv('CHINA_AREAS_API_URL', 'https://geo.datav.aliyun.com/areas_v3/bound')
        self.cities_url = os.getenv('WORLD_CITIES_API_URL', 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places_simple.geojson')
        self.taiwan_url = os.getenv('TAIWAN_CITIES_API_URL', 'https://raw.githubusercontent.com/donma/TaiwanAddressCityAreaRoadChineseEnglishJSON/master/CityCountyData.json')
        self.china_cities_url = os.getenv('CHINA_CITIES_API_URL', 'https://raw.githubusercontent.com/modood/Administrative-divisions-of-China/master/dist/pca-code.json')

    def fetch(self, url):
        if not self.enabled:
            raise ValidationError('外部地点服务未启用，请联系管理员', 'location', 503)
        urls=[url]
        if url.startswith('https://raw.githubusercontent.com/'):
            owner,repo,branch,path=url.removeprefix('https://raw.githubusercontent.com/').split('/',3)
            urls.append(f'https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}')
        for address in urls:
            try:
                with urlopen(Request(address, headers={'User-Agent':'WateringPlatform/1.0', 'Accept':'application/json'}), timeout=10) as response:
                    raw = response.read(8_000_001)
                if len(raw) > 8_000_000:
                    raise ValueError('response too large')
                return json.loads(raw)
            except Exception:
                continue
        raise ValidationError('外部地点列表暂时无法加载，请重试或检查服务器网络', 'location', 503)

    def countries(self):
        data = self.fetch(self.countries_url)
        try:
            items = []
            for row in data:
                code = row['cca2']
                name = row.get('translations', {}).get('zho', {}).get('common') or row['name']['common']
                items.append(dict(id=code, kind='country', name=name, country=name, countryCode=code,
                                  englishName=row['name']['common'], iso3=row['cca3'], terminal=False))
            if len(items) < 200 or not any(x['id']=='CN' for x in items):
                raise ValueError('incomplete countries')
            return items
        except (KeyError, TypeError, ValueError) as error:
            raise ValidationError('外部国家列表不完整，请稍后重试', 'location', 503) from error

    def children(self, parent):
        if parent['kind'] == 'country':
            return self.china(parent) if parent['countryCode'] == 'CN' else self.world_cities(parent)
        if parent['kind'] == 'province' and not parent['terminal']:
            if parent['id'] == '710000':
                return self.taiwan(parent)
            return self.mainland_cities(parent)
        raise ValidationError('该地点没有需要选择的下一级', 'parentToken')

    def mainland_cities(self, parent):
        # Current names/codes are separate from the older boundary centroids.
        # Missing boundary coordinates never remove a city from the list.
        with ThreadPoolExecutor(max_workers=2) as pool:
            tree_job=pool.submit(self.fetch,self.china_cities_url)
            map_job=pool.submit(self.china,parent)
            tree=tree_job.result()
            try: centers={x['id']:x for x in map_job.result()}
            except ValidationError: centers={}
        try:
            province=next(x for x in tree if x['code']==parent['id'][:2])
            rows=[]
            for city in province['children']:
                rows.extend(city['children'] if '直辖' in city['name'] else [city])
            items=[]
            for row in rows:
                code=row['code'].ljust(6,'0')
                item=dict(id=code,name=row['name'],kind='city',country=parent['country'],countryCode='CN',
                          province=parent['name'],provinceCode=parent['id'],terminal=True,
                          provider='中国行政区划开放数据 / 阿里云 DataV')
                if code in centers:
                    item.update(latitude=centers[code]['latitude'],longitude=centers[code]['longitude'])
                items.append(item)
            if not items:raise ValueError('no cities')
            return items
        except (StopIteration,KeyError,TypeError,ValueError) as error:
            raise ValidationError('外部城市目录不完整，请重试', 'location', 503) from error

    def china(self, parent):
        root = parent['kind'] == 'country'
        code = '100000' if root else parent['id']
        data = self.fetch(self.china_url.rstrip('/') + '/' + code + '_full.json')
        try:
            items = []
            for feature in data['features']:
                p = feature['properties']
                if not p.get('name') or (root and p.get('level') != 'province'):
                    continue  # Sea outline is not an administrative option.
                item_code = str(p['adcode'])
                # Administrative type exceptions, not a stored location catalog.
                direct = root and item_code in ('110000','120000','310000','500000','810000','820000')
                lon, lat = p['center']
                items.append(dict(id=item_code, name=p['name'], kind='province' if root else 'city',
                                  country=parent['country'], countryCode='CN', terminal=direct or not root,
                                  province=p['name'] if root else parent['name'],
                                  provinceCode=item_code if root else parent['id'],
                                  longitude=number(lon,'longitude',-180,180), latitude=number(lat,'latitude',-90,90),
                                  provider='阿里云 DataV 行政区划', municipality=direct))
            if not items or (root and len(items) != 34):
                raise ValueError('incomplete administrative data')
            return sorted(items, key=lambda row:row['id'])
        except (KeyError, TypeError, ValueError, ValidationError) as error:
            raise ValidationError('外部省市数据不完整，请稍后重试', 'location', 503) from error

    def world_cities(self, parent):
        data = self.fetch(self.cities_url)
        try:
            rows = [f for f in data['features'] if f['properties'].get('iso_a2') == parent['countryCode']]
            rows.sort(key=lambda f:(-int(f['properties'].get('adm0cap') or 0), -int(f['properties'].get('pop_max') or 0)))
            items = []
            for f in rows[:8]:
                p=f['properties'];lon,lat=f['geometry']['coordinates']
                items.append(dict(id=str(p['ne_id']), kind='city', name=p['name'], country=parent['country'],
                                  countryCode=parent['countryCode'], terminal=True, province='',
                                  longitude=number(lon,'longitude',-180,180), latitude=number(lat,'latitude',-90,90),
                                  provider='Natural Earth'))
            if not items:
                raise ValueError('no cities')
            return items
        except (KeyError, TypeError, ValueError, ValidationError) as error:
            raise ValidationError('该国家或地区暂未取得主要城市列表，请重试或选择其他国家', 'location', 503) from error

    def taiwan(self, parent):
        data=self.fetch(self.taiwan_url)
        try:
            items=[dict(id='tw:'+row['CityEngName'], name=row['CityName'], englishName=row['CityEngName'],
                        kind='city', country=parent['country'], countryCode='CN', province=parent['name'],
                        provinceCode=parent['id'], terminal=True, provider='TaiwanAddressCityAreaRoadChineseEnglishJSON')
                   for row in data if row['CityName'].endswith(('市','縣'))]
            if len(items)!=22:
                raise ValueError('incomplete county cities')
            return items
        except (KeyError, TypeError, ValueError) as error:
            raise ValidationError('外部县市列表不完整，请稍后重试', 'location', 503) from error

    def select(self, node, geocoding):
        if not node.get('terminal') or node.get('kind') not in ('city','province'):
            raise ValidationError('请完成省份和城市选择', 'selectionToken')
        if 'latitude' not in node:
            taiwan=node.get('provinceCode')=='710000'
            results=geocoding.resolve({'country':'Taiwan' if taiwan else node['country'],
                                      'query':node['name'] if taiwan else node['name']+', '+node['province']})['candidates']
            matches=[r for r in results if r['countryCode'].lower()==('tw' if taiwan else 'cn')
                     and r['addressType'] in ('city','county','district','state')
                     and r['name'].replace('台','臺')==node['name'].replace('台','臺')]
            if not matches:
                raise ValidationError('暂未取得该县市的地图坐标，请稍后重试', 'location', 503)
            node=dict(node, latitude=matches[0]['latitude'], longitude=matches[0]['longitude'])
        label=' · '.join(dict.fromkeys(filter(None,[node['country'],node.get('province'),node['name']])))
        return dict(id='external:'+node['id'], name=node['name'], displayName=label,
                    country=node['country'], countryCode=node['countryCode'], state=node.get('province',''),
                    city=node['name'], latitude=node['latitude'], longitude=node['longitude'],
                    selectable=True, selectionLevel='city', provider=node['provider'])
