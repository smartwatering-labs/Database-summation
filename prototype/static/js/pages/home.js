import { button, icon } from '../ui.js';
import { overview, connectionInformation, workspaceInformation } from '../product-information.js';

export function home(state, device) {
  const connected = device.state === 'ready';
  const compatible = globalThis.isSecureContext && !!navigator.bluetooth;
  return `<section class="home-heading"><div><h1>照料植物<br><span class="muted">从了解它开始</span></h1><p class="hero-description">根据植物与种植环境生成配置，<br>让设备在本地自主照料。</p><div class="actions">${button(connected ? '查看设备状态' : '连接浇水设备', connected ? 'go-device' : 'connect', { type:'primary', symbol:'bluetooth', disabled:device.busy })}<a class="button secondary" href="#configure">生成个性化配置 ${icon('arrow',17)}</a></div></div></section>
  <section data-detail-section="hardware" data-label="硬件组成" data-summary="双层主板，各司其职">${overview}<p class="detail-footnote">项目提供 3.6.0 整机固件，接入采样、配置保存、OLED 与自动控制。启用自动浇水前完成样板标定和验收；设备实际版本与能力以连接后的握手为准。</p></section>
  <section data-detail-section="connection" data-label="连接须知" data-summary="先唤醒，再通过蓝牙连接">${connectionInformation(compatible)}</section>
  <section data-detail-section="workspace" data-label="进入工作区" data-summary="了解产品、配置场景、查看设备">${workspaceInformation}</section>
  ${state.settings.demoEnabled ? `<div class="demo-entry">${button('连接模拟设备','demo',{type:'outline',disabled:device.busy||device.demo})}</div>`:''}`;
}
