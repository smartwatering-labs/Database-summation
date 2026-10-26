import test from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTION_SESSION_KEY, rememberConnection, readConnectionSession, clearConnectionSession } from '../static/js/services/connection-session.js';

function memoryStorage() {
  const items = new Map();
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) };
}
const settings = { serviceUuid:'00000000-0000-4000-8000-000000000001', writeUuid:'00000000-0000-4000-8000-000000000002', notifyUuid:'00000000-0000-4000-8000-000000000003' };
const record = { browserDeviceId:'browser-permitted-device', deviceId:'C3-test', settings };

test('tab connection recovery retains matching credentials without storing configuration or authentication sessions', () => {
  const storage = memoryStorage(), credential = { deviceId:'C3-test', secret:'ab'.repeat(32), role:'operator' };
  assert.equal(rememberConnection({ ...record, settings:{...settings, config:{plant:'private'}}, credential, nonce:'old', sequence:12, config:{plant:'private'} }, storage), true);
  assert.deepEqual(readConnectionSession(storage), { ...record, version:1, credential });
  const raw = storage.getItem(CONNECTION_SESSION_KEY);
  for (const field of ['private','nonce','sequence','config']) assert.equal(raw.includes(field), false);
  clearConnectionSession(storage);
  assert.equal(readConnectionSession(storage), null);
});

test('invalid or mismatched recovery records are discarded', () => {
  const storage = memoryStorage();
  for (const raw of ['{', JSON.stringify({...record,version:2}), JSON.stringify({...record,version:1,settings:{}}),
    JSON.stringify({...record,version:1,credential:{deviceId:'C3-other',secret:'ab'.repeat(32)}})]) {
    storage.setItem(CONNECTION_SESSION_KEY, raw);
    assert.equal(readConnectionSession(storage), null);
    assert.equal(storage.getItem(CONNECTION_SESSION_KEY), null);
  }
});

test('blocked tab storage is tolerated without throwing', () => {
  const storage = { getItem(){throw new Error('blocked');}, setItem(){throw new Error('blocked');}, removeItem(){throw new Error('blocked');} };
  assert.equal(rememberConnection(record, storage), false);
  assert.equal(readConnectionSession(storage), null);
  assert.doesNotThrow(() => clearConnectionSession(storage));
});
