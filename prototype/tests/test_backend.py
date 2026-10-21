import io
import json
import math
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from app import create_app
from engine.environment import EnvironmentService
from engine.geocoding import GeocodingService
from engine.validation import ValidationError, validate_config
from engine.rules import season_for_latitude


def geo_feature(kind='district', name='测试区', country='测试国家', latitude=31.23):
    return {"type":"Feature","geometry":{"type":"Point","coordinates":[121.47,latitude]},
            "properties":{"geocoding":{"type":kind,"name":name,"label":name+", "+country,
                                      "country":country,"district":name if kind=='district' else "",
                                      "osm_type":"relation","osm_id":1234}}}

WEATHER = {'current':{'temperature_2m':25,'relative_humidity_2m':60,'time':'2026-09-10T12:00'},
           'elevation':5,'daily':{'precipitation_sum':[1,3],'sunshine_duration':[3600,7200]},'timezone':'Asia/Shanghai'}

class BackendTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.db = str(Path(self.directory.name) / 'system.sqlite3')
        self.app = create_app({'TESTING': True, 'DATABASE': self.db, 'WEATHER_ENABLED': True, 'GEOCODING_ENABLED': True, 'ADMIN_TOKEN': 'test-secret', 'ADMIN_HOSTS': ('admin.localhost',)})
        self.client = self.app.test_client()
        node=dict(id='320100',kind='city',name='测试市',country='测试国家',countryCode='CN',province='测试省',terminal=True,latitude=31.23,longitude=121.47,provider='Test API')
        with patch.object(self.app.extensions['location_catalog'], 'countries', return_value=[node]):
            item=self.client.get('/api/locations/countries').json['items'][0]
        self.location = self.client.post('/api/locations/select',json={'selectionToken':item['selectionToken']}).json['location']
        self.scene = dict(plantId='tomato', locationToken=self.location['locationToken'], cultivation='pot', potLiters=10,
                          light='partial', supplyVariant='builtin', reservoirLiters=20,
                          currentRevision=0)
        self.weather_patch = patch('engine.environment.urlopen', side_effect=lambda *a, **k: io.BytesIO(json.dumps(WEATHER).encode()))
        self.weather_patch.start()

    def tearDown(self):
        self.weather_patch.stop()
        self.directory.cleanup()

    def generate(self, **changes):
        return self.client.post('/api/configurations/generate', json=self.scene | changes)

    def test_shell_and_libraries(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        for path in ('plants',):
            data = self.client.get('/api/' + path).json
            self.assertGreater(len(data['items']), 3)
            self.assertEqual(data['version'], 'db.1')
        settings = self.client.get('/api/settings').json
        self.assertNotIn('adminToken', settings)
        self.assertFalse(settings['ble']['verified'])  # Physical BLE/OLED checks are still pending.
        self.assertEqual(settings['ble']['profile'], 'sws-json-v1')

    def test_generate_canonical_and_explain(self):
        response = self.generate(currentRevision=7)
        self.assertEqual(response.status_code, 200)
        data = response.json
        self.assertEqual(data['source'], 'api')
        self.assertEqual(data['storage'], 'temporary')
        self.assertEqual(data['config']['revision'], 8)
        self.assertEqual(data['config']['recommendedMode'], 'PREPARE')
        self.assertAlmostEqual(sum(data['params'][k] for k in ('soilWeight','tempWeight','airWeight')), 1, places=3)
        self.assertGreater(len(data['explanations']), 3)
        self.assertGreater(len(data['warnings']), 1)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_bound_configuration_has_executable_interval_and_preserves_legacy_format(self):
        legacy = self.generate().json['config']
        self.assertEqual(legacy['configVersion'], '1.0')
        self.assertNotIn('minWaterIntervalSeconds', legacy['params'])
        response = self.generate(configVersion='2.0', targetDeviceId='C3-012345abcdef')
        self.assertEqual(response.status_code, 200)
        config = response.json['config']
        self.assertEqual(config['configVersion'], '2.0')
        self.assertEqual(config['targetDeviceId'], 'C3-012345abcdef')
        self.assertEqual(config['params']['minWaterIntervalSeconds'], config['display']['estimatedIntervalDays'] * 86400)
        self.assertEqual(validate_config(config)['params']['minWaterIntervalSeconds'], config['params']['minWaterIntervalSeconds'])
        self.assertEqual(self.generate(configVersion='2.0').status_code, 400)
        self.assertEqual(self.generate(configVersion='2.0', targetDeviceId='../other').status_code, 400)
        invalid = config | {'params': config['params'] | {'minWaterIntervalSeconds': 3599}}
        with self.assertRaises(ValidationError):
            validate_config(invalid)

    def test_device_summary_requires_fresh_calibrated_bound_prepare_data(self):
        report={'deviceId':'C3-012345abcdef','calibrationReady':True,'complete':True,'timeQuality':'trusted',
                'validSamples':100,'totalSamples':110,'durationSeconds':600,'configRevision':7,
                'temperatureC':35,'humidityPct':30,'flowRateMlSec':20,'finishedAt':int(datetime.now(timezone.utc).timestamp())}
        arguments={'configVersion':'2.0','targetDeviceId':report['deviceId'],'currentRevision':7}
        regional=self.generate(**arguments).json
        response=self.generate(**arguments,deviceObservation=report)
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['source'],'device-summary+api')
        self.assertGreater(response.json['config']['waterNeedMlDay'],regional['config']['waterNeedMlDay'])
        self.assertEqual(response.json['environment']['temperatureC'],25)
        self.assertEqual(response.json['config']['display']['flowRateMlSec'],20)
        for change in ({'calibrationReady':False},{'complete':False},{'timeQuality':'relative'},
                       {'configRevision':6},{'deviceId':'OTHER'},{'totalSamples':200},
                       {'finishedAt':report['finishedAt']-3601},{'durationSeconds':599}):
            self.assertEqual(self.generate(**arguments,deviceObservation=report|change).status_code,400)
        self.assertEqual(self.generate(deviceObservation=report).status_code,400)

    def test_scene_changes_affect_recommendation(self):
        shade = self.generate(light='shade').json['config']
        sun = self.generate(light='full').json['config']
        self.assertGreater(sun['waterNeedMlDay'], shade['waterNeedMlDay'])
        dry = self.generate(plantId='succulent').json['config']
        self.assertLess(dry['waterNeedMlDay'], shade['waterNeedMlDay'])

    def test_pump_variants_and_always_unattended(self):
        fixed = self.generate(flowRateMlSec=199, unattended=False).json['config']
        normal = self.generate().json['config']
        self.assertEqual(fixed['params'], normal['params'])
        self.assertEqual(fixed['display']['flowRateMlSec'],22)
        self.assertEqual(fixed['params']['threshold'],53)
        valve = self.generate(supplyVariant='valve',flowRateMlSec=11).json['config']
        self.assertEqual(valve['display']['flowRateMlSec'],11)
        self.assertEqual(valve['supplyVariant'],'valve')
        self.assertEqual(self.generate(supplyVariant='valve').status_code,400)

    def test_verified_location_required_and_cannot_be_overridden(self):
        self.assertEqual(self.generate(locationToken='forged').status_code,409)
        self.assertEqual(self.generate(locationToken='').status_code,400)
        result=self.generate(customLocation={'latitude':-35,'country':'伪造'}, season='winter').json['config']
        self.assertEqual(result['country'],'测试国家')
        self.assertEqual(result['season'],season_for_latitude(31.23))
        with patch('itsdangerous.timed.TimestampSigner.get_timestamp',return_value=9999999999):
            self.assertEqual(self.generate().status_code,409)

    def test_input_validation(self):
        for update in ({'plantId':'unknown'}, {'potLiters':0}, {'supplyVariant':'valve','flowRateMlSec':-1},
                       {'supplyVariant':'unknown'}, {'reservoirLiters':True}, {'currentRevision':-1},
                       {'supplyVariant':'valve','flowRateMlSec':float('inf')}, {'light':'invented'}, {'currentRevision':1.5}):
            with self.subTest(update=update):
                self.assertEqual(self.generate(**update).status_code, 400)

    def test_import_export_and_revision(self):
        config = self.generate().json['config']
        config['auth'] = 'must-not-be-exported'
        config['signature'] = 'must-not-be-exported'
        result = self.client.post('/api/configurations/import', json={'config':config})
        self.assertEqual(result.status_code, 200)
        self.assertNotIn('auth', result.json['config'])
        exported = self.client.post('/api/configurations/export', json={'config':config})
        self.assertEqual(exported.status_code, 200)
        self.assertIn('attachment', exported.headers['Content-Disposition'])
        self.assertNotIn('must-not-be-exported', exported.get_data(as_text=True))
        self.assertEqual(self.client.post('/api/configurations/import', json={'config':config,'currentRevision':1}).status_code, 409)

    def test_reject_unsafe_configuration(self):
        for key, value in [('pulseCount', 100), ('pulseOnMs', 100000), ('soilWeight', -1), ('threshold',float('nan'))]:
            config = self.generate().json['config']; config['params'][key] = value
            self.assertEqual(self.client.post('/api/configurations/import', json={'config':config}).status_code, 400)
        config = self.generate().json['config']; config['deviceModel'] = 'other'
        self.assertEqual(self.client.post('/api/configurations/import', json={'config':config}).status_code, 400)
        config = self.generate().json['config']; config['params'].update(pulseCount=12, pulseOffMs=60000)
        self.assertEqual(self.client.post('/api/configurations/import', json={'config':config}).status_code, 400)

    def test_no_user_or_sensor_storage(self):
        self.generate()
        with sqlite3.connect(self.db) as db:
            tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            self.assertEqual(set(tables), {'library_documents','system_logs','sqlite_sequence'})
            dump = '\n'.join(db.iterdump())
        db.close()
        self.assertNotIn('private-source-marker', dump)
        self.assertNotIn('generatedAt', dump)
        self.assertNotIn('测试市', dump)
        self.assertEqual(self.client.get('/api/locations').json['items'],[])

    def test_admin_authentication_and_sanitized_statistics(self):
        for path in ('health','stats','logs','formulas'):
            self.assertEqual(self.client.get('/api/admin/'+path).status_code, 404)
            response = self.client.get('/api/admin/'+path, headers={'Authorization':'Bearer test-secret'}, base_url='http://admin.localhost')
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get('/api/admin/logs?limit=oops',headers={'Authorization':'Bearer test-secret'},base_url='http://admin.localhost').status_code, 400)
        with self.assertRaises(RuntimeError):
            create_app({'APP_ENV':'production','ADMIN_TOKEN':'6767'})

    def test_error_responses(self):
        self.assertEqual(self.client.post('/api/configurations/import', data='broken', content_type='application/json').status_code, 400)
        self.assertEqual(self.client.post('/api/configurations/import', json=[]).status_code, 400)
        self.assertEqual(self.client.post('/api/configurations/import', data='x'*70000,content_type='application/json').status_code, 413)
        self.assertEqual(self.client.post('/api/configurations/generate',json=self.scene,headers={'Sec-Fetch-Site':'cross-site'}).status_code,403)
        self.assertEqual(self.client.get('/api/weather?locationId=bad').status_code,410)
        self.assertEqual(self.client.get('/api/missing').status_code,404)

    def test_weather_is_fresh_external_and_failures_block_generation(self):
        service=EnvironmentService(True)
        with patch('engine.environment.urlopen', side_effect=lambda *a, **k: io.BytesIO(json.dumps(WEATHER).encode())) as fetch:
            result=service.get_coordinates(self.location)
            self.assertEqual(result['source'],'api')
            self.assertEqual(result['sunshineHoursDay'],1.5)
            service.get_coordinates(self.location)
            self.assertEqual(fetch.call_count,2)
        for bad in (None, True, float('nan')):
            weather=json.loads(json.dumps(WEATHER))
            weather['daily']['sunshine_duration']=[bad]
            with patch('engine.environment.urlopen',side_effect=lambda *a,**k:io.BytesIO(json.dumps(weather).encode())):
                response=self.generate()
                self.assertEqual(response.status_code,503)
                self.assertNotIn('config',response.json)
        with patch('engine.environment.urlopen',side_effect=TimeoutError):
            self.assertEqual(self.generate().status_code,503)
            self.assertEqual(self.client.post('/api/environment',json={'locationToken':self.scene['locationToken']}).status_code,503)
        with self.assertRaises(ValidationError):
            EnvironmentService(False).get_coordinates(self.location)

    def test_precision_filter_and_global_queries(self):
        for country, name in [('中国','黄浦区'),('日本','新宿区'),('United Kingdom','Camden'),('Kenya','Westlands')]:
            service=GeocodingService(True)
            with patch('engine.geocoding.urlopen',return_value=io.BytesIO(json.dumps({'features':[geo_feature(name=name,country=country)]}).encode())):
                result=service.resolve({'country':country,'query':name})
                self.assertTrue(result['candidates'][0]['selectable'])
                self.assertEqual(result['candidates'][0]['country'],country)
        for kind in ('country','state','city'):
            self.assertFalse(GeocodingService._candidate(geo_feature(kind=kind))['selectable'])
        chinese_district = geo_feature(kind='city',name='黄浦区',country='中国')
        chinese_district['properties']['geocoding'].update(country_code='cn',osm_key='boundary',osm_value='administrative',extra={'admin_level':'6'})
        self.assertTrue(GeocodingService._candidate(chinese_district)['selectable'])
        chinese_district['properties']['geocoding']['extra']['admin_level']='4'
        self.assertFalse(GeocodingService._candidate(chinese_district)['selectable'])
        self.assertEqual(self.client.post('/api/locations/resolve',json={'country':'测试国家','query':'城市'}).status_code,410)

    def test_catalog_tokens_reject_tampering_and_incomplete_selection(self):
        self.assertEqual(self.client.post('/api/locations/children',json={'parentToken':'forged'}).status_code,409)
        node=dict(id='CN',kind='country',name='中国',country='中国',countryCode='CN',terminal=False)
        with patch.object(self.app.extensions['location_catalog'],'countries',return_value=[node]):
            token=self.client.get('/api/locations/countries').json['items'][0]['selectionToken']
        self.assertEqual(self.client.post('/api/locations/select',json={'selectionToken':token}).status_code,400)
        self.assertEqual(self.client.post('/api/locations/select',json={'selectionToken':'forged'}).status_code,409)
        with patch('itsdangerous.timed.TimestampSigner.get_timestamp',return_value=9999999999):
            self.assertEqual(self.client.post('/api/locations/children',json={'parentToken':token}).status_code,409)

    def test_no_geocoder_fallback_on_network_failure(self):
        with patch('engine.geocoding.urlopen',side_effect=TimeoutError):
            with self.assertRaises(ValidationError) as error:
                GeocodingService(True).resolve({'country':'中国','query':'上海黄浦区'})
            self.assertEqual(error.exception.status,503)

    def test_formula_endpoint_and_location_catalog_migration(self):
        args={'headers':{'Authorization':'Bearer test-secret'},'base_url':'http://admin.localhost'}
        formulas=self.client.get('/api/admin/formulas',**args).json
        self.assertEqual(formulas['builtinFlowMlSec'],22)
        self.assertGreaterEqual(len(formulas['items']),12)
        self.assertEqual(formulas['coefficients']['season']['summer'],2)
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO library_documents VALUES (?,?,?,?,?)",('locations',1,'{}','old','now'))
            db.execute("CREATE TABLE environment_weight_library (id TEXT PRIMARY KEY, data TEXT)")
            db.execute("INSERT INTO environment_weight_library VALUES (?,?)",('old-place','{"latitude":31,"longitude":121}'))
            db.execute("INSERT INTO environment_weight_library VALUES (?,?)",('cultivation','{"pot":1,"ground":1.25}'))
        db.close()
        create_app({'TESTING':True,'DATABASE':self.db})
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM library_documents WHERE name='locations'").fetchone()[0],0)
            self.assertEqual(db.execute("SELECT id FROM environment_weight_library").fetchall(), [('cultivation',)])
        db.close()

    def test_admin_plant_library_uses_database_revision(self):
        headers={'Authorization':'Bearer test-secret'}
        base_url='http://admin.localhost'
        library=self.client.get('/api/admin/libraries/plants',headers=headers,base_url=base_url).json
        plant=dict(library['items'][0]); plant['dailyMl'] += 1
        response=self.client.put('/api/admin/libraries/plants',headers=headers,base_url=base_url,json={'expectedRevision':library['revision'],'plant':plant})
        self.assertEqual(response.status_code,200,response.json)
        saved=response.json
        self.assertEqual(saved['revision'], library['revision'] + 1)
        stale=self.client.put('/api/admin/libraries/plants',headers=headers,base_url=base_url,json={'expectedRevision':library['revision'],'plant':plant})
        self.assertEqual(stale.status_code,409)
        self.assertEqual(self.client.get('/api/admin/git/status',headers=headers,base_url=base_url).status_code,200)

    def test_plant_review_and_field_validation_require_evidence(self):
        headers={'Authorization':'Bearer test-secret'}
        base_url='http://admin.localhost'
        library=self.client.get('/api/admin/libraries/plants',headers=headers,base_url=base_url).json
        plant=dict(library['items'][0])
        self.assertEqual(plant['review']['status'],'engineering')
        self.assertEqual(plant['fieldValidation']['status'],'untested')
        plant['review']={**plant['review'],'status':'reviewed'}
        payload={'expectedRevision':library['revision'],'plant':plant}
        self.assertEqual(self.client.put('/api/admin/libraries/plants',headers=headers,base_url=base_url,json=payload).status_code,400)
        plant['evidence']={**plant['evidence'],'title':'试验资料','reference':'https://example.org/record'}
        plant['review']['reviewedAt']='2026-10-13'
        plant['fieldValidation']={**plant['fieldValidation'],'status':'calibrated','testedAt':'2026-10-13','summary':'已完成指定条件下的流量实测'}
        plant['suitability']={**plant['suitability'],'temperatureMinC':20,'temperatureMaxC':24,'humidityMinPct':50,'humidityMaxPct':55}
        response=self.client.put('/api/admin/libraries/plants',headers=headers,base_url=base_url,json=payload)
        self.assertEqual(response.status_code,200,response.json)
        saved=response.json
        self.assertEqual(saved['items'][0]['review']['status'],'reviewed')
        self.assertEqual(saved['items'][0]['fieldValidation']['status'],'calibrated')
        generated=self.generate().json
        self.assertEqual(generated['plantBasis']['reviewStatus'],'reviewed')
        bound=self.generate(configVersion='2.0',targetDeviceId='C3-012345abcdef').json['config']
        self.assertEqual(bound['environmentReference']['temperatureMinC'],20)
        self.assertEqual(bound['environmentReference']['temperatureMaxC'],24)
        self.assertEqual(generated['plantFit']['temperature'],'outside')
        self.assertEqual(generated['plantFit']['humidity'],'outside')
        observed={'temperatureC':22,'humidityPct':53,'observedAt':datetime.now(timezone.utc).isoformat()}
        onsite=self.generate(onsiteObservation=observed).json
        self.assertEqual(onsite['onsiteFit']['temperature'],'within')
        self.assertEqual(onsite['onsiteFit']['humidity'],'within')
        self.assertEqual(onsite['plantFit']['temperature'],'outside')
        self.assertEqual(self.generate(onsiteObservation={**observed,'observedAt':
            (datetime.now(timezone.utc)-timedelta(days=2)).isoformat()}).json['onsiteFit']['temperature'],'unavailable')
        self.assertEqual(self.generate(onsiteObservation={**observed,'observedAt':'2026-10-13T12:00:00'}).status_code,400)
        self.assertEqual(self.generate(siteType='indoor').json['plantFit']['temperature'],'unavailable')
        retired=dict(saved['items'][0]); retired['review']={**retired['review'],'status':'retired'}
        response=self.client.put('/api/admin/libraries/plants',headers=headers,base_url=base_url,json={'expectedRevision':saved['revision'],'plant':retired})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(self.generate().status_code,400)

    def test_legacy_plant_document_is_upgraded_once(self):
        with sqlite3.connect(self.db) as db:
            row=db.execute("SELECT revision,data FROM library_documents WHERE name='plants'").fetchone()
            document=json.loads(row[1]); document.pop('schemaVersion')
            for item in document['items']:
                item.pop('evidence');item.pop('review');item.pop('fieldValidation');item.pop('suitability')
            db.execute("UPDATE library_documents SET data=? WHERE name='plants'",(json.dumps(document),))
        db.close()
        create_app({'TESTING':True,'DATABASE':self.db})
        with sqlite3.connect(self.db) as db:
            upgraded=db.execute("SELECT revision,data FROM library_documents WHERE name='plants'").fetchone()
        db.close()
        self.assertEqual(upgraded[0],row[0]+1)
        self.assertEqual(json.loads(upgraded[1])['items'][0]['review']['status'],'engineering')
        create_app({'TESTING':True,'DATABASE':self.db})
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT revision FROM library_documents WHERE name='plants'").fetchone()[0],upgraded[0])
        db.close()

    def test_qualitative_sources_migrate_without_approving_engineering_numbers(self):
        with sqlite3.connect(self.db) as db:
            row=db.execute("SELECT revision,data FROM library_documents WHERE name='plants'").fetchone()
            document=json.loads(row[1]);document['schemaVersion']=2
            for item in document['items']:
                item['evidence']={'title':'','reference':'','referenceDate':'','conditions':'',
                                  'cultivar':'','growthStage':'','medium':'','numericBasis':''}
            db.execute("UPDATE library_documents SET data=? WHERE name='plants'",(json.dumps(document),))
        db.close()
        create_app({'TESTING':True,'DATABASE':self.db})
        with sqlite3.connect(self.db) as db:
            updated=json.loads(db.execute("SELECT data FROM library_documents WHERE name='plants'").fetchone()[0])
        db.close()
        self.assertEqual(updated['schemaVersion'],3)
        self.assertTrue(all(item['evidence']['reference'].startswith('https://') for item in updated['items']))
        self.assertTrue(all(item['review']['status']=='engineering' for item in updated['items']))
        self.assertTrue(all('工程参数' in item['evidence']['numericBasis'] for item in updated['items']))

    def test_source_migration_preserves_partial_admin_evidence(self):
        from engine.plant_library import upgrade_plant_document
        document=self.client.get('/api/plants').json
        document['schemaVersion']=2
        plant=document['items'][0]
        plant['evidence']={'title':'管理员正在核对的资料','reference':'','referenceDate':'',
                           'conditions':'本地温室','cultivar':'本地品种','growthStage':'',
                           'medium':'','numericBasis':''}
        original=dict(plant['evidence'])
        updated,changed=upgrade_plant_document(document)
        self.assertTrue(changed)
        self.assertEqual(updated['items'][0]['evidence'],original)


if __name__ == '__main__':
    unittest.main()
