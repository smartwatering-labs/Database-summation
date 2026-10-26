import { PROTOCOL, VERSION, authentication } from './protocol.js';

/** Explicit opt-in in-memory test device. Never contacts Bluetooth or the server. */
export class DemoTransport {
  constructor(onDisconnect = () => {}, onProgress = () => {}, latency = 220) {
    this.onDisconnect = onDisconnect; this.onProgress = onProgress; this.latency = latency;
    this.mode = 'DISPLAY'; this.config = null; this.revision = 0; this.connected = false; this.tokens = new Map(); this.tick = 0;
    this.manualPumpOn = false; this.manualPumpUntil = 0; this.servoBusyUntil = 0;
    const now = Math.floor(Date.now() / 1000);
    this.records = Array.from({ length: 84 }, (_, i) => ({ bootCount: 117 + i, sampledAt: now - (83 - i) * 7200,
      temperatureC: +(25 + 3 * Math.sin(i / 5)).toFixed(1), humidityPct: Math.round(62 + 9 * Math.cos(i / 8)),
      soilAdc: 10 + i % 10, rainAdc: i % 17 === 0 ? 700 : 2400,
      wateringDemand: i % 17 === 0 ? 0 : +(25 + (i % 14) * 3.8).toFixed(1), watered: i % 14 === 13, rainDetected: i % 17 === 0 }));
    this.events=[{eventId:'demo-sensor-1',code:'sensor-invalid',severity:'warning',sensorKey:'soilAdc',
      configRevision:0,occurredAt:now-3600,recoveredAt:now-3300,timeQuality:'trusted',controlImpact:'自动浇水已暂停，复测有效后恢复'},
      {eventId:'demo-storage-1',code:'storage-check',severity:'info',sensorKey:null,
        configRevision:0,occurredAt:now-1200,recoveredAt:now-1100,timeQuality:'trusted',controlImpact:'仅供演示'}];
  }
  async connect() { this.connected = true; }
  async request(action, payload = {}) {
    if (!this.connected) throw new Error('模拟设备已断开');
    await new Promise(resolve => setTimeout(resolve, this.latency));
    if (!this.connected) throw new Error('模拟设备已断开');
    if (action === 'handshake') {
      this.nonce = crypto.randomUUID(); this.authenticated = false;
      return { protocol: PROTOCOL, protocolVersion: VERSION, deviceId: 'DEMO-WATER001', model: 'ESP32-C3', fwVersion: '3.8.0', nonce: this.nonce,
        maxConfigVersion: '2.0', capabilities: ['status', 'history', 'configuration', 'confirmed-operations', 'minimum-interval', 'target-bound-config', 'sample-quality', 'events', 'manual-control'] };
    }
    if (action === 'authenticate') {
      if (!this.nonce || payload.auth !== await authentication(this.nonce)) throw new Error('模拟设备认证失败');
      this.nonce = null; this.authenticated = true; return { authenticated: true };
    }
    if (!this.authenticated) throw new Error('请先完成认证');
    if (this.manualPumpOn && Date.now() >= this.manualPumpUntil) this.manualPumpOn = false;
    if (action === 'status') {
      this.tick++;
      return { protocol: PROTOCOL, protocolVersion: VERSION, deviceId: 'DEMO-WATER001', fwVersion: '3.8.0', mode: this.mode,
        plant: this.config?.plant || '尚未配置', configRevision: this.revision, configured: !!this.config,
        manualPumpOn: this.manualPumpOn, servoBusy: Date.now() < this.servoBusyUntil, calibrationReady: true,
        sample: { temperatureC: +(26.5 + Math.sin(this.tick / 4)).toFixed(1), humidityPct: 58, soilAdc: 12, rainAdc: 2400, solarVoltageV: 5.1,
          wateringDemand: +(42 + Math.sin(this.tick / 3) * 6).toFixed(1), sampledAt: Math.floor(Date.now() / 1000), bootCount:1,sampleSeq:this.tick,timeQuality:'trusted',
          quality:{temperatureC:{status:'valid'},humidityPct:{status:'valid'},soilAdc:{status:'valid'},rainAdc:{status:'valid'},solarVoltageV:{status:'valid'}} } };
    }
    if (action === 'history') {
      const offset = Number(payload.cursor || 0), limit = Math.min(24, payload.limit || 24);
      return { deviceId: 'DEMO-WATER001', records: this.records.slice(offset, offset + limit), nextCursor: offset + limit < this.records.length ? String(offset + limit) : null };
    }
    if (action === 'events') {
      const offset=Number(payload.cursor||0),limit=Math.min(24,payload.limit||24);
      return {deviceId:'DEMO-WATER001',records:this.events.slice(offset,offset+limit),nextCursor:offset+limit<this.events.length?String(offset+limit):null};
    }
    if (action === 'getConfiguration') return { config: this.config ? structuredClone(this.config) : null };
    if (action === 'manualServo') {
      if (this.mode !== 'DISPLAY' || this.manualPumpOn || Date.now() < this.servoBusyUntil) throw new Error('请先进入展示模式并关闭水泵');
      this.servoBusyUntil = Date.now() + 1000;
      return { started: true, durationMs: 1000 };
    }
    if (action === 'manualPump') {
      if (typeof payload.on !== 'boolean') throw new Error('水泵命令缺少开关状态');
      if (this.mode !== 'DISPLAY' || Date.now() < this.servoBusyUntil) throw new Error('请先进入展示模式并等待舵机停止');
      if (payload.on && !this.manualPumpOn) this.manualPumpUntil = Date.now() + 30000;
      this.manualPumpOn = payload.on;
      return { pumpOn: this.manualPumpOn, maxRunSeconds: 30 };
    }
    if (action === 'setConfiguration') {
      if (payload.config?.deviceModel !== 'ESP32-WATER-C3' || payload.config.revision <= this.revision) throw new Error('配置版本冲突，请重新生成');
      if (payload.config.configVersion === '2.0' && (payload.config.targetDeviceId !== 'DEMO-WATER001' ||
          !Number.isInteger(payload.config.params?.minWaterIntervalSeconds))) throw new Error('目标设备或最短间隔无效');
      this.onProgress('validating'); await new Promise(resolve => setTimeout(resolve, this.latency));
      if (!this.connected) throw new Error('模拟设备已断开');
      this.config = structuredClone(payload.config); this.revision = this.config.revision;
      this.authenticated = false;
      return { saved: true, revision: this.revision };
    }
    if (action === 'prepareOperation') {
      if (!['mode', 'restart', 'factoryReset'].includes(payload.operation)) throw new Error('未知操作');
      const token = crypto.randomUUID(); this.tokens.set(token, { ...payload, expires: Date.now() + 30000 });
      return { confirmationToken: token, expiresInSeconds: 30 };
    }
    if (action === 'confirmOperation') {
      const operation = this.tokens.get(payload.confirmationToken); this.tokens.delete(payload.confirmationToken);
      if (!operation || operation.expires < Date.now()) throw new Error('设备确认令牌已过期');
      if (operation.operation === 'mode') {
        if (!['DISPLAY', 'PREPARE', 'LONGRUN'].includes(operation.mode)) throw new Error('模式无效');
        if (operation.mode === 'LONGRUN' && !this.config) throw new Error('请先写入配置再启用长期运行');
        this.mode = operation.mode; this.manualPumpOn = false;
      }
      if (operation.operation === 'factoryReset') { this.mode = 'DISPLAY'; this.config = null; this.revision = 0; }
      if (operation.operation !== 'mode') setTimeout(() => { this.disconnect(); this.onDisconnect(); }, 350);
      return { confirmed: true, mode: this.mode };
    }
    throw new Error('模拟设备不支持此操作');
  }
  disconnect() { this.connected = false; this.authenticated = false; this.manualPumpOn = false; this.tokens.clear(); }
}
