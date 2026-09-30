import { pageTitle, icon, notice } from '../ui.js';
export function product() {
  return `${pageTitle('产品介绍', '一个以传感器为依据、在设备本地完成决策的浇水系统')}
  <section class="product-intro"><div><h2>植物的状态<br><span class="muted">是每次浇水的起点</span></h2><p>空气温湿度、土壤和雨量共同参与需求判断；设备在本地完成采样、判断与脉冲浇水，不依赖持续联网</p><p>网页负责帮助你理解设备、填写种植场景，并通过蓝牙送入初始配置</p></div><figure class="pcb-figure"><img src="/static/assets/pcb-front.png" alt="项目 PCB 正面走线与模块分区图" loading="lazy"><figcaption>项目资料 · PCB 正面参考图，非整机实物照片</figcaption></figure></section>
  <section class="content-section"><h2>从环境感知到节水执行</h2><ol class="workflow"><li><span>01</span><h3>感知</h3><p>采集空气温湿度、土壤 ADC 和雨量 ADC</p></li><li><span>02</span><h3>判断</h3><p>计算 0–100 的需求值，下雨或土壤数据无效时停止自动浇水</p></li><li><span>03</span><h3>执行</h3><p>满足需求阈值和季节间隔后，按配置分次开泵</p></li><li><span>04</span><h3>休眠</h3><p>长期模式完成工作后休眠，默认每 2 小时唤醒一次</p></li></ol></section>
  <section class="content-section"><h2>三种运行模式</h2><div class="mode-explanations"><article><span class="mono">DISPLAY</span><h3>展示 / 调试</h3><p>用于观察传感器与调试；文档描述默认约每 2 秒采样，实际行为以当前固件为准</p></article><article><span class="mono">PREPARE</span><h3>准备 / 校准</h3><p>正式长期运行前采集环境与土壤基准，文档中的准备窗口约为 10 分钟</p></article><article><span class="mono">LONGRUN</span><h3>长期运行</h3><p>周期唤醒、采样、判断和必要浇水，随后进入深度休眠</p></article></div></section>
  <section class="content-section"><h2>第一次使用</h2><div class="guide-rows"><p><strong>01 / 确认硬件与供电</strong><span>完成传感器接线、土壤标定、水泵流量与继电器触发电平核对</span></p><p><strong>02 / 唤醒并连接蓝牙</strong><span>按外置按钮唤醒，通过支持 Web Bluetooth 的浏览器连接</span></p><p><strong>03 / 生成初始配置</strong><span>选择植物、地点、光照和栽培方式，检查推荐说明后下发</span></p><p><strong>04 / 先校准，再长期运行</strong><span>先使用 PREPARE；确认实际出水与土壤状态正常后再启用 LONGRUN</span></p></div></section>
  ${notice('当前资料尚未确认继电器电平、土壤 ADC 标定和实际水泵流量；网页建议不能替代实物标定，界面也不会把土壤 ADC 直接转换成未经标定的湿度百分比', 'warning')}
  <div class="actions content-section"><a class="button primary" href="#configure">创建适合你的配置 ${icon('arrow',17)}</a><a class="button secondary" href="#device">查看硬件情况</a></div>`;
}
