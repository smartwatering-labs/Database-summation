export const PROTOCOL = 'SWS-BLE';
export const VERSION = '1.0';
export const MODEL = 'ESP32-C3';
export const CONFIG_MODEL = 'ESP32-WATER-C3';
export const MAX_MESSAGE = 65536;
const encoder = new TextEncoder();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

export function encodeMessage(message, payloadSize = 120) {
  const bytes = encoder.encode(JSON.stringify(message));
  if (!message.id || bytes.length > MAX_MESSAGE) throw new Error('蓝牙消息缺少编号或超过 64 KB');
  const total = Math.ceil(bytes.length / payloadSize), checksum = crc32(bytes);
  return Array.from({ length: total }, (_, index) => {
    const part = bytes.slice(index * payloadSize, (index + 1) * payloadSize);
    const data = btoa(String.fromCharCode(...part));
    return encoder.encode(JSON.stringify({ id: message.id, index, total, checksum, data }) + '\n');
  });
}

/** SWS-BLE 1.0: newline JSON frames, base64 payload, whole-message CRC32. */
export class FrameDecoder {
  constructor(onMessage, onError = () => {}) {
    this.onMessage = onMessage; this.onError = onError; this.reset();
  }
  reset() { this.decoder = new TextDecoder('utf-8', { fatal: true }); this.buffer = ''; this.messages = new Map(); }
  push(bytes) {
    try {
      this.buffer += this.decoder.decode(bytes, { stream: true });
      if (this.buffer.length > MAX_MESSAGE * 2) throw new Error('接收缓冲区超限');
      let end;
      while ((end = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        if (line.trim()) this.accept(JSON.parse(line));
      }
    } catch (error) { this.reset(); this.onError(error); }
  }
  accept(frame) {
    const { id, index, total, checksum, data } = frame;
    if (typeof id !== 'string' || id.length > 80 || !Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > 1024 || index < 0 || index >= total || typeof data !== 'string' || data.length > 1024 || !/^[a-f0-9]{8}$/.test(checksum)) throw new Error('分包格式无效');
    const now = Date.now();
    for (const [key, item] of this.messages) if (now - item.created > 20000) this.messages.delete(key);
    if (!this.messages.has(id)) {
      if (this.messages.size >= 8) throw new Error('等待重组的消息过多');
      this.messages.set(id, { total, checksum, parts: new Map(), size: 0, created: now });
    }
    const message = this.messages.get(id);
    if (message.total !== total || message.checksum !== checksum) throw new Error('分包元数据不一致');
    const part = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    if (message.parts.has(index)) {
      if (crc32(message.parts.get(index)) !== crc32(part)) throw new Error('重复分包内容不一致');
      return;
    }
    message.parts.set(index, part); message.size += part.length;
    if (message.size > MAX_MESSAGE) throw new Error('消息过大');
    if (message.parts.size !== total) return;
    this.messages.delete(id);
    const bytes = new Uint8Array(message.size); let offset = 0;
    for (let i = 0; i < total; i++) { const p = message.parts.get(i); bytes.set(p, offset); offset += p.length; }
    if (crc32(bytes) !== checksum) throw new Error('消息校验失败');
    const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (decoded.id !== id) throw new Error('消息编号不一致');
    this.onMessage(decoded);
  }
}

export function validateHandshake(value) {
  if (value?.protocol !== PROTOCOL || value?.protocolVersion !== VERSION) throw new Error('设备协议不兼容，需要 SWS-BLE 1.0');
  if (value.model !== MODEL) throw new Error('设备型号不匹配，需要 ESP32-C3');
  if (typeof value.deviceId !== 'string' || !value.deviceId || typeof value.nonce !== 'string' || value.nonce.length < 8 || value.nonce.length > 256) throw new Error('设备握手信息不完整');
  if (typeof value.fwVersion !== 'string' || !/^\d+\.\d+(\.\d+)?$/.test(value.fwVersion)) throw new Error('固件版本格式无法识别');
  const [major, minor] = value.fwVersion.split('.').map(Number);
  if (major < 3 || (major === 3 && minor < 3)) throw new Error('固件过旧，需要 3.3 或更新版本');
  if (value.supportedModes != null && (!Array.isArray(value.supportedModes) || !value.supportedModes.length || value.supportedModes.some(mode => !['DISPLAY', 'PREPARE', 'LONGRUN'].includes(mode)))) throw new Error('设备模式能力格式无效');
  return value;
}

export async function authentication(nonce) {
  // The documented development secret is public and is not a production secret.
  // Do not call this encryption or a strong identity/security guarantee.
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(nonce + 'SWS2026C3'));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validateStatus(value, deviceId) {
  if (value?.protocol !== PROTOCOL || value?.protocolVersion !== VERSION || value?.deviceId !== deviceId) throw new Error('设备状态来源或协议不匹配');
  if (!['DISPLAY', 'PREPARE', 'LONGRUN'].includes(value.mode) || !Number.isInteger(value.configRevision) || value.configRevision < 0) throw new Error('设备状态格式无效');
  const s = value.sample;
  if (s != null) {
    for (const [key, min, max] of [['temperatureC', -60, 100], ['humidityPct', 0, 100], ['soilAdc', 0, 4095], ['rainAdc', 0, 4095], ['wateringDemand', 0, 100]]) {
      if (s[key] !== null && (typeof s[key] !== 'number' || !Number.isFinite(s[key]) || s[key] < min || s[key] > max)) throw new Error('设备采样数据无效：' + key);
    }
  }
  return value;
}

export function validateHistory(records) {
  if (!Array.isArray(records) || records.length > 1008) throw new Error('历史记录过多或格式无效');
  const now = Date.now();
  return records.filter(row => {
    if (!row || !Number.isInteger(row.bootCount) || row.bootCount < 0) throw new Error('历史记录缺少有效唤醒序号');
    validateStatus({ protocol: PROTOCOL, protocolVersion: VERSION, deviceId: 'history', mode: 'LONGRUN', configRevision: 0, sample: row }, 'history');
    for (const key of ['watered', 'rainDetected']) if (row[key] != null && typeof row[key] !== 'boolean') throw new Error('历史事件标记必须为布尔值');
    if (row.sampledAt === 0 || row.sampledAt == null) return true;
    const time = typeof row.sampledAt === 'number' ? row.sampledAt * 1000 : Date.parse(row.sampledAt);
    if (!Number.isFinite(time)) throw new Error('历史采样时间格式无效');
    return time <= now + 60000 && time >= now - 7 * 86400000;
  });
}
