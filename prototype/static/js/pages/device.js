import { button, escape as e, pageTitle, notice, metric, modes, timestamp, icon } from '../ui.js';

function age(value) {
  if (!value) return '时间未知';
  const ms = typeof value === 'number' && value < 1e11 ? value * 1000 : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '时间未知';
  const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  return minutes < 1 ? '不足 1 分钟' : minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

const channelNames={temperatureC:'温度',humidityPct:'空气湿度',soilAdc:'土壤',rainAdc:'雨量',solarVoltageV:'太阳能输入'};
const qualityNames={valid:'有效',suspect:'疑似异常',stale:'近期替代值',invalid:'无效',unconfigured:'未配置',missing:'缺少读数'};
const qualityReasons={'recent-valid-fallback':'使用近期有效读数','read-failed':'读取失败','out-of-range':'超出有效范围','out-of-range-or-jump':'超范围或读数突变','stuck-after-stimulus':'主动改变输入后三次读数未变化','sensor-supply-suspected':'检查共用传感器供电与接线','voltage-out-of-range':'输入电压超出量程','calibration-required':'等待分压与传感器标定'};
const severityNames={info:'信息',warning:'注意',critical:'严重'};
function eventEvidence(item){
  const range=item.referenceMin!=null&&item.referenceMax!=null?`参考范围 ${item.referenceMin}–${item.referenceMax}`:'';
  const summary=item.observedSummary||{};
  const observed=Number.isFinite(summary.mean)?`观测均值 ${summary.mean.toFixed(1)}（${summary.count} 次）`:summary.value!=null?`观测值 ${summary.value}`:'';
  return [range,observed].filter(Boolean).join('；');
}
const inhibitionNames={'storage-unavailable':'日志或检查点存储未就绪','calibration-required':'需要完成实物标定','bound-config-required':'需要写入绑定本机的 2.0 配置','time-untrusted':'需要校时','sample-stale':'采样已过期','soil-invalid':'土壤通道无效','rain-invalid':'雨量通道无效','air-invalid':'温湿度通道无效','rain-detected':'检测到降雨','minimum-interval':'等待最短浇水间隔','operator-stop':'已由用户停止','checkpoint-failed':'浇水前检查点保存失败','storage-failed':'运行记录保存失败'};
function qualitySummary(sample) {
  return Object.entries(sample?.quality||{}).filter(([,item])=>item.status!=='valid')
    .map(([key,item])=>`${channelNames[key]||key}：${qualityNames[item.status]||item.status}${item.reason?`（${qualityReasons[item.reason]||item.reason}）`:''}${item.ageSeconds!=null?`，距原始采样 ${item.ageSeconds} 秒`:''}`).join('；');
}

export function devicePage(state, device) {
  const ready = device.state === 'ready';
  if (!ready) return `${pageTitle('硬件情况查看', '连接并完成握手后，查看设备当前状态与最近一周采样')}
    <section class="empty-state device-empty"><span class="preview-icon">${icon('bluetooth',36)}</span><h2>${device.busy ? '正在连接设备' : '等待连接浇水设备'}</h2><p>${e(device.error || '尚未取得设备数据；请给设备供电，等待定时唤醒后再连接蓝牙')}</p><div class="actions">${button('连接设备','connect',{type:'primary',disabled:device.busy})}${state.settings.demoEnabled ? button('体验模拟设备','demo',{type:'outline',disabled:device.busy}) : ''}</div></section>
    ${device.pendingWrite ? notice(`R${e(device.pendingWrite.config.revision)} 写入结果待核对。请连接原设备 ${e(device.pendingWrite.deviceId)}，读回配置后再发送。`,'warning') : ''}
    `;
  const data = device.status, sample = data.sample;
  const role=device.handshake.authorizationRole||'owner',canControl=role!=='viewer',canManage=role==='owner';
  const configurationOnly = device.handshake.runtimeProfile === 'configuration-oled';
  const supportedModes = device.handshake.supportedModes || ['DISPLAY','PREPARE'];
  const records = device.history, page = Math.min(state.historyPage || 0, Math.max(0, Math.ceil(records.length / 12) - 1));
  const rows = [...records].reverse().slice(page * 12, page * 12 + 12);
  const events=device.events||[], eventPage=Math.min(state.eventsPage||0,Math.max(0,Math.ceil(events.length/8)-1));
  const eventRows=[...events].reverse().slice(eventPage*8,eventPage*8+8);
  const eventSection=device.handshake.capabilities?.includes('events') ? `<section class="history-section"><div class="section-heading"><div><h2>设备事件</h2><p class="small muted">事件由设备记录，恢复状态以设备复测为准</p></div>${button(state.eventsOpen?'重新读取事件':'读取设备事件','events',{type:'outline',symbol:'download',disabled:device.busy})}</div>
    ${state.eventsLoading?'<p role="status">正在读取设备事件…</p>':''}
     ${state.eventsOpen&&!state.eventsLoading?(eventRows.length?`<div class="table-scroll"><table><thead><tr><th>发生时间</th><th>级别</th><th>事件 / 通道</th><th>依据</th><th>控制影响</th><th>恢复</th></tr></thead><tbody>${eventRows.map(item=>`<tr><td>${e(timestamp(item.occurredAt,item.bootCount))}</td><td>${e(severityNames[item.severity])}</td><td>${e(item.code)}${item.sensorKey?` · ${e(channelNames[item.sensorKey])}`:''}</td><td>${e(eventEvidence(item)||'—')}</td><td>${e(item.controlImpact||'见设备状态')}</td><td>${item.recoveredAt!=null?e(timestamp(item.recoveredAt,item.bootCount)):item.severity==='info'?'—':'待复测'}</td></tr>`).join('')}</tbody></table></div><div class="pagination"><span>第 ${eventPage+1} / ${Math.ceil(events.length/8)} 页</span><div class="actions">${button('上一页','events-prev',{type:'outline',disabled:eventPage===0})}${button('下一页','events-next',{type:'outline',disabled:(eventPage+1)*8>=events.length})}</div></div>`:'<div class="empty-state compact"><p>设备暂无事件记录</p></div>'):'<p class="caption muted">按需读取设备本地事件，不持续占用蓝牙链路</p>'}</section>` : '';
  return `${pageTitle('硬件情况查看',configurationOnly ? '查看蓝牙连接、配置版本与设备保存结果' : '最新采样来自设备；长期模式默认每 2 小时唤醒一次',button('刷新数据','refresh',{type:'outline',symbol:'refresh',disabled:device.busy}) + button('断开连接','disconnect',{type:'secondary',disabled:device.busy}))}
    ${configurationOnly ? notice('当前固件支持蓝牙配置收发、断电保存和 OLED 状态显示；尚未接入传感器采样及自动浇水，DISPLAY / PREPARE 均保持蓝牙在线') : ''}
    ${device.demo ? notice('<strong>模拟设备已连接</strong> 此页所有设备读数均为演示数据，不代表真实硬件','warning') : ''}
    ${device.pendingWrite ? notice(`R${e(device.pendingWrite.config.revision)} 写入结果待核对，目标设备 ${e(device.pendingWrite.deviceId)}。${device.pendingWrite.deviceId === data.deviceId ? button('读回核对','verify-write',{type:'outline',disabled:device.busy}) : '请连接原设备后核对。'}`,'warning') : ''}
    ${state.deviceError ? notice(e(state.deviceError),'warning') : ''}
    ${data.controlInhibition?notice(e(inhibitionNames[data.controlInhibition]||data.controlInhibition),'warning'):''}
     <section class="device-identity"><div><span class="caption muted">设备 ID</span><h2>${e(data.deviceId)}</h2></div><dl><div><dt>固件版本</dt><dd>${e(data.fwVersion)}</dd></div><div><dt>协议版本</dt><dd>${e(device.handshake.protocolVersion)}</dd></div><div><dt>配置版本</dt><dd>${data.configRevision ? 'R' + data.configRevision : '尚未配置'}</dd></div><div><dt>运行模式</dt><dd>${e(modes[data.mode])} · ${e(data.mode)}</dd></div><div><dt>植物配置</dt><dd>${e(data.plant || '尚未配置')}</dd></div><div><dt>认证方式</dt><dd>${device.handshake.authProfile==='hmac-sha256-v1'?'设备密钥认证与消息校验':'开发认证'} · ${e({owner:'所有者',operator:'操作员',viewer:'只读'}[role]||role)}</dd></div><div><dt>自动浇水</dt><dd>${data.automaticWatering === true ? '前置条件已就绪' : '等待设备标定与运行前置'}</dd></div><div><dt>上次校时</dt><dd>${e(data.lastSyncAt?timestamp(data.lastSyncAt,data.sample?.bootCount):'尚未校时')}</dd></div><div><dt>最近读取</dt><dd>${e(age(device.lastRead))}前</dd></div></dl></section>
    <section class="settings-section device-controls"><h2>设备操作</h2><div class="settings-group">
     ${device.handshake.capabilities?.includes('time-sync')?`<div class="field-row"><div class="field-label">设备时间</div>${button('校准设备时间','sync-time',{type:'outline',disabled:device.busy||!canControl})}</div>`:''}
     ${device.handshake.capabilities?.includes('quick-check')?`<div class="field-row"><div class="field-label">传感器检查</div><div class="inline-control"><select id="stimulated-sensor" aria-label="主动改变的传感器" ${device.busy||!canControl?'disabled':''}><option value="">常规三轮检查</option>${Object.entries(channelNames).map(([key,label])=>`<option value="${key}">${e(label)}受刺激检查</option>`).join('')}</select>${button('开始检查','quick-check',{type:'outline',disabled:device.busy||!canControl})}</div></div><p class="caption muted">受刺激检查会比较随后三次读数。点击后立即改变所选传感器的实际输入；未改变输入时请选择常规检查。</p>`:''}
    ${device.handshake.capabilities?.includes('emergency-stop')?`<div class="field-row"><div class="field-label">停止浇水</div>${button('立即停泵','stop-watering',{type:'danger',disabled:device.stopping})}</div>`:''}
    <div class="field-row"><div class="field-label">当前模式</div><strong data-current-mode>${e(modes[data.mode])}</strong></div>
     <div class="field-row"><div class="field-label"><label for="target-mode">切换模式</label></div><div class="inline-control"><select id="target-mode" aria-label="目标模式" ${device.busy||!canControl ? 'disabled' : ''}>${Object.entries(modes).filter(([value])=>supportedModes.includes(value)).map(([value,label])=>`<option value="${e(value)}" ${value===data.mode?'selected':''}>${e(label)}</option>`).join('')}</select>${button('应用','mode',{type:'outline',disabled:device.busy||!canControl})}</div></div>
    <div class="field-row"><div class="field-label">设备中的配置</div>${button('从设备读取','device-download',{type:'outline',symbol:'download',disabled:device.busy})}</div>
     <div class="field-row"><div class="field-label">重新启动设备</div>${button('重启','restart',{type:'outline',disabled:device.busy||!canControl})}</div>
     <div class="field-row"><div class="field-label">恢复出厂设置</div>${button('恢复出厂','factory-reset',{type:'danger',disabled:device.busy||!canManage})}</div>
    </div><p class="caption muted">读取后的配置会在“个性化库编译”页面预览；新生成配置的发送按钮保留在该页面</p></section>
    ${data.prepareSummary?`<p class="caption muted">准备期有效样本 ${e(data.prepareSummary.validSamples??0)} / ${e(data.prepareSummary.totalSamples??0)} · 平均温度 ${e(data.prepareSummary.temperatureC??'—')} °C · 平均空气湿度 ${e(data.prepareSummary.humidityPct??'—')}%</p>`:''}
     ${data.prepareSummary?.channels?`<details class="caption muted"><summary>查看准备期各通道统计与基准</summary><div class="table-scroll"><table><thead><tr><th>通道</th><th>有效 / 失败</th><th>均值</th><th>最小 / 最大</th><th>最大单次变化</th><th>基准</th></tr></thead><tbody>${Object.entries(data.prepareSummary.channels).map(([key,item])=>`<tr><td>${e(channelNames[key]||key)}</td><td>${e(item.validSamples??0)} / ${e(item.failedSamples??0)}</td><td>${e(item.mean??'—')}</td><td>${e(item.min??'—')} / ${e(item.max??'—')}</td><td>${e(item.largestStep??'—')}</td><td>${e(data.prepareSummary.baseline?.[key]??'—')}</td></tr>`).join('')}</tbody></table></div></details>`:''}
    ${data.quickCheck?`<p class="caption muted">快速检查：有效样本 ${e(data.quickCheck.validSamples??0)} / 3，剩余 ${e(data.quickCheck.remainingSamples??0)} 次${data.quickCheck.stimulatedSensorKey?` · 受刺激通道 ${e(channelNames[data.quickCheck.stimulatedSensorKey]||data.quickCheck.stimulatedSensorKey)}`:''}</p>`:''}
    <div class="section-heading"><h2>当前采样</h2><span class="caption muted">${sample ? `${e(timestamp(sample.sampledAt,sample.bootCount))}${sample.sampleSeq!=null?` · 采样序号 ${e(sample.sampleSeq)}`:''}${sample.sampledAt?` · 采样距今 ${e(age(sample.sampledAt))}`:''}` : '暂无采样'} · 页面可见时每 10 秒读取状态</span></div>
    ${sample ? `<div class="sensor-grid">${metric('空气温度',sample.temperatureC,'°C')}${metric('空气湿度',sample.humidityPct,'%')}${metric('土壤 ADC',sample.soilAdc)}${metric('雨量 ADC',sample.rainAdc)}${sample.solarVoltageV!==undefined?metric('太阳能输入',sample.solarVoltageV,'V'):''}${metric('浇水需求值',sample.wateringDemand,'/100')}</div>${qualitySummary(sample)?notice(e(qualitySummary(sample)),'warning'):''}` : notice(configurationOnly ? '这版固件不采集传感器数据，当前采样和历史记录为空' : '设备尚未提供有效采样；等待下次采样后刷新')}
    <p class="caption muted">ADC 为原始读数；土壤传感器尚需实测标定，不转换为未经标定的湿度百分比</p>
    <section class="chart-section"><div class="section-heading"><h2>浇水需求趋势</h2><span class="legend"><i></i>本次连接的采样</span></div><canvas id="demand-chart" class="chart" role="img" aria-label="本次连接期间的浇水需求值趋势，当前数值见上方数据区"></canvas><p class="caption muted">本图仅保留当前页面的数据，不上传后端；阈值以设备实际配置为准</p></section>
    ${eventSection}
    <section class="history-section"><div class="section-heading"><div><h2>近期数据查看</h2><p class="small muted">从设备分批读取最近一周记录</p></div>${button(state.historyOpen ? '重新读取' : '读取最近一周','history',{type:'outline',symbol:'download',disabled:device.busy})}</div>
    ${state.historyLoading ? '<p role="status">正在从设备分批读取历史记录…</p>' : ''}
    ${state.historyOpen && !state.historyLoading ? `<div class="history-summary"><span>共 ${records.length} 条记录</span><span>浇水 ${records.filter(r=>r.watered).length} 次记录</span><span>降雨 ${records.filter(r=>r.rainDetected).length} 次记录</span></div>
    ${rows.length ? `<div class="table-scroll"><table><thead><tr><th>采样时间 / 唤醒</th><th>温度</th><th>空气湿度</th><th>土壤 ADC</th><th>雨量 ADC</th><th>需求值</th><th>事件</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${e(timestamp(row.sampledAt,row.bootCount))}</td><td>${e(row.temperatureC ?? '—')} °C</td><td>${e(row.humidityPct ?? '—')}%</td><td>${e(row.soilAdc ?? '—')}</td><td>${e(row.rainAdc ?? '—')}</td><td>${e(row.wateringDemand ?? '—')}</td><td>${row.rainDetected ? '检测到降雨' : row.watered ? '已执行浇水' : '常规采样'}</td></tr>`).join('')}</tbody></table></div>
    <div class="pagination"><span>第 ${page+1} / ${Math.max(1,Math.ceil(records.length/12))} 页</span><div class="actions">${button('上一页','history-prev',{type:'outline',disabled:page===0})}${button('下一页','history-next',{type:'outline',disabled:(page+1)*12>=records.length})}</div></div>` : '<div class="empty-state compact"><p>设备最近一周暂无历史记录</p></div>'}` : !state.historyLoading ? '<div class="empty-state compact"><p>按需读取历史，不持续占用蓝牙链路</p></div>' : ''}</section>`;
}
