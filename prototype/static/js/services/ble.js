import { FrameDecoder, encodeMessage, PROTOCOL, VERSION } from './protocol.js';

export class BleTransport {
  constructor(settings, onDisconnect, onProgress) {
    this.settings = settings; this.onDisconnect = onDisconnect; this.onProgress = onProgress;
    this.pending = new Map(); this.queue = Promise.resolve(); this.closed = true;
    this.configureLimits();
    this.decoder = new FrameDecoder(message => this.receive(message), () => this.rejectAll(new Error('设备返回消息损坏，请重新连接')));
    this.handleDisconnect = () => { this.closed = true; this.rejectAll(new Error('蓝牙已断开，请唤醒设备后重新连接')); this.onDisconnect(); };
    this.handleNotification = event => this.decoder.push(new Uint8Array(event.target.value.buffer, event.target.value.byteOffset, event.target.value.byteLength));
  }
  configureLimits(limits = {}) {
    const defaults = { maxMessageBytes: 8192, maxConfigBytes: 6144, maxFrames: 70, framePayloadBytes: 120, writeChunkBytes: 20 };
    const next = { ...defaults, ...limits };
    for (const [key, ceiling] of Object.entries(defaults)) {
      if (!Number.isInteger(next[key]) || next[key] < 1 || next[key] > ceiling) throw new Error('设备声明的蓝牙传输容量不兼容');
    }
    this.limits = next;
  }
  async connect() {
    if (!globalThis.isSecureContext || !navigator.bluetooth) throw new Error('当前环境无法使用 Web Bluetooth，请用支持该功能的浏览器访问 localhost 或 HTTPS');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const key of ['serviceUuid', 'writeUuid', 'notifyUuid']) if (!uuid.test(this.settings[key] || '')) throw new Error('尚未设置实际 BLE UUID请在连接设置中填写固件服务及特征 UUID');
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [this.settings.serviceUuid] }] });
    this.device.addEventListener('gattserverdisconnected', this.handleDisconnect);
    try {
      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(this.settings.serviceUuid);
      this.writer = await service.getCharacteristic(this.settings.writeUuid);
      this.reader = await service.getCharacteristic(this.settings.notifyUuid);
      if (!this.writer.properties.write) throw new Error('写入特征必须支持带响应写入');
      if (!this.reader.properties.notify && !this.reader.properties.indicate) throw new Error('接收特征不支持通知');
      this.reader.addEventListener('characteristicvaluechanged', this.handleNotification);
      await this.reader.startNotifications(); this.closed = false;
    } catch (error) { this.disconnect(); throw error; }
  }
  receive(message) {
    const pending = this.pending.get(message.id);
    if (!pending || message.protocol !== PROTOCOL || message.protocolVersion !== VERSION) return;
    if (message.status === 'progress') { this.onProgress(message.stage === 'validating' ? 'validating' : 'sending'); return; }
    clearTimeout(pending.timer); this.pending.delete(message.id);
    if (message.status !== 'ok') pending.reject(new Error(message.message || '设备拒绝操作'));
    else pending.resolve(message.payload);
  }
  request(action, payload = {}) {
    const operation = this.queue.then(async () => {
      try { return await this.send(action, payload); }
      catch (error) {
        if (!this.closed && ['status', 'history', 'getConfiguration'].includes(action) && /超时|损坏/.test(error.message)) {
          this.decoder.reset();
          return await this.send(action, payload);
        }
        throw error;
      }
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  async send(action, payload) {
    if (this.closed) throw new Error('设备尚未连接');
    const id = crypto.randomUUID();
    const message = { id, protocol: PROTOCOL, protocolVersion: VERSION, action, payload };
    const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
    if (size(message) > this.limits.maxMessageBytes || (action === 'setConfiguration' && size(payload.config) > this.limits.maxConfigBytes)) {
      throw new Error('配置或消息超过设备容量，请缩减配置后重新生成');
    }
    const frames = encodeMessage(message, this.limits.framePayloadBytes);
    if (frames.length > this.limits.maxFrames) throw new Error('配置分包数量超过设备容量');
    let resolve, reject;
    const reply = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Attach a rejection handler immediately, while asynchronous writes are still running.
    reply.catch(() => {});
    const failure = reply.then(() => new Promise(() => {}));
    failure.catch(() => {});
    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error('设备响应超时；写入结果未知，请读取设备配置确认后再操作'));
    }, 20000);
    this.pending.set(id, { resolve, reject, timer });
    try {
      for (const frame of frames) {
        for (let offset = 0; offset < frame.length; offset += this.limits.writeChunkBytes) {
          if (this.closed || !this.pending.has(id)) throw new Error('传输已中断或超时');
          await Promise.race([this.writer.writeValueWithResponse(frame.slice(offset, offset + this.limits.writeChunkBytes)), failure]);
        }
      }
      return await reply;
    } catch (error) {
      clearTimeout(timer); this.pending.delete(id); reject(error); throw error;
    }
  }
  rejectAll(error) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); this.decoder.reset(); }
  disconnect() {
    this.closed = true;
    this.reader?.removeEventListener('characteristicvaluechanged', this.handleNotification);
    this.device?.removeEventListener('gattserverdisconnected', this.handleDisconnect);
    this.device?.gatt?.disconnect();
    this.rejectAll(new Error('连接已关闭'));
  }
}
