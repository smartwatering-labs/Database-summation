import unittest
from unittest.mock import patch, Mock
from engine.location_catalog import LocationCatalog
from engine.validation import ValidationError


class LocationTests(unittest.TestCase):
    def setUp(self):
        self.catalog=LocationCatalog()
        self.country=dict(id='CN',kind='country',country='中国',countryCode='CN')

    def test_china_provinces_no_truncation_and_municipalities(self):
        codes=[110000,120000,130000,140000,150000,210000,220000,230000,310000,320000,330000,340000,350000,360000,370000,410000,420000,430000,440000,450000,460000,500000,510000,520000,530000,540000,610000,620000,630000,640000,650000,710000,810000,820000]
        features=[{'properties':{'adcode':code,'name':str(code),'level':'province','center':[120,30]}} for code in codes]
        features.append({'properties':{'name':'海域轮廓','level':None}})
        with patch.object(self.catalog,'fetch',return_value={'features':features}):
            rows=self.catalog.children(self.country)
        self.assertEqual(len(rows),34)
        self.assertTrue(next(x for x in rows if x['id']=='310000')['terminal'])
        self.assertFalse(next(x for x in rows if x['id']=='320000')['terminal'])
        with patch.object(self.catalog,'fetch',return_value={'features':features[:5]}):
            with self.assertRaises(ValidationError):self.catalog.children(self.country)

    def test_china_cities_keep_all_entries(self):
        parent=dict(id='320000',kind='province',name='江苏省',country='中国',countryCode='CN',terminal=False)
        features=[{'properties':{'adcode':320100+n*100,'name':'城市'+str(n),'level':'city','center':[120,32]}} for n in range(13)]
        tree=[{'code':'32','children':[{'code':str(3201+n),'name':'城市'+str(n)} for n in range(13)]}]
        def response(url):return tree if url==self.catalog.china_cities_url else {'features':features}
        with patch.object(self.catalog,'fetch',side_effect=response) as fetch:
            rows=self.catalog.children(parent)
        self.assertEqual(len(rows),13)
        self.assertTrue(all(x['terminal'] and x['province']=='江苏省' for x in rows))
        self.assertTrue(any('/320000_full.json' in call.args[0] for call in fetch.call_args_list))

    def test_new_cities_remain_selectable_without_old_boundary_coordinates(self):
        parent=dict(id='650000',kind='province',name='新疆维吾尔自治区',country='中国',countryCode='CN',terminal=False)
        tree=[{'code':'65','children':[{'code':'6590','name':'自治区直辖县级行政区划','children':[{'code':'659012','name':'白杨市'}]}]}]
        with patch.object(self.catalog,'fetch',return_value=tree),patch.object(self.catalog,'china',side_effect=ValidationError('missing')):
            rows=self.catalog.children(parent)
        self.assertEqual(rows[0]['name'],'白杨市')
        self.assertTrue(rows[0]['terminal'])
        self.assertNotIn('latitude',rows[0])

    def test_overseas_only_selected_country_sorted_and_limited(self):
        rows=[{'properties':{'iso_a2':'JP','ne_id':n,'name':'City'+str(n),'adm0cap':int(n==0),'pop_max':n*1000},'geometry':{'coordinates':[140,36]}} for n in range(12)]
        rows.append({'properties':{'iso_a2':'US'}})
        with patch.object(self.catalog,'fetch',return_value={'features':rows}):
            result=self.catalog.children(dict(id='JP',kind='country',country='日本',countryCode='JP'))
        self.assertEqual(len(result),8)
        self.assertEqual(result[0]['id'],'0')
        self.assertEqual(result[1]['id'],'11')
        self.assertTrue(all(x['province']=='' for x in result))

    def test_list_failure_and_disabled_service_do_not_use_local_data(self):
        with patch('engine.location_catalog.urlopen',side_effect=TimeoutError):
            with self.assertRaises(ValidationError) as error:self.catalog.countries()
        self.assertEqual(error.exception.status,503)
        with self.assertRaises(ValidationError):LocationCatalog(False).countries()

    def test_only_terminal_city_can_be_confirmed(self):
        with self.assertRaises(ValidationError):self.catalog.select(self.country,None)
        node=dict(id='310000',kind='province',name='上海市',province='上海市',country='中国',countryCode='CN',terminal=True,latitude=31,longitude=121,provider='Test API')
        result=self.catalog.select(node,None)
        self.assertEqual(result['selectionLevel'],'city')
        self.assertEqual(result['displayName'],'中国 · 上海市')

    def test_taiwan_uses_local_name_and_rejects_other_city(self):
        node=dict(id='tw:Taipei',kind='city',name='臺北市',englishName='Taipei City',provinceCode='710000',province='台湾省',country='中国',countryCode='CN',terminal=True,provider='Test API')
        geo=Mock()
        geo.resolve.return_value={'candidates':[dict(name='台北市',countryCode='tw',addressType='city',latitude=25,longitude=121)]}
        result=self.catalog.select(node,geo)
        self.assertEqual(geo.resolve.call_args.args[0]['query'],'臺北市')
        self.assertEqual(result['city'],'臺北市')
        geo.resolve.return_value['candidates'][0]['name']='新北市'
        with self.assertRaises(ValidationError):self.catalog.select(node,geo)


if __name__=='__main__':unittest.main()
