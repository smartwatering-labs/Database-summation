import { icon } from '../ui.js';
import { enclosureInformation, principleInformation, hardwareInformation, workflowInformation, guideInformation } from '../product-information.js';
export function product() {
  return `<div class="product-copy-source"><h2>每一次浇水<br><span class="muted">都有它的依据</span></h2><p class="hero-description">从外壳到内部，了解它如何照料植物。</p></div>
  <section data-detail-section="enclosure" data-label="外壳结构" data-summary="顶盖与底壳，容纳双层硬件">${enclosureInformation}</section>
  <section data-detail-section="hardware" data-label="硬件组成" data-summary="上板采集与控制，下板供电与驱动">${hardwareInformation}</section>
  <section data-detail-section="principle" data-label="工作原理" data-summary="感知、判断、浇水，再进入休眠">${principleInformation}<p class="detail-footnote">3.6.0 已接入采样、准备期、脉冲和休眠代码。设备完成标定、配置、校时和现场验收后进入长期运行，当前状态由连接结果显示。</p><h3 class="detail-subheading">运行流程与模式</h3>${workflowInformation}</section>
  <section data-detail-section="guide" data-label="使用方式" data-summary="实物标定、蓝牙配置、独立运行">${guideInformation}</section>
  <div class="actions content-section"><a class="button primary" href="#configure">创建适合你的配置 ${icon('arrow',17)}</a><a class="button secondary" href="#device">查看硬件情况</a></div>`;
}
