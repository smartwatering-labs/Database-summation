import { api } from './services/api.js';
import { escape as e, metric, notice, timestamp } from './ui.js';

const root = document.querySelector('#admin-root');
const state = { token: '', loading: false, error: '', data: null, selected: null };

function toast(message, error = false) {
  const node = document.querySelector('#toast');
  node.textContent = message; node.className = 'toast' + (error ? ' error' : ''); node.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, error ? 7000 : 3500);
}

function emptyPlant() { return { id:'', name:'', category:'', dailyMl:200, threshold:50, soilWeight:0.65, tempWeight:0.2, airWeight:0.15, tags:[],
  evidence:{title:'',reference:'',referenceDate:'',conditions:'',cultivar:'',growthStage:'',medium:'',numericBasis:''},
  review:{status:'engineering',reviewedAt:'',note:''},fieldValidation:{status:'untested',testedAt:'',conditions:'',summary:''},
  suitability:{context:'outdoor',temperatureMinC:null,temperatureMaxC:null,humidityMinPct:null,humidityMaxPct:null} }; }

function plantForm(plant = state.selected || emptyPlant()) {
  const input = (name, label, value, extra = '', required = true) => `<label>${label}<input name="${name}" value="${e(value ?? '')}" ${extra} ${required?'required':''}></label>`;
  const area = (name, label, value, max = 300) => `<label class="wide">${label}<textarea name="${name}" maxlength="${max}" rows="2">${e(value ?? '')}</textarea></label>`;
  const choice = (name, label, value, options) => `<label>${label}<select name="${name}">${options.map(([key,text])=>`<option value="${key}" ${key===value?'selected':''}>${text}</option>`).join('')}</select></label>`;
  const evidence=plant.evidence||emptyPlant().evidence, review=plant.review||emptyPlant().review, field=plant.fieldValidation||emptyPlant().fieldValidation, fit=plant.suitability||emptyPlant().suitability;
  return `<section class="content-section admin-library"><div class="section-heading"><div><span class="section-number">数据库唯一数据源</span><h2>植物配置</h2><p class="small muted">当前版本 ${e(state.data.plants.version)}；保存会创建数据库新版本</p></div><button class="button outline" data-action="new-plant">新增植物</button></div>
    <div class="admin-library-layout"><div class="plant-list">${state.data.plants.items.map(item => `<button class="plant-row ${plant.id===item.id?'selected':''}" data-action="select-plant" data-plant-id="${e(item.id)}"><strong>${e(item.name)}</strong><span>${e(item.category)} · ${e(item.id)} · ${e(({engineering:'工程建议',reviewed:'资料已核对',uncertain:'资料存疑',retired:'停用'})[item.review?.status]||'工程建议')}</span></button>`).join('')}</div>
    <form id="plant-form" class="plant-form">${input('id','标识 ID',plant.id,'pattern="[a-z0-9][a-z0-9-]{0,47}"')}${input('name','名称',plant.name)}${input('category','类别',plant.category)}${input('dailyMl','初始日需水量 mL',plant.dailyMl,'type="number" min="1" max="20000" step="1"')}${input('threshold','触发阈值',plant.threshold,'type="number" min="20" max="90" step="0.1"')}${input('soilWeight','土壤权重',plant.soilWeight,'type="number" min="0" max="1" step="0.01"')}${input('tempWeight','温度权重',plant.tempWeight,'type="number" min="0" max="1" step="0.01"')}${input('airWeight','空气权重',plant.airWeight,'type="number" min="0" max="1" step="0.01"')}${input('tags','标签，用逗号分隔',(plant.tags||[]).join(','),'',false)}
      <h3>资料来源与适用条件</h3>${input('evidenceTitle','来源标题',evidence.title,'maxlength="160"',false)}${input('evidenceReference','可定位引用或链接',evidence.reference,'maxlength="300"',false)}${input('evidenceReferenceDate','资料日期',evidence.referenceDate,'type="date"',false)}${input('evidenceCultivar','适用品种',evidence.cultivar,'maxlength="100"',false)}${input('evidenceGrowthStage','生长阶段',evidence.growthStage,'maxlength="100"',false)}${input('evidenceMedium','种植介质',evidence.medium,'maxlength="100"',false)}${area('evidenceConditions','资料使用条件',evidence.conditions)}${area('evidenceNumericBasis','数值依据',evidence.numericBasis,500)}
      <h3>资料审核</h3>${choice('reviewStatus','资料状态',review.status,[['engineering','工程建议，待核对'],['reviewed','资料已核对'],['uncertain','资料存疑'],['retired','停用']])}${input('reviewReviewedAt','核对日期',review.reviewedAt,'type="date"',false)}${area('reviewNote','审核说明',review.note)}
      <h3>已审核参考范围</h3><p class="wide small muted">可留空。填写上下限前先完成资料核对；网页仅以室外城市天气提供区域参考。</p>${choice('suitabilityContext','适用位置',fit.context,[['outdoor','室外'],['indoor','室内'],['greenhouse','温室']])}${input('temperatureMinC','温度下限 °C',fit.temperatureMinC,'type="number" min="-40" max="70" step="0.1"',false)}${input('temperatureMaxC','温度上限 °C',fit.temperatureMaxC,'type="number" min="-40" max="70" step="0.1"',false)}${input('humidityMinPct','空气湿度下限 %',fit.humidityMinPct,'type="number" min="0" max="100" step="0.1"',false)}${input('humidityMaxPct','空气湿度上限 %',fit.humidityMaxPct,'type="number" min="0" max="100" step="0.1"',false)}
      <h3>实物验证</h3>${choice('fieldStatus','验证状态',field.status,[['untested','尚未实测'],['calibrated','已校准'],['trial','已完成栽培试验']])}${input('fieldTestedAt','实测日期',field.testedAt,'type="date"',false)}${area('fieldConditions','实测条件',field.conditions)}${area('fieldSummary','结果摘要',field.summary,500)}
      ${input('source','本次修改说明','管理员维护','maxlength="100"')}<p class="form-error" role="alert">${e(state.error || '')}</p><button class="button primary" type="submit">保存植物配置</button></form></div></section>`;
}

function gitSection(git) {
  if (!git.available) return `<section class="content-section"><h2>Git 快照</h2>${notice('Git 接口当前不可用：' + e(git.reason), 'warning')}</section>`;
  return `<section class="content-section"><div class="section-heading"><div><h2>Git 快照</h2><p class="small muted">数据库为唯一数据源；Git 只保存管理员主动生成的植物库快照</p></div><span class="status-badge">HEAD ${e(git.head)}</span></div><p class="small muted">${git.changes.length ? '工作区变更：' + e(git.changes.join(' · ')) : '工作区无未提交变更'}</p><form id="git-form" class="inline-form"><input name="message" maxlength="120" value="更新植物库快照" aria-label="Git 提交说明" required><button class="button outline" type="submit">生成并提交快照</button></form></section>`;
}

function formulaSection(formulas) {
  return `<section class="content-section" id="formulas"><h2>当前计算公式</h2><p class="small muted">算法 ${e(formulas.version)} · 系数版本 ${e(formulas.weightsVersion)}</p><p class="small">${e(formulas.conventions)}</p><dl class="formula-list">${formulas.items.map(item=>`<div><dt><strong>${e(item.name)}</strong></dt><dd>${e(item.formula)}</dd></div>`).join('')}</dl><details><summary>查看当前系数</summary><pre class="json-preview">${e(JSON.stringify(formulas.coefficients,null,2))}</pre></details><p class="caption muted">${e(formulas.previousBehavior)}</p></section>`;
}
function dashboard() {
  const { health, stats, logs, git, formulas } = state.data;
  return `<header class="admin-topline"><a class="brand" href="/"><img src="/static/assets/icon.svg" alt="" width="28" height="28"><span>浇水<span class="brand-caption">管理端</span></span></a><button class="button outline" data-action="logout">退出</button></header>
  <div class="page-heading"><div><span class="section-number">仅管理端域名可访问</span><h1>系统监控</h1><p>服务运行、知识库版本和维护日志</p></div><div class="actions"><button class="button outline" data-action="refresh">刷新</button></div></div>
  ${state.error ? notice(e(state.error),'warning') : ''}<div class="service-status"><span class="status-dot online"></span><strong>服务运行正常</strong><span class="muted">数据库 ${e(health.database)} · 已运行 ${Math.floor(health.uptimeSeconds/60)} 分钟</span></div>
  <div class="admin-metrics">${metric('API 请求',stats.requests)}${metric('已生成配置',stats.generated)}${metric('错误响应',stats.errors)}${metric('平均耗时',stats.averageMs,'ms')}</div>
  <section class="content-section"><div class="section-heading"><h2>知识库与环境服务</h2><span class="small muted">${stats.plants} 种植物 · 地点由外部 API 查询</span></div><dl class="parameter-list">${Object.entries(health.libraryVersions).map(([name,value])=>`<div><dt>${e(({plants:'植物参数库',locations:'地点参考库',environment_weights:'环境权重库'})[name])}</dt><dd class="mono">${e(value)}</dd></div>`).join('')}<div><dt>外部天气服务</dt><dd>${health.weatherEnabled ? '已启用 · 失败停止生成' : '未启用 · 不能生成配置'}</dd></div></dl></section>
  ${formulaSection(formulas)}${plantForm()}${gitSection(git)}<section class="content-section"><h2>最近系统日志</h2><div class="table-scroll"><table><thead><tr><th>时间</th><th>级别</th><th>事件</th><th>说明</th></tr></thead><tbody>${logs.items.map(row=>`<tr><td>${e(timestamp(row.createdAt))}</td><td>${e(row.level)}</td><td class="mono">${e(row.event)}</td><td>${e(row.message)}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function render() {
  if (!state.data) {
    root.innerHTML = `<section class="admin-login"><span class="section-number">管理端</span><h1>管理员访问</h1><p class="muted">此页面仅用于服务监控和知识库维护</p><form id="login-form"><label>管理员密钥<input name="token" type="password" required maxlength="200" autocomplete="current-password"></label><p class="form-error" role="alert">${e(state.error)}</p><button class="button primary" type="submit" ${state.loading?'disabled':''}>${state.loading?'正在验证…':'进入管理端'}</button></form></section>`;
  } else root.innerHTML = dashboard();
}

async function load() {
  if (state.loading || !state.token) return;
  state.loading = true; state.error = ''; render();
  try {
    const [health, stats, logs, plants, git, formulas] = await Promise.all(['/api/admin/health','/api/admin/stats','/api/admin/logs','/api/admin/libraries/plants','/api/admin/git/status','/api/admin/formulas'].map(path=>api(path,{token:state.token})));
    state.data = { health, stats, logs, plants, git: git.git, formulas };
    if (!state.selected) state.selected = plants.items[0] || emptyPlant();
  } catch (error) { state.error = error.message; if (error.status === 403 || error.status === 404) { state.token = ''; state.data = null; } }
  finally { state.loading = false; render(); }
}

root.addEventListener('submit', async event => {
  event.preventDefault();
  if (event.target.id === 'login-form') { state.token = new FormData(event.target).get('token'); await load(); return; }
  try {
    if (event.target.matches('#plant-form')) {
      const data = Object.fromEntries(new FormData(event.target));
      const plant = { id:data.id,name:data.name,category:data.category,dailyMl:Number(data.dailyMl),threshold:Number(data.threshold),
        soilWeight:Number(data.soilWeight),tempWeight:Number(data.tempWeight),airWeight:Number(data.airWeight),tags:data.tags.split(',').map(tag=>tag.trim()).filter(Boolean),
        evidence:{title:data.evidenceTitle,reference:data.evidenceReference,referenceDate:data.evidenceReferenceDate,conditions:data.evidenceConditions,
          cultivar:data.evidenceCultivar,growthStage:data.evidenceGrowthStage,medium:data.evidenceMedium,numericBasis:data.evidenceNumericBasis},
        review:{status:data.reviewStatus,reviewedAt:data.reviewReviewedAt,note:data.reviewNote},
        fieldValidation:{status:data.fieldStatus,testedAt:data.fieldTestedAt,conditions:data.fieldConditions,summary:data.fieldSummary},
        suitability:{context:data.suitabilityContext,temperatureMinC:data.temperatureMinC===''?null:Number(data.temperatureMinC),
          temperatureMaxC:data.temperatureMaxC===''?null:Number(data.temperatureMaxC),humidityMinPct:data.humidityMinPct===''?null:Number(data.humidityMinPct),
          humidityMaxPct:data.humidityMaxPct===''?null:Number(data.humidityMaxPct)} };
      const result = await api('/api/admin/libraries/plants',{method:'PUT',token:state.token,body:{plant,source:data.source,expectedRevision:state.data.plants.revision}});
      state.data.plants = result; state.selected = result.items.find(item=>item.id===plant.id) || plant; state.error=''; toast('植物配置已保存到数据库'); render();
    } else if (event.target.id === 'git-form') {
      const result = await api('/api/admin/git/snapshot',{method:'POST',token:state.token,body:{message:new FormData(event.target).get('message')}});
      state.data.git=result.git; toast('已提交 Git 快照：' + result.snapshot); render();
    }
  } catch (error) { state.error=error.message; toast(error.message,true); render(); }
});

root.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  if (action === 'refresh') load();
  if (action === 'logout') { state.token='';state.data=null;state.selected=null;state.error='';render(); }
  if (action === 'new-plant') { state.selected=emptyPlant();render(); }
  if (action === 'select-plant') { state.selected=state.data.plants.items.find(item=>item.id===button.dataset.plantId);render(); }
});

render();
