import { BleTransport } from './ble.js';
import { DemoTransport } from './demo.js';
import { authentication, validateHandshake, validateStatus, validateHistory } from './protocol.js';

export class DeviceController extends EventTarget {
  constructor() { super(); this.state = 'disconnected'; this.demo = false; this.status = null; this.history = []; this.trend = []; this.busy = false; this.generation = 0; }
  emit() { this.dispatchEvent(new Event('change')); }
  async connect(settings, demo = false) {
    if (this.busy) throw new Error('请等待当前设备操作完成');
    this.disconnect(); this.demo = demo; this.state = 'connecting'; this.busy = true; this.error = ''; this.emit();
    const generation = this.generation;
    const onDisconnect = () => { if (generation === this.generation) this.disconnect('设备休眠或连接断开，请按外置按钮唤醒后重连'); };
    const onProgress = stage => { this.stage = stage; this.emit(); };
    const transport = demo ? (this.simulator ||= new DemoTransport(onDisconnect, onProgress)) : new BleTransport(settings, onDisconnect, onProgress);
    if (demo) { transport.onDisconnect = onDisconnect; transport.onProgress = onProgress; }
    this.transport = transport;
    try {
      await transport.connect(); this.state = 'handshaking'; this.emit();
      await this.authenticate();
      if (generation !== this.generation) throw new Error('连接已取消');
      this.status = validateStatus(await transport.request('status'), this.handshake.deviceId);
      this.state = 'ready'; this.record();
    } catch (error) { transport.disconnect(); this.state = 'error'; this.status = null; this.error = this.friendly(error); throw new Error(this.error); }
    finally { this.busy = false; this.emit(); }
  }
  friendly(error) {
    if (error.name === 'NotFoundError') return '未选择设备或未发现可用设备，请确认已按外置按钮唤醒';
    if (error.name === 'SecurityError') return '浏览器拒绝蓝牙访问，请检查安全连接与蓝牙权限';
    return error.message || '设备操作失败';
  }
  async authenticate() {
    const h = validateHandshake(await this.transport.request('handshake'));
    this.transport.configureLimits?.(h.transport);
    if (this.handshake && this.handshake.deviceId !== h.deviceId) throw new Error('握手设备身份发生变化，请重新连接');
    const result = await this.transport.request('authenticate', { auth: await authentication(h.nonce) });
    if (result?.authenticated !== true) throw new Error('设备未确认认证成功');
    this.handshake = { ...h, nonce: undefined };
  }
  record() {
    const sample = this.status?.sample;
    if (sample) { this.trend.push({ ...sample }); this.trend = this.trend.slice(-60); }
  }
  ensureReady() { if (this.state !== 'ready') throw new Error('请先连接设备并完成握手'); }
  async lock(operation) {
    this.ensureReady(); if (this.busy) throw new Error('设备正在处理其他操作');
    this.busy = true; this.emit();
    try { return await operation(); } finally { this.busy = false; this.emit(); }
  }
  async refresh() {
    return this.lock(async () => {
      this.status = validateStatus(await this.transport.request('status'), this.handshake.deviceId);
      this.lastRead = Date.now(); this.record(); this.error = ''; return this.status;
    });
  }
  async readHistory() {
    return this.lock(async () => {
      let cursor = null; const records = [], cursors = new Set();
      for (let page = 0; page < 50; page++) {
        const result = await this.transport.request('history', { range: '7d', cursor, limit: 24 });
        if (result?.deviceId !== this.handshake.deviceId) throw new Error('历史数据来源不匹配');
        if (!Array.isArray(result.records) || result.records.length > 24) throw new Error('历史分页格式无效');
        records.push(...result.records);
        if (!result.nextCursor) { this.history = validateHistory(records); return this.history; }
        if (typeof result.nextCursor !== 'string' || cursors.has(result.nextCursor)) throw new Error('历史分页游标重复');
        cursor = result.nextCursor; cursors.add(cursor);
      }
      throw new Error('历史分页超限，请重试');
    });
  }
  async upload(config) {
    return this.lock(async () => {
      this.stage = 'sending'; this.emit();
      try {
        await this.authenticate();
        const status = validateStatus(await this.transport.request('status'), this.handshake.deviceId);
        this.status = status;
        if (config.revision <= status.configRevision) throw new Error('设备配置版本已更新，请重新生成配置再发送');
        const result = await this.transport.request('setConfiguration', { config });
        if (!result?.saved || result.revision !== config.revision) throw new Error('设备未确认保存成功，请读取设备配置核对');
        this.stage = 'saved';
        // A confirmed NVS save remains successful even if the device sleeps during
        // the follow-up read. Never turn a known saved result into an unknown write.
        this.status = { ...status, configRevision: result.revision, plant: config.plant, configured: true };
        try {
          await this.authenticate();
          this.status = validateStatus(await this.transport.request('status'), this.handshake.deviceId);
        } catch {
          this.error = '配置已确认保存，但状态刷新失败；请唤醒设备后重新连接核对';
          return { ...result, statusRefreshFailed: true };
        }
        return result;
      } catch (error) { this.stage = 'failed'; throw error; }
    });
  }
  async download() { return this.lock(async () => { const result = await this.transport.request('getConfiguration'); if (!result?.config) throw new Error('设备尚未保存配置'); return result.config; }); }
  async operate(operation, mode) {
    return this.lock(async () => {
      await this.authenticate();
      const prepared = await this.transport.request('prepareOperation', { operation, ...(mode ? { mode } : {}) });
      if (!prepared?.confirmationToken) throw new Error('固件未提供二次确认令牌，操作已停止');
      const result = await this.transport.request('confirmOperation', { confirmationToken: prepared.confirmationToken });
      if (result?.confirmed !== true) throw new Error('设备未确认操作结果');
      if (operation === 'mode') this.status = validateStatus(await this.transport.request('status'), this.handshake.deviceId);
      return result;
    });
  }
  disconnect(message = '') {
    this.generation++; this.transport?.disconnect(); this.transport = null; this.handshake = null;
    this.state = 'disconnected'; this.status = null; this.history = []; this.trend = []; this.busy = false; this.stage = null; this.error = message; this.demo = false; this.emit();
  }
}
