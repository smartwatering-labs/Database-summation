export async function api(path, { method = 'GET', body, token, signal, timeoutMs=15000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(path, { method, cache: 'no-store', signal: controller.signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.message || '请求失败'); error.field = result.field; error.status = response.status; throw error; }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时或已取消，请重试');
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
      throw new Error('无法连接本地服务请运行 prototype/start.bat 后刷新此页面，并通过 http://127.0.0.1:5000 打开网站');
    }
    throw error;
  }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function exportConfig(config) {
  const result = await api('/api/configurations/export', { method: 'POST', body: { config } });
  const blob = new Blob([JSON.stringify(result, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `watering-config-r${config.revision}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
