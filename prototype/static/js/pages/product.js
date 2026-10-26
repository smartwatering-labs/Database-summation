import { icon } from '../ui.js';
import { enclosureInformation, principleInformation, hardwareInformation, workflowInformation, guideInformation } from '../product-information.js';
export function product() {
  return `<div class="product-copy-source"><h1>设备设计<br><span class="muted">为什么值得信赖</span></h1><p class="hero-description">从里到外，对其设计进行了解</p></div>
  <section data-detail-section="enclosure" data-label="硬件结构" data-summary="外壳设计与内部功能设计">${enclosureInformation}</section>
  <section data-detail-section="hardware" data-label="工作原理" data-summary="机器的自动化依据与实现逻辑">${hardwareInformation}</section>
  <section data-detail-section="principle" data-label="情况需知" data-summary="机器为什么会报错，可能的归因是什么？">${principleInformation}<p class="detail-footnote">3.9.0 直接输出传感器读数，按固定板级参数和客制化配置运行；长期运行还需绑定配置、校时和可用存储，并受传感器异常保护。</p><h3 class="detail-subheading">运行流程与模式</h3>${workflowInformation}</section>
  <section data-detail-section="guide" data-label="使用流程" data-summary="使用设备具体流程">${guideInformation}</section>
  <div class="actions content-section"><a class="button primary" href="#configure">创建适合你的配置 ${icon('arrow',17)}</a><a class="button secondary" href="#device">查看硬件情况</a></div>`;
}
