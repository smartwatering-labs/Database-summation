import { button, escape as e, pageTitle, notice, metric, icon } from '../ui.js';

const options = (items, selected) => items.map(([value, label]) => `<option value="${e(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${e(label)}</option>`).join('');
const field = (label, control, help = '') => `<div class="field-row"><div class="field-label">${label}${help ? `<span>${help}</span>` : ''}</div>${control}</div>`;
const select = (name, label, items, value) => `<select name="${name}" id="${name}" aria-label="${label}">${options(items, value)}</select>`;
const input = (name, label, value, min, max, step = '1') => `<input type="number" name="${name}" id="${name}" aria-label="${label}" value="${e(value)}" min="${min}" max="${max}" step="${step}" required>`;
export function countryMatches(state) {
  const q=state.place.countryText.trim().toLocaleLowerCase();
  return state.place.countries.filter(item=>!q||[item.name,item.englishName,item.countryCode].some(value=>value.toLocaleLowerCase().startsWith(q)))
    .sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}
export function countryOptions(state) {
  const p=state.place,items=countryMatches(state);
  if(p.countriesLoading)return '<div class="country-empty" role="status">正在加载外部国家列表…</div>';
  if(p.countryError)return '<div class="country-empty">国家列表加载失败，请点击下方重新加载</div>';
  return items.length?items.map((item,index)=>`<button type="button" role="option" id="country-option-${index}" aria-selected="${p.active===index}" data-action="choose-country" data-code="${e(item.id)}">${e(item.name)}<span>${e(item.englishName)}</span></button>`).join(''):'<div class="country-empty">没有匹配的国家，请尝试中文名称或英文名称</div>';
}
function locationPanel(state) {
  const scene=state.scene,location=state.selectedLocation,p=state.place;
  const seasons={spring:'春季',summer:'夏季',autumn:'秋季',winter:'冬季'};
  const citySelect=field('<label for="place-city">城市</label>',`<select id="place-city" aria-label="城市" data-unavailable="${state.locationLoading||!p.cities.length}"><option value="" disabled ${!p.city?'selected':''}>${state.locationLoading?'正在加载城市…':p.cities.length?'请选择城市':'请先选择省份'}</option>${options(p.cities.map(x=>[x.id,x.name]),p.city?.id)}</select>`);
  return `<section class="settings-section"><h2>植物与地点</h2><div class="settings-group">
  ${field('<label for="plantId">植物</label>',select('plantId','植物',state.plants.items.map(x=>[x.id,x.name+' · '+x.category]),scene.plantId))}
  <div class="field-row vertical country-field"><label for="country-search">国家 / 地区</label><input id="country-search" role="combobox" aria-autocomplete="list" aria-expanded="${p.countryOpen}" aria-controls="country-options" ${p.active>=0?`aria-activedescendant="country-option-${p.active}"`:''} value="${e(p.countryText)}" maxlength="80" placeholder="输入国家名称，例如：中" autocomplete="off"><div id="country-options" class="country-options" role="listbox" aria-label="国家建议" ${p.countryOpen?'':'hidden'}>${countryOptions(state)}</div></div>
  <div id="place-dependent">${p.country?(p.country.id==='CN'?`${field('<label for="place-province">省份 / 直辖市</label>',`<select id="place-province" aria-label="省份 / 直辖市" data-unavailable="${!p.provinces.length}"><option value="" disabled ${!p.province?'selected':''}>${p.provinces.length?'请选择省份或直辖市':'正在加载省份…'}</option>${options(p.provinces.map(x=>[x.id,x.name]),p.province?.id)}</select>`)}${p.province?.terminal?'<p class="location-help">已选择直辖市或特别行政区，无需再选择城市</p>':citySelect}`:citySelect):''}</div></div>
  <div class="field-footnote">${button('重新加载地点列表','reload-locations',{type:'text',disabled:p.countriesLoading||state.generating,extra:'type="button"'})}</div>
  <p class="caption muted">中国按省份和城市选择，直辖市直接使用；其他国家提供主要城市，列表由外部接口加载，不保存到网站数据库</p>
  <div id="location-error">${state.locationError||p.countryError?notice(e(state.locationError||p.countryError),'error'):''}</div>
  <div id="location-confirmation">${state.locationLoading?'<p role="status">正在加载地点…</p>':location?`<div class="notice success"><div><strong>${e(location.displayName)}</strong><br>自动季节：${e(seasons[scene.season])}<br>纬度 ${e(location.latitude)}，经度 ${e(location.longitude)}</div></div>`:''}</div>
  <p class="caption muted">地点资料：<a href="https://github.com/mledoze/countries" target="_blank" rel="noreferrer">国家</a> · <a href="https://github.com/modood/Administrative-divisions-of-China" target="_blank" rel="noreferrer">中国省市</a> · DataV · <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> · <a href="https://github.com/donma/TaiwanAddressCityAreaRoadChineseEnglishJSON" target="_blank" rel="noreferrer">台湾县市</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>
  ${location?`<div class="field-footnote">${button('重新查询天气','environment',{type:'text',disabled:state.environmentLoading||state.generating,extra:'type="button"'})}</div>`:''}
  <div id="environment-panel">${environmentPanel(state)}</div></section>`;
}

export function configure(state, device) {
  const s = state.scene, locked = device.busy || state.generating || state.locationLoading || state.environmentLoading || !s.locationToken || !state.environment;
  return `${pageTitle('个性化库编译', '把种植场景转化为设备可用的初始配置')}
  <div class="configuration-layout"><div><form id="scenario-form" autocomplete="off">
  ${locationPanel(state)}
  <section class="settings-section"><h2>栽培环境</h2><div class="settings-group">
  ${field('<label for="cultivation">栽培方式</label>', select('cultivation', '栽培方式', [['pot','花盆种植'],['ground','地栽']], s.cultivation))}
  ${s.cultivation === 'pot' ? field('<label for="potLiters">花盆容积（L）</label>', input('potLiters','花盆容积',s.potLiters,0.5,200,'0.5'), '影响初始需水量估算') : ''}
  ${field('<label for="light">光照条件</label>', select('light', '光照条件', [['shade','遮阴 / 室内散射光'],['partial','半日照'],['full','全日照']], s.light))}
  </div></section>
  <section class="settings-section"><h2>水源与流量</h2><p class="caption muted">设备固定无人值守，首次运行前请完成实物校准</p><div class="settings-group">
  ${field('<label for="supplyVariant">供水装置</label>',select('supplyVariant','供水装置',[['builtin','自带水泵供水'],['valve','电磁阀控制用户水泵']],s.supplyVariant))}
  ${field('<label for="reservoirLiters">可用储水量（L）</label>', input('reservoirLiters','可用储水量',s.reservoirLiters,0.5,1000,'0.5'))}
  ${s.supplyVariant==='valve'?field('<label for="flowRateMlSec">用户水泵流量（mL/s）</label>',input('flowRateMlSec','用户水泵流量',s.flowRateMlSec??'',1,200,'0.1'),'填写用户水泵的实测流量'):field('自带水泵固定流量',`<strong>${e(state.settings.builtinFlowMlSec)} mL/s</strong>`,'由设备参数统一设定，无需填写')}
  <div class="field-row vertical"><label for="waterSource">水源描述</label><textarea id="waterSource" name="waterSource" rows="2" maxlength="200" required placeholder="例如：阳台 20 L 储水桶">${e(s.waterSource)}</textarea></div>
  </div></section>
  <div id="form-error" class="form-error" role="alert">${e(state.formError || '')}</div>
  <div class="generate-action"><button class="button primary" type="submit" ${locked ? 'disabled' : ''}>${state.generating ? '正在匹配环境并生成…' : state.result ? '重新生成配置' : '分析并生成配置'}${icon('arrow',17)}</button><span class="caption muted">由后端生成 · 不保存用户配置历史</span></div>
  </form></div><aside class="configuration-result" aria-label="配置预览" id="configuration-result">${resultPanel(state, device)}</aside></div>`;
}

export function environmentPanel(state) {
  if(state.environmentLoading)return '<p class="small muted" role="status">正在通过 API 查询天气…</p>';
  if(state.environmentError)return notice(e(state.environmentError),'error');
  const v=state.environment;if(!v)return '';
  return `<div class="environment-summary"><div class="section-heading"><strong>${e(v.provider)}</strong><span class="status-badge">外部 API 实时查询</span></div><div class="mini-grid">${metric('温度',v.temperatureC,'°C')}${metric('空气湿度',v.humidityPct,'%')}${metric('海拔',v.elevationM,'m')}${metric('日平均降水',v.precipitationMmDay,'mm')}${metric('日平均日照',v.sunshineHoursDay,'h')}</div><p class="caption muted">${e(v.period)}<br>观测：${e(v.observedAt)} · ${e(v.timezone)}<br>查询：${e(v.fetchedAt)}</p><a href="https://open-meteo.com/" target="_blank" rel="noreferrer" class="caption">天气：Open-Meteo（CC BY 4.0）</a></div>`;
}

export function resultPanel(state, device) {
  const result = state.result, config = result?.config;
  const imports = `<div class="config-file-actions">${button('导入 JSON', 'import', { type:'outline', symbol:'upload', disabled:state.generating || device.busy })}<input type="file" id="config-file" accept=".json,application/json" hidden>${config ? button('导出 JSON','export',{type:'outline',symbol:'download',disabled:device.busy}) : ''}</div>`;
  if (!config) return `<div class="result-empty"><span class="preview-icon">${icon('settings',28)}</span><h2>为这株植物<br>制定初始方案</h2><p>完成左侧场景，查看推荐参数、单轮水量和水箱续航</p><ol><li>匹配植物与环境</li><li>生成临时配置</li><li>预览后发送到设备</li></ol></div>${imports}<p class="caption muted">已有配置文件？也可以直接导入校验</p>`;
  const d = config.display || {}, p = config.params;
  const stage = state.writeResult || device.stage;
  const stages = { sending:'正在发送配置…', validating:'设备正在校验配置…', saved:'设备已确认写入成功', failed:'写入失败或结果未知，请核对设备配置' };
  return `<div class="result-heading"><span class="section-number">配置预览</span><span class="status-badge">R${config.revision}</span></div><h2>${e(config.plant)}</h2><p class="muted small">${e(config.locationName || '导入配置')} · ${config.source === 'api' ? '在线环境资料' : config.source === 'fallback' ? '静态环境降级' : '文件 / 设备配置'}</p>
  ${state.dirty ? notice('场景已修改，请重新生成后再发送','warning') : ''}
  <div class="result-metrics">${metric('估算单轮水量',d.roundWaterMl,'mL')}${metric('估算水箱续航',d.reservoirDays,'天')}${metric('日需水量参考',d.dailyWaterNeedMl,'mL')}</div>
  <dl class="parameter-list"><div><dt>需求触发阈值</dt><dd>${e(p.threshold)} / 100</dd></div><div><dt>脉冲次数</dt><dd>${e(p.pulseCount)} 次</dd></div><div><dt>单次开泵 / 间隔</dt><dd>${p.pulseOnMs / 1000}s / ${p.pulseOffMs / 1000}s</dd></div></dl>
  <details><summary>查看配置 JSON</summary><pre class="json-preview">${e(JSON.stringify(config,null,2))}</pre></details>
  ${(result.warnings || []).map(x => `<p class="caption result-warning">${e(x)}</p>`).join('')}
  ${stage ? `<div class="write-status ${stage === 'failed' ? 'error' : stage === 'saved' ? 'success' : ''}" role="status">${e(stages[stage] || stage)}</div>` : ''}
  <div class="write-flow"><span>生成</span><span>发送</span><span>设备校验</span><span>确认写入</span></div>
  ${button(device.demo ? '发送到模拟设备' : '发送到设备', 'upload', {type:'primary wide',symbol:'bluetooth',disabled:device.state !== 'ready' || device.busy || state.dirty || state.generating})}
  ${device.state !== 'ready' ? '<p class="caption muted">请先连接设备并完成握手；也可先导出文件</p>' : ''}${imports}<p class="caption muted">配置格式 ${e(config.configVersion)} · 协议 ${e(config.protocolVersion || '1.0')}<br>关闭或刷新页面将清除本次配置</p>`;
}
