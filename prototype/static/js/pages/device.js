import { button, escape as e, pageTitle, notice, metric, modes, timestamp, icon } from '../ui.js';

export function devicePage(state, device) {
  const ready = device.state === 'ready';
  if (!ready) return `${pageTitle('硬件情况查看', '连接并完成握手后，查看设备当前状态与最近一周采样')}
    <section class="empty-state device-empty"><span class="preview-icon">${icon('bluetooth',36)}</span><h2>${device.busy ? '正在连接设备' : '等待连接浇水设备'}</h2><p>${e(device.error || '尚未取得设备数据；请先按外置按钮唤醒设备，再连接蓝牙')}</p><div class="actions">${button('连接设备','connect',{type:'primary',disabled:device.busy})}${state.settings.demoEnabled ? button('体验模拟设备','demo',{type:'outline',disabled:device.busy}) : ''}</div></section>
    ${notice('深度休眠时无法由网页远程唤醒；设备休眠或重启后，需要重新连接和握手')}`;
  const data = device.status, sample = data.sample;
  const configurationOnly = device.handshake.runtimeProfile === 'configuration-oled';
  const supportedModes = device.handshake.supportedModes || Object.keys(modes);
  const records = device.history, page = Math.min(state.historyPage || 0, Math.max(0, Math.ceil(records.length / 12) - 1));
  const rows = [...records].reverse().slice(page * 12, page * 12 + 12);
  return `${pageTitle('硬件情况查看',configurationOnly ? '查看蓝牙连接、配置版本与设备保存结果' : '最新采样来自设备；长期模式默认每 2 小时唤醒一次',button('刷新数据','refresh',{type:'outline',symbol:'refresh',disabled:device.busy}) + button('断开连接','disconnect',{type:'secondary',disabled:device.busy}))}
    ${configurationOnly ? notice('当前固件支持蓝牙配置收发、断电保存和 OLED 状态显示；尚未接入传感器采样及自动浇水，DISPLAY / PREPARE 均保持蓝牙在线') : ''}
    ${device.demo ? notice('<strong>模拟设备已连接</strong> 此页所有设备读数均为演示数据，不代表真实硬件','warning') : ''}
    ${state.deviceError ? notice(e(state.deviceError),'warning') : ''}
    <section class="device-identity"><div><span class="caption muted">设备 ID</span><h2>${e(data.deviceId)}</h2></div><dl><div><dt>固件版本</dt><dd>${e(data.fwVersion)}</dd></div><div><dt>协议版本</dt><dd>${e(device.handshake.protocolVersion)}</dd></div><div><dt>配置版本</dt><dd>${data.configRevision ? 'R' + data.configRevision : '尚未配置'}</dd></div><div><dt>运行模式</dt><dd>${e(modes[data.mode])} · ${e(data.mode)}</dd></div><div><dt>植物配置</dt><dd>${e(data.plant || '尚未配置')}</dd></div></dl></section>
    <section class="settings-section device-controls"><h2>设备操作</h2><div class="settings-group">
    <div class="field-row"><div class="field-label">当前模式</div><strong>${e(modes[data.mode])}</strong></div>
    <div class="field-row"><div class="field-label"><label for="target-mode">切换模式</label></div><div class="inline-control"><select id="target-mode" aria-label="目标模式" ${device.busy ? 'disabled' : ''}>${Object.entries(modes).filter(([value])=>supportedModes.includes(value)).map(([value,label])=>`<option value="${e(value)}" ${value===data.mode?'selected':''}>${e(label)}</option>`).join('')}</select>${button('应用','mode',{type:'outline',disabled:device.busy})}</div></div>
    <div class="field-row"><div class="field-label">设备中的配置</div>${button('从设备读取','device-download',{type:'outline',symbol:'download',disabled:device.busy})}</div>
    <div class="field-row"><div class="field-label">重新启动设备</div>${button('重启','restart',{type:'outline',disabled:device.busy})}</div>
    <div class="field-row"><div class="field-label">恢复出厂设置</div>${button('恢复出厂','factory-reset',{type:'danger',disabled:device.busy})}</div>
    </div><p class="caption muted">读取后的配置会在“个性化库编译”页面预览；新生成配置的发送按钮保留在该页面</p></section>
    <div class="section-heading"><h2>当前采样</h2><span class="caption muted">${sample ? e(timestamp(sample.sampledAt)) : '暂无采样'} · 页面可见时每 10 秒读取</span></div>
    ${sample ? `<div class="sensor-grid">${metric('空气温度',sample.temperatureC,'°C')}${metric('空气湿度',sample.humidityPct,'%')}${metric('土壤 ADC',sample.soilAdc)}${metric('雨量 ADC',sample.rainAdc)}${metric('浇水需求值',sample.wateringDemand,'/100')}</div>` : notice(configurationOnly ? '这版固件不采集传感器数据，当前采样和历史记录为空' : '设备尚未提供有效采样；等待下次采样后刷新')}
    <p class="caption muted">ADC 为原始读数；土壤传感器尚需实测标定，不转换为未经标定的湿度百分比</p>
    <section class="chart-section"><div class="section-heading"><h2>浇水需求趋势</h2><span class="legend"><i></i>本次连接的采样</span></div><canvas id="demand-chart" class="chart" role="img" aria-label="本次连接期间的浇水需求值趋势，当前数值见上方数据区"></canvas><p class="caption muted">本图仅保留当前页面的数据，不上传后端；阈值以设备实际配置为准</p></section>
    <section class="history-section"><div class="section-heading"><div><h2>近期数据查看</h2><p class="small muted">从设备分批读取最近一周记录</p></div>${button(state.historyOpen ? '重新读取' : '读取最近一周','history',{type:'outline',symbol:'download',disabled:device.busy})}</div>
    ${state.historyLoading ? '<p role="status">正在从设备分批读取历史记录…</p>' : ''}
    ${state.historyOpen && !state.historyLoading ? `<div class="history-summary"><span>共 ${records.length} 条记录</span><span>浇水 ${records.filter(r=>r.watered).length} 次记录</span><span>降雨 ${records.filter(r=>r.rainDetected).length} 次记录</span></div>
    ${rows.length ? `<div class="table-scroll"><table><thead><tr><th>采样时间 / 唤醒</th><th>温度</th><th>空气湿度</th><th>土壤 ADC</th><th>雨量 ADC</th><th>需求值</th><th>事件</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${e(timestamp(row.sampledAt,row.bootCount))}</td><td>${e(row.temperatureC ?? '—')} °C</td><td>${e(row.humidityPct ?? '—')}%</td><td>${e(row.soilAdc ?? '—')}</td><td>${e(row.rainAdc ?? '—')}</td><td>${e(row.wateringDemand ?? '—')}</td><td>${row.rainDetected ? '检测到降雨' : row.watered ? '已执行浇水' : '常规采样'}</td></tr>`).join('')}</tbody></table></div>
    <div class="pagination"><span>第 ${page+1} / ${Math.max(1,Math.ceil(records.length/12))} 页</span><div class="actions">${button('上一页','history-prev',{type:'outline',disabled:page===0})}${button('下一页','history-next',{type:'outline',disabled:(page+1)*12>=records.length})}</div></div>` : '<div class="empty-state compact"><p>设备最近一周暂无历史记录</p></div>'}` : !state.historyLoading ? '<div class="empty-state compact"><p>按需读取历史，不持续占用蓝牙链路</p></div>' : ''}</section>`;
}
