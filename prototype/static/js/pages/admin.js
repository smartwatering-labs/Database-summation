import { button, pageTitle, notice, metric, escape as e, timestamp } from '../ui.js';
export function adminPage(state) {
  const admin = state.admin;
  if (!admin.data) return `${pageTitle('系统监控','用于检查配置生成服务、知识库和系统维护日志')}
    <form id="admin-form" class="admin-form" autocomplete="off"><h2>管理员访问</h2><p class="muted">密钥仅在当前页面内存中使用，不创建用户账户</p><label for="admin-token">管理员密钥</label><input id="admin-token" type="password" required maxlength="200" autocomplete="off"><p class="form-error" role="alert">${e(admin.error || '')}</p><button class="button primary" type="submit" ${admin.loading ? 'disabled' : ''}>${admin.loading ? '正在验证…' : '查看系统状态'}</button></form>
    ${state.settings.development ? notice('当前为本地开发环境默认临时密钥为 <code>6767</code>；生产部署必须更换为环境变量中的强密钥','warning') : ''}`;
  const {health,stats,logs} = admin.data;
  return `${pageTitle('系统监控','统计自本次服务启动起累计，不记录用户配置或设备传感器历史',button('刷新','admin-refresh',{type:'outline',symbol:'refresh',disabled:admin.loading})+button('退出监控','admin-logout',{type:'secondary'}))}
    ${admin.error ? notice(e(admin.error),'warning') : ''}
    <div class="service-status"><span class="status-dot online"></span><strong>服务运行正常</strong><span class="muted">数据库 ${e(health.database)} · 已运行 ${Math.floor(health.uptimeSeconds/60)} 分钟</span></div>
    <div class="admin-metrics">${metric('API 请求',stats.requests)}${metric('已生成配置',stats.generated)}${metric('错误响应',stats.errors)}${metric('平均耗时',stats.averageMs,'ms')}</div>
    <section class="content-section"><div class="section-heading"><h2>知识库与环境服务</h2><span class="small muted">${stats.plants} 种植物 · ${stats.locations} 个地点</span></div><dl class="parameter-list">${Object.entries(health.libraryVersions).map(([name,value])=>`<div><dt>${e(({plants:'植物权重库',locations:'地点参考库',environment_weights:'环境权重库'})[name])}</dt><dd class="mono">${e(value)}</dd></div>`).join('')}<div><dt>外部天气服务</dt><dd>${health.weatherEnabled ? '已启用 · 失败自动降级' : '未启用 · 使用静态数据'}</dd></div></dl></section>
    <section class="content-section"><h2>最近系统日志</h2><p class="small muted">最多展示 50 条只保留维护事件和降级摘要</p><div class="table-scroll"><table><thead><tr><th>时间</th><th>级别</th><th>事件</th><th>说明</th></tr></thead><tbody>${logs.items.map(row=>`<tr><td>${e(timestamp(row.createdAt))}</td><td>${e(row.level)}</td><td class="mono">${e(row.event)}</td><td>${e(row.message)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
