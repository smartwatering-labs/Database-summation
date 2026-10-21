import { button, icon } from '../ui.js';
import { overview, connectionInformation, workspaceInformation } from '../product-information.js';

export function home(state, device) {
  const connected = device.state === 'ready';
  const compatible = globalThis.isSecureContext && !!navigator.bluetooth;
  return `<section class="home-heading"><div><h1>呵护植物<br><span class="muted">及人之所不能及</span></h1><p class="hero-description">客制化植物灌溉方案<br>为每一种植物提供独到环境</p><div class="actions">${button(connected ? '查看设备状态' : '连接浇水设备', connected ? 'go-device' : 'connect', { type:'primary', symbol:'bluetooth', disabled:device.busy })}<a class="button secondary" href="#configure">生成个性化配置 ${icon('arrow',17)}</a></div></div></section>
  <section data-detail-section="hardware" data-label="数据处理" data-summary="我们是怎么生成客制化方案的，你的数据上传后会怎么样">${overview}<p class="detail-footnote">项目提供 3.6.0 整机固件，接入采样、配置保存、OLED 与自动控制。启用自动浇水前完成样板标定和验收；设备实际版本与能力以连接后的握手为准。</p></section>
  <section data-detail-section="connection" data-label="编译须知" data-summary="在客制化时，设备如何进行通讯和编译">${connectionInformation(compatible)}</section>
  <section data-detail-section="workspace" data-label="报错处理" data-summary="不同的报错信号意味着什么？">${workspaceInformation}</section>
  ${state.settings.demoEnabled ? `<div class="demo-entry">${button('连接模拟设备','demo',{type:'outline',disabled:device.busy||device.demo})}</div>`:''}`;
}
