import { button, icon, notice } from '../ui.js';

export function home(state, device) {
  const connected = device.state === 'ready';
  const compatible = globalThis.isSecureContext && !!navigator.bluetooth;
  return `<section class="home-heading"><div><h1>照料植物<br><span class="muted">从了解它开始</span></h1><p>连接你的浇水设备，定制适合植物的运行参数</p><div class="actions">${button(connected ? '查看设备状态' : '连接浇水设备', connected ? 'go-device' : 'connect', { type: 'primary', symbol: 'bluetooth', disabled: device.busy })}<a class="button secondary" href="#configure">生成个性化配置 ${icon('arrow', 17)}</a></div></div></section>
  <section class="hardware-display" aria-labelledby="hardware-heading"><div class="hardware-copy"><span class="mono small">SMART WATERING SYSTEM</span><h2 id="hardware-heading">感知环境<br>按需浇灌</h2><p>以 ESP32-C3 为核心，连接土壤、雨量与空气温湿度传感器</p><div class="hardware-facts"><span>BLE 连接</span><span>脉冲浇水</span><span>低功耗运行</span></div></div><figure><img src="/static/assets/controller.png" alt="项目资料中的 ESP32-C3 OLED 控制器及引脚参考图" width="548" height="548"><figcaption>项目控制器参考图 · 3D 模型待补充</figcaption></figure></section>
  <div class="home-notices">${notice('<strong>连接前，先唤醒设备：</strong>深度休眠时蓝牙不工作，网页无法远程唤醒；请先按设备外置按钮')}${notice(compatible ? '<strong>浏览器已提供蓝牙接口：</strong>连接仍需系统蓝牙、用户授权及匹配的固件服务' : '<strong>当前环境未提供 Web Bluetooth：</strong>请尝试支持的 Chrome / Edge 环境并使用 localhost 或 HTTPS；备用连接方案尚未确定', compatible ? 'info' : 'warning')}</div>
  <section class="quick-section"><div class="section-heading"><h2>你的工作区</h2></div><div class="quick-links"><a href="#product"><span class="section-number">01</span><h3>产品介绍 ${icon('arrow')}</h3><p>了解硬件、工作原理与运行模式</p></a><a href="#configure"><span class="section-number">02</span><h3>个性化库编译 ${icon('arrow')}</h3><p>填写种植场景，生成并管理配置</p></a><a href="#device"><span class="section-number">03</span><h3>硬件情况查看 ${icon('arrow')}</h3><p>连接后查看采样与最近一周数据</p></a></div></section>
  ${state.settings.demoEnabled ? `<div class="demo-entry"><div><strong>还没有设备？先体验完整流程</strong><p>使用浏览器内的模拟设备，体验配置、模式和历史记录；模拟数据不会写入真实硬件</p></div>${button('连接模拟设备', 'demo', { type: 'outline', disabled: device.busy || device.demo })}</div>` : ''}`;
}
