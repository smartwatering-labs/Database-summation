import { BleTransport } from './ble.js';
import { DemoTransport } from './demo.js';
import { handshakeAuthentication, validateHandshake, validateStatus, validateHistory, validateEventPage } from './protocol.js';
import { rememberConnection, clearConnectionSession } from './connection-session.js';

function sameJson(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}

export class DeviceController extends EventTarget {
  constructor() { super(); this.state = 'disconnected'; this.demo = false; this.status = null; this.history = []; this.events = []; this.trend = []; this.busy = false; this.generation = 0; this.pendingWrite = null; this.lastSnapshot = null; this.lastRead = null; this.lastSampleKey = null; }
  emit() { this.dispatchEvent(new Event('change')); }
  async connect(settings, demo = false, options = {}) {
    if (this.busy||this.stopping) throw new Error('请等待当前设备操作完成');
    if (!options.rememberedDeviceId || demo) clearConnectionSession();
    this.disconnect(); this.demo = demo; this.state = 'connecting'; this.connectionPhase = demo?'connecting':options.rememberedDeviceId?'restoring':'choosing'; this.busy = true; this.stage = null; this.error = ''; this.emit();
    const generation = this.generation;
    const onDisconnect = () => { if (generation === this.generation) this.disconnect('设备休眠或连接断开，请按外置按钮唤醒后重连'); };
    const onProgress = stage => { if (generation === this.generation) { this.stage = stage; this.emit(); } };
    const onConnectionPhase = phase => { if (generation === this.generation) { this.connectionPhase = phase; this.emit(); } };
    const transport = demo ? new DemoTransport(onDisconnect, onProgress) : new BleTransport(settings, onDisconnect, onProgress, onConnectionPhase);
    if (demo) {
      if (this.simulator) {
        transport.config = this.simulator.config ? structuredClone(this.simulator.config) : null;
        transport.revision = this.simulator.revision;
        transport.mode = this.simulator.mode;
      }
      this.simulator = transport;
    }
    this.transport = transport;
    this.credential=settings.credential||null;
    const session = { generation, transport, expectedDeviceId: options.expectedDeviceId };
    try {
      await transport.connect(options.rememberedDeviceId); this.assertSession(session); this.state = 'handshaking'; this.connectionPhase = 'handshake'; this.emit();
      await this.authenticate(session);
      this.connectionPhase = 'status'; this.emit();
      this.status = validateStatus(await this.request(session, 'status'), this.handshake.deviceId);
      this.state = 'ready'; this.lastRead = Date.now(); this.lastSnapshot = null; this.record();
      if (!demo && options.remember && transport.device?.id) rememberConnection({ browserDeviceId: transport.device.id, deviceId: this.status.deviceId, settings,
        credential: this.credential?.deviceId === this.status.deviceId ? this.credential : null });
    } catch (error) {
      transport.disconnect();
      if (this.isSession(session)) { this.connectionFailurePhase = this.connectionPhase; this.state = 'error'; this.status = null; this.error = this.friendly(error); }
      throw new Error(this.friendly(error));
    }
    finally { if (this.isSession(session)) { this.busy = false; this.connectionPhase = null; this.emit(); } }
  }
  friendly(error) {
    if (/Connection already in progress|GATT operation.*progress/i.test(error.message || '')) return '蓝牙仍在处理连接请求，请稍后重试';
    if (/GATT.*disconnect/i.test(error.message || '') || error.name === 'NetworkError') return '蓝牙在连接初始化时断开，请保持设备供电后重试';
    if (error.name === 'NotFoundError') return '未选择设备或未发现可用设备，请确认已按外置按钮唤醒';
    if (error.name === 'SecurityError') return '浏览器拒绝蓝牙访问，请检查安全连接与蓝牙权限';
    return error.message || '设备操作失败';
  }
  isSession(session) { return session.generation === this.generation && session.transport === this.transport; }
  assertSession(session) { if (!this.isSession(session)) throw new Error('连接已取消'); }
  async request(session, action, payload) {
    this.assertSession(session);
    const result = await session.transport.request(action, payload);
    this.assertSession(session);
    return result;
  }
  async authenticate(session = { generation: this.generation, transport: this.transport }) {
    const h = validateHandshake(await this.request(session, 'handshake'));
    if (session.expectedDeviceId && h.deviceId !== session.expectedDeviceId) throw new Error('恢复连接时设备身份不匹配，请重新选择设备');
    session.transport.configureLimits?.(h.transport);
    if (this.handshake && this.handshake.deviceId !== h.deviceId) throw new Error('握手设备身份发生变化，请重新连接');
    const authentication=await handshakeAuthentication(h,this.credential);
    const result = await this.request(session, 'authenticate', { auth: authentication.auth,
      ...(authentication.security?.role&&authentication.security.role!=='owner'?{role:authentication.security.role}:{}) });
    if (result?.authenticated !== true) throw new Error('设备未确认认证成功');
    session.transport.configureSecurity?.(authentication.security);
    this.handshake = { ...h, nonce: undefined, authorizationRole: authentication.security?.role||'owner' };
  }
  record() {
    const sample = this.status?.sample;
    if (!sample || !Number.isFinite(sample.wateringDemand)
      || (sample.quality?.soilAdc && sample.quality.soilAdc.status !== 'valid')) return;
    const identity = Number.isInteger(sample.sampleSeq) && (Number.isInteger(sample.bootCount) || typeof sample.bootId === 'string')
      ? [sample.bootId ?? sample.bootCount, sample.sampleSeq]
      : [sample.sampledAt, sample.temperatureC, sample.humidityPct, sample.soilAdc, sample.rainAdc, sample.wateringDemand];
    const key = JSON.stringify([this.status.deviceId, ...identity]);
    if (key === this.lastSampleKey) return;
    this.lastSampleKey = key; this.trend.push({ ...sample }); this.trend = this.trend.slice(-60);
  }
  ensureReady() { if (this.state !== 'ready') throw new Error('请先连接设备并完成握手'); }
  observationReport() {
    this.ensureReady();
    const s=this.status.prepareSummary;
    if(this.demo)throw new Error('实测辅助生成需要连接真实设备');
    if(!this.handshake.capabilities?.includes('prepare-summary')||s?.complete!==true
      ||this.status.timeQuality!=='trusted')throw new Error('请先完成设备校时与十分钟准备期');
    if(!Number.isInteger(s.validSamples)||s.validSamples<10||!Number.isInteger(s.totalSamples)
      ||s.totalSamples<s.validSamples||s.validSamples/s.totalSamples<.8||!Number.isInteger(s.durationSeconds)||s.durationSeconds<600||s.durationSeconds>86400
      ||s.configRevision!==this.status.configRevision||!Number.isFinite(s.temperatureC)||!Number.isFinite(s.humidityPct)
      ||s.temperatureC<-20||s.temperatureC>60||s.humidityPct<0||s.humidityPct>100
      ||!Number.isInteger(s.finishedAt)||Date.now()/1000-s.finishedAt>3600||Date.now()/1000-s.finishedAt<-300)throw new Error('设备准备期摘要缺少有效或新鲜的数据，请重新准备');
    return {...s,deviceId:this.status.deviceId,timeQuality:'trusted'};
  }
  async lock(operation) {
    this.ensureReady(); if (this.busy||this.stopping) throw new Error('设备正在处理其他操作');
    const session = { generation: this.generation, transport: this.transport };
    this.busy = true; this.emit();
    try { return await operation(session); } finally { if (this.isSession(session)) { this.busy = false; this.emit(); } }
  }
  async refresh({ background = false } = {}) {
    const read = async session => {
      this.status = validateStatus(await this.request(session, 'status'), this.handshake.deviceId);
      this.lastRead = Date.now(); this.record(); this.error = ''; return this.status;
    };
    if (!background) return this.lock(read);
    this.ensureReady();
    if (this.busy || this.stopping || this.refreshing) return;
    const session = { generation: this.generation, transport: this.transport };
    this.refreshing = true;
    try { return await read(session); }
    finally { if (this.isSession(session)) { this.refreshing = false; this.emit(); } }
  }
  async readHistory() {
    return this.lock(async session => {
      let cursor = null; const records = [], cursors = new Set();
      for (let page = 0; page < 50; page++) {
        const result = await this.request(session, 'history', { range: '7d', cursor, limit: 24 });
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
  async readEvents() {
    return this.lock(async session => {
      if (!this.handshake.capabilities?.includes('events')) throw new Error('当前固件未提供事件记录');
      let cursor = null; const records = [], cursors = new Set();
      for (let page = 0; page < 50; page++) {
        const result = validateEventPage(await this.request(session, 'events', { cursor, limit: 24 }), this.handshake.deviceId);
        records.push(...result.records);
        if (!result.nextCursor) { this.events = records; return this.events; }
        if (cursors.has(result.nextCursor)) throw new Error('事件分页游标重复');
        cursor = result.nextCursor; cursors.add(cursor);
      }
      throw new Error('事件分页超限，请重试');
    });
  }
  async upload(config) {
    return this.lock(async session => {
      if(this.handshake.authProfile==='hmac-sha256-v1'&&this.handshake.authorizationRole!=='owner')throw new Error('当前凭据无权修改设备配置');
      if (this.pendingWrite) throw new Error('上次写入结果待核对，请先连接原设备并读回配置');
      if (config.configVersion === '2.0') {
        if (config.targetDeviceId !== this.handshake.deviceId) throw new Error('配置绑定的目标设备与当前连接不一致');
        if (this.handshake.maxConfigVersion !== '2.0' ||
            !['minimum-interval', 'target-bound-config'].every(value => this.handshake.capabilities?.includes(value))) {
          throw new Error('当前设备不支持 2.0 控制配置，请连接支持该格式的设备');
        }
      }
      this.stage = 'sending'; this.emit();
      try {
        await this.authenticate(session);
        const status = validateStatus(await this.request(session, 'status'), this.handshake.deviceId);
        this.status = status;
        if (config.revision <= status.configRevision) throw new Error('设备配置版本已更新，请重新生成配置再发送');
        this.pendingWrite = { deviceId: this.handshake.deviceId, config: structuredClone(config) };
        const result = await this.request(session, 'setConfiguration', { config });
        if (!result?.saved || result.revision !== config.revision) {
          const error = new Error('设备未确认保存成功，请读取设备配置核对');
          if (result?.saved === false) error.delivery = 'device-rejected';
          throw error;
        }
        this.pendingWrite = null; this.stage = 'saved';
        // A confirmed NVS save remains successful even if the device sleeps during
        // the follow-up read. Never turn a known saved result into an unknown write.
        this.status = { ...status, configRevision: result.revision, plant: config.plant, configured: true };
        try {
          await this.authenticate(session);
          this.status = validateStatus(await this.request(session, 'status'), this.handshake.deviceId);
        } catch {
          if (this.isSession(session)) {
            this.stage = 'saved';
            this.error = '配置已确认保存，但状态刷新失败；请唤醒设备后重新连接核对';
          }
          return { ...result, statusRefreshFailed: true };
        }
        return result;
      } catch (error) {
        if (this.isSession(session)) {
          if (this.pendingWrite && error.delivery !== 'device-rejected' && error.delivery !== 'not-sent') this.stage = 'unknown';
          else { this.pendingWrite = null; this.stage = 'failed'; }
        }
        throw error;
      }
    });
  }
  async verifyPendingWrite() {
    return this.lock(async session => {
      const pending = this.pendingWrite;
      if (!pending) throw new Error('没有待核对的配置写入');
      if (pending.deviceId !== this.handshake.deviceId) throw new Error('请连接原设备核对写入结果');
      await this.authenticate(session);
      const status = validateStatus(await this.request(session, 'status'), pending.deviceId);
      const result = await this.request(session, 'getConfiguration');
      this.status = status; this.lastRead = Date.now(); this.record();
      const saved = status.configRevision === pending.config.revision && sameJson(result?.config, pending.config);
      if (saved) { this.pendingWrite = null; this.stage = 'saved'; return 'saved'; }
      if (status.configRevision < pending.config.revision) { this.pendingWrite = null; this.stage = 'not-saved'; return 'not-saved'; }
      this.pendingWrite = null; this.stage = 'changed'; return 'changed';
    });
  }
  async download() { return this.lock(async session => { const result = await this.request(session, 'getConfiguration'); if (!result?.config) throw new Error('设备尚未保存配置'); return result.config; }); }
  async syncTime() {
    return this.lock(async session => {
      if(!this.handshake.capabilities?.includes('time-sync'))throw new Error('当前固件未提供校时接口');
      await this.authenticate(session);
      let timePayload={epochSeconds:Math.floor(Date.now()/1000)};
      if(this.handshake.capabilities?.includes('time-probe')){
        const before=Date.now();await this.request(session,'timeProbe');
        const roundTrip=Date.now()-before;
        timePayload={sentAtEpochMs:Date.now(),estimatedOneWayMs:Math.min(2000,Math.max(0,Math.round(roundTrip/2)))};
      }
      const result=await this.request(session,'syncTime',timePayload);
      if(result?.synchronized!==true)throw new Error('设备未确认校时');
      await this.authenticate(session);
      this.status=validateStatus(await this.request(session,'status'),this.handshake.deviceId);
      this.lastRead=Date.now();return result;
    });
  }
  async quickCheck(stimulatedSensorKey=''){return this.lock(async session=>{
    if(!this.handshake.capabilities?.includes('quick-check'))throw new Error('当前固件未提供快速检查');
    const payload=stimulatedSensorKey?{stimulatedSensorKey}:{};
    const result=await this.request(session,'quickCheck',payload);if(result?.started!==true)throw new Error('设备未确认开始检查');return result;
  });}
  async manualServo(){return this.lock(async session=>{
    if(!this.handshake.capabilities?.includes('manual-control'))throw new Error('当前固件未提供手动控制');
    const result=await this.request(session,'manualServo');
    if(result?.started!==true)throw new Error('设备未确认舵机动作');
    this.status=validateStatus(await this.request(session,'status'),this.handshake.deviceId);
    return result;
  });}
  async manualPump(on){return this.lock(async session=>{
    if(!this.handshake.capabilities?.includes('manual-control'))throw new Error('当前固件未提供手动控制');
    const result=await this.request(session,'manualPump',{on});
    if(result?.pumpOn!==on)throw new Error('设备未确认水泵状态');
    this.status=validateStatus(await this.request(session,'status'),this.handshake.deviceId);
    if(this.status.manualPumpOn!==on)throw new Error('设备水泵状态与回执不一致');
    return result;
  });}
  async stop() {
    if(!this.demo&&this.transport?.emergencyStop){
      this.ensureReady();if(this.stopping)throw new Error('正在等待设备停止确认');
      if(!this.handshake.capabilities?.includes('emergency-stop'))throw new Error('当前固件未提供停止接口');
      const session={generation:this.generation,transport:this.transport};this.stopping=true;this.emit();
      try{
        const result=await session.transport.emergencyStop();this.assertSession(session);this.busy=true;this.emit();
        if(result?.stopped!==true)throw new Error('设备未确认停止');
        await this.authenticate(session);this.status=validateStatus(await this.request(session,'status'),this.handshake.deviceId);
        if(this.status.mode!=='DISPLAY'||this.status.controlState==='watering')throw new Error('设备停止状态尚需核对');
        return result;
      }finally{if(this.isSession(session)){this.stopping=false;this.busy=false;this.emit();}}
    }
    return this.lock(async session => {
      if(!this.handshake.capabilities?.includes('emergency-stop'))throw new Error('当前固件未提供停止接口');
      const result=await this.request(session,'stop');
      if(result?.stopped!==true)throw new Error('设备未确认停止');
      this.status=validateStatus(await this.request(session,'status'),this.handshake.deviceId);
      return result;
    });
  }
  async operate(operation, mode) {
    return this.lock(async session => {
      await this.authenticate(session);
      const prepared = await this.request(session, 'prepareOperation', { operation, ...(mode ? { mode } : {}) });
      if (!prepared?.confirmationToken) throw new Error('固件未提供二次确认令牌，操作已停止');
      const result = await this.request(session, 'confirmOperation', { confirmationToken: prepared.confirmationToken });
      if (result?.confirmed !== true) throw new Error('设备未确认操作结果');
      if (operation === 'mode') this.status = validateStatus(await this.request(session, 'status'), this.handshake.deviceId);
      return result;
    });
  }
  disconnect(message = '', { forget = false } = {}) {
    if (forget) clearConnectionSession();
    this.connectionPhase = null; this.connectionFailurePhase = null;
    if (this.status && this.lastRead) this.lastSnapshot = { status: this.status, readAt: this.lastRead, demo: this.demo };
    this.generation++; this.refreshing = false; this.transport?.disconnect(); this.transport = null; this.handshake = null;
    this.state = 'disconnected'; this.status = null; this.history = []; this.events = []; this.trend = []; this.lastSampleKey = null; this.busy = false;this.stopping=false; this.stage = this.pendingWrite ? 'unknown' : this.stage === 'saved' ? 'saved' : null; this.error = message; this.demo = false; this.emit();
  }
}
