import { validateCredential } from './protocol.js';

export const CONNECTION_SESSION_KEY = 'watering-ble-session';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normalize(value) {
  if (value?.version !== 1 || typeof value.browserDeviceId !== 'string' || !value.browserDeviceId || value.browserDeviceId.length > 512
    || typeof value.deviceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.deviceId)) throw new Error('Invalid connection session');
  const settings = {};
  for (const key of ['serviceUuid', 'writeUuid', 'notifyUuid']) {
    if (!uuid.test(value.settings?.[key] || '')) throw new Error('Invalid connection settings');
    settings[key] = value.settings[key];
  }
  const credential = value.credential == null ? null : validateCredential(value.credential);
  if (credential && credential.deviceId !== value.deviceId) throw new Error('Credential identity mismatch');
  return { version: 1, browserDeviceId: value.browserDeviceId, deviceId: value.deviceId, settings, credential };
}
export function clearConnectionSession(storage) {
  try { (storage || globalThis.sessionStorage)?.removeItem(CONNECTION_SESSION_KEY); } catch {}
}
export function readConnectionSession(storage) {
  try {
    const raw = (storage || globalThis.sessionStorage)?.getItem(CONNECTION_SESSION_KEY);
    if (!raw) return null;
    if (raw.length > 8192) throw new Error('Connection session too large');
    return normalize(JSON.parse(raw));
  } catch { clearConnectionSession(storage); return null; }
}
export function rememberConnection(value, storage) {
  try {
    const target = storage || globalThis.sessionStorage;
    if (!target) return false;
    target.setItem(CONNECTION_SESSION_KEY, JSON.stringify(normalize({ ...value, version: 1 })));
    return true;
  } catch { return false; }
}
