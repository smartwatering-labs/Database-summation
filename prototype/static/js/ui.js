export function escape(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
export const modes = { DISPLAY: '展示 / 调试', PREPARE: '准备 / 采样', LONGRUN: '长期运行' };
export const connectionPhases = {
  restoring: ['正在恢复蓝牙连接', '正在查找本标签页上次连接且仍获授权的设备'],
  choosing: ['等待选择设备', '请在浏览器弹窗中点选 SWS-ESP32C3，再点击“配对”；显示“已配对”时也需要选中并确认'],
  connecting: ['正在建立蓝牙连接', '已选择设备，正在建立连接，请保持设备供电'],
  waiting: ['等待蓝牙连接完成', '系统里还有一次蓝牙请求没有结算完，网页会自动等待并继续；一直不完成时请在系统蓝牙设置中删除该设备的配对记录'],
  services: ['正在读取设备服务', '正在读取设备的蓝牙服务与通信通道'],
  notifications: ['正在启用设备通知', '正在建立设备回复通道，请完成系统出现的配对确认'],
  handshake: ['正在验证设备', '正在完成协议握手与设备认证'],
  status: ['正在读取设备状态', '收到设备状态后将显示操作面板'],
};
export function icon(name, size = 20) {
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
    device: '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 8h6M9 12h6M10 17h4M3 8h3M18 8h3M3 16h3M18 16h3"/>',
    leaf: '<path d="M20 3C6 2 1 10 6 17c7 5 15 0 14-14ZM5 20l9-10"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    bluetooth: '<path d="m6 6 12 12-6 4V2l6 4L6 18"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
}
export function button(label, action, { type = 'secondary', disabled = false, symbol = '', extra = '' } = {}) {
  return `<button class="button ${type}" data-action="${action}" ${disabled ? 'disabled' : ''} ${extra}>${symbol ? icon(symbol, 17) : ''}${escape(label)}</button>`;
}
export function pageTitle(title, description, actions = '') { return `<header class="page-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="actions">${actions}</div></header>`; }
export function notice(message, kind = 'info') { return `<div class="notice ${kind}">${icon('info', 18)}<div>${message}</div></div>`; }
export function metric(label, value, unit = '') { return `<div class="metric"><span>${escape(label)}</span><strong>${escape(value ?? '—')}<small>${escape(unit)}</small></strong></div>`; }
export function timestamp(value, boot) {
  if (!value) return boot != null ? `未校时 · 第 ${boot} 次唤醒` : '设备未校时';
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? '时间不可用' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function drawChart(canvas, samples, threshold = 50) {
  if (!canvas) return;
  const width = canvas.clientWidth || 600, height = 220, scale = window.devicePixelRatio || 1;
  canvas.width = width * scale; canvas.height = height * scale;
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.clearRect(0, 0, width, height);
  const left = 34, right = width - 18, top = 14, bottom = height - 30;
  ctx.font = '11px system-ui'; ctx.lineWidth = 1;
  for (const value of [0, 25, 50, 75, 100]) {
    const y = bottom - (bottom - top) * value / 100;
    ctx.strokeStyle = '#eaeaea'; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillStyle = '#777'; ctx.fillText(value, 2, y + 4);
  }
  if (Number.isFinite(threshold)) {
    const y = bottom - (bottom - top) * threshold / 100;
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#a88757'; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.setLineDash([]);
  }
  const points = samples.filter(s => Number.isFinite(s.wateringDemand));
  if (!points.length) { ctx.fillStyle = '#666'; ctx.fillText('暂无有效需求值', left + 10, height / 2); return; }
  ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath();
  points.forEach((s, i) => { const x = left + (right - left) * i / Math.max(1, points.length - 1), y = bottom - (bottom - top) * s.wateringDemand / 100; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  const last = points.at(-1); ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(points.length === 1 ? left : right, bottom - (bottom - top) * last.wateringDemand / 100, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#777'; ctx.fillText('较早采样', left, height - 7); ctx.textAlign = 'right'; ctx.fillText('最新采样', right, height - 7); ctx.textAlign = 'left';
}
