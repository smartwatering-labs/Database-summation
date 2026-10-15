# 产品质感与展示页优化 · 2026-10-12

按用户后续要求，之前的项目快照、恢复脚本及快照忽略条目已删除。继续修改当前项目，没有另建留档；本文是当前实现和验证记录。

## 原因与实施

项目使用 Flask、原生 JS、Three.js r180、本地 GLB，无需重建前端。模型已有圆角、支脚、接缝、开口、四个装配、25 个网格和 648 个 CAD 实体。第一轮仍存在外壳反射偏平、CSS 投影缺少几何关系、桌面标题与信息区疏离的问题。此次增加真正的面光源和地面阴影，修正构图；继续保留原模型几何、法线及装配偏移。

| 文件 | 当前作用 |
| --- | --- |
| static/js/product-studio.js | 集中外壳/PCB/元器件材质、反射光板、三盏面光源、阴影、曝光与像素比参数 |
| static/js/model-stage.js | sRGB、NeutralToneMapping、PMREM 环境、RectAreaLight、VSM 和真实地面；取景避让文字/信息区；释放光照纹理和阴影资源 |
| static/assets/models/model.json | 首页三分之四角度、产品四层取景、窄屏阴影边距；装配偏移沿用原值 |
| static/vendor/three/addons/lights/ | 两个匹配 r180 的官方面光源辅助模块，本地加载 |
| static/css/theme-minimal.css | 标题层级、按钮、列表边框/阴影、恢复桌面首页原有位置与优化手机留白 |
| static/css/industrial.css、templates/index.html | 移除 CSS 地面椭圆及对应 DOM |
| tests/shell-fade.test.cjs | 将 WebGL 渐显观察限定于 PBR 材质，排除透明地面和阴影处理通道 |
| tools/capture-product.cjs | 浏览器截图、场景诊断、错误/请求/横向溢出检查 |
| README.md、docs/model-presentation.md | 更新当前运行方案、布局及验证说明 |

## 材质、灯光与构图

外壳使用微暖白 #F3F2EF，metalness 0、roughness 0.36、IOR 1.48、specularIntensity 1、clearcoat 0.015；细微纹理仅调节粗糙度，不使用外壳 bumpMap。上下壳保持同种基础材质，面光高光与明暗变化呈现原有圆角和侧壁。PCB 采用蓝色阻焊层，降低清漆和镜面贡献，保留丝印、金属引脚、焊锡和黑色封装之间的对比。

前上方宽面主光、较弱侧面补光、后侧条形轮廓光均为 RectAreaLight；柔边反射光板由本地程序生成并 PMREM 预滤波。曝光 0.95、最大像素比 1.5。单独的低强度方向光生成 1536px、10 次模糊采样的 VSM 阴影，外壳及内部组件均投射和接收阴影，采用 FrontSide 与 normalBias 减轻 CAD 背面条纹。

ShadowMaterial 平面位于底壳支脚实际最低点下方，随底壳移动，取代 CSS 椭圆投影。首页地面透明度 0.13、产品页 0.09，转场开始时 120ms 淡出，模型到位后 240ms 淡入，功能页最终不显示。第一版阴影过重、PCB 反光偏亮，经截图检查后降低并柔化。

相机保留正交投影。首页约 16° 俯角、25° 方位角，桌面模型宽度上限约 64%，按后续反馈恢复桌面中心 [0.54,0.48]；标题与按钮恢复原绝对定位，距展示区底部 88px。取消右侧辅助按钮的整行高度避让，以免模型被推高。产品页保持四层方向、大小和装配关系，桌面高度上限 91%；窄屏宽度上限 86%，为阴影留边。

手机首页正文前占位 280px；产品画布至少 680px，正文前占位按宽度在 480–660px 间变化，减少原固定占位的空白。手机最低渲染缓冲高度 680px，减轻小屏细节拉伸。768–1199px 产品展示区仍至少 1040px。样式保持白色背景和蓝色强调色，统一按钮 44px 高度、列表 18px 圆角，降低辅助边框、箭头和阴影权重。模拟连接仍明确标注为模拟，截图初始状态为“未连接”。

## 后续问题修复

配置页正俯视的视线与主板法线完全平行，r180 面光源 LTC 算法生成零长度切向量，导致模型初始偏灰、拖动后亮度突变。已在模型材质 onBeforeCompile 中为此情况提供稳定垂直基向量，保持真正的正俯视，不修改 Three.js vendor 文件。新增 preview-lighting.test.cjs 验证真实截图色值：未修复时，半像素拖动令主板平均蓝通道从约 99 跳到 123；修复后从约 122.62 到 122.56，Home 归位与再次打开预览也稳定。隔离的未修复代码复现检查失败，修复代码通过。

首页模型、标题和两个按钮的位置已按本轮用户反馈恢复。最新 14 张截图位于 prototype/test-results/product-studio/restored-home/，光照截图与色值位于 prototype/test-results/preview-lighting/。

## 新资源与许可

沿用 Three.js r180，新增两个官方辅助文件，共约 316 KB 源码；没有新增 npm 依赖、HDRI、模型、图片或在线字体。两处裸 three 导入改成相对本地路径，适配原生模块与 CSP。许可沿用 static/vendor/three/LICENSE 中的 MIT；运行时资源全部来自本地 Flask 静态目录。

- [r180 RectAreaLightUniformsLib 原文件](https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/jsm/lights/RectAreaLightUniformsLib.js)
- [r180 RectAreaLightTexturesLib 原文件](https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/jsm/lights/RectAreaLightTexturesLib.js)
- [面光源示例](https://threejs.org/examples/webgl_lights_rectarealight.html)、[VSM 示例](https://threejs.org/examples/webgl_shadowmap_vsm.html)、[物理材质文档](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)

没有导入 Blender 工程材质或 Fusion 外观库，参考概念后按 WebGL PBR 配置。此次继续修改中没有重建 GLB 或添加结构元件。

## 实际验证

通过 tests/serve_ui_fixture.py 启动本机 127.0.0.1:5001，使用真实 Flask 配置生成逻辑、确定性天气/地点响应、独立临时数据库和明确的模拟 BLE。浏览器为本机 Edge 无头模式。GPU 标识、到达稳定页面的耗时和场景诊断见截图验证 JSON；不能据此推断真实手机性能。

首页和产品页最终截图：320×740、390×844、768×900、1024×768、1440×900、1440×1000、1920×1080，共 14 张。查看实际截图后，修正投影、反光、标题关系、窄屏边距与手机展示区。桌面/平板保存真实视口，手机保存整页。

检查项：

- model-asset：四个装配、648 个实体归属、有限法线/坐标、有效索引、盖子 0.0200 源单位装配间隙。
- model-preview：实际渲染边界、四层间距、占比、侧栏/文字避让、320–1440px 无裁切、缩放/双指/归位、早期预览和减少动画。
- information-list：三行首页/四行产品列表、七个详情、工程图加载、焦点返回、入口及 320–1920px 排版。
- shell-fade：实际 WebGL 绘制的中间透明度连续，PBR 外壳深度写入稳定。
- shadow-transition：地面阴影实际 WebGL 绘制透明度平滑淡入/淡出，快速切页保留当前透明度，首页/产品页最终强度与减少动画模式正确；截图和逐帧记录位于 test-results/shadow-transition/。
- model-drag：两轴转台、反向/原路拖回、俯仰限制、无松手惯性、键盘及面板归位。
- workspace-motion：模型/内容同步、面板中断/收放、输入与滚动保留、键盘、响应式和减少动画。
- business-ui：配置生成/JSON 导入导出、模拟 BLE 写入/读回、模式/历史、恢复出厂取消及独立管理员流程。
- 最终截图：三盏面光源、地面接收阴影、外壳投射/接收阴影，无 JS/console 错误、资源请求失败或横向溢出。

截图和诊断位于 prototype/test-results/product-studio/final/；其余测试证据位于各自 test-results 子目录。

## 局限

这是实时 WebGL PBR。地面和外壳实际接收 VSM 阴影，但阴影由方向光近似，面光源本身不生成物理精确软阴影；没有路径追踪、屏幕空间环境遮蔽或新增重型后处理。塑料质感仍受现有 CAD 圆角细分、法线和缺少实物参考的约束，不能代替注塑表面/制造公差检查。更精细的分型线、倒角曲率和印字需核对源 CAD 后重新导出。

未运行完整后端回归、真实硬件 BLE 联调或实机手机 GPU 帧率测试。自动测试与截图支持上述页面和交互结论，不等同于实物摄影或所有设备的性能保证。
