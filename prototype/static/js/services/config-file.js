// Keep the browser's temporary file boundary aligned with engine/validation.py.
const metadata = ['revision', 'timestamp', 'configVersion', 'protocolVersion', 'deviceModel', 'plant', 'plantId',
  'country', 'locationName', 'locationCode', 'postalCode', 'climateZone', 'season', 'source',
  'sourceVersion', 'generatedAt', 'wateringStrategy', 'waterNeedMlDay', 'recommendedMode', 'supplyVariant'];
const parameterKeys = ['soilWeight', 'tempWeight', 'airWeight', 'threshold', 'pulseCount', 'pulseOnMs', 'pulseOffMs'];
const displayNumbers = ['dailyWaterNeedMl', 'roundWaterMl', 'estimatedIntervalDays', 'reservoirDays', 'flowRateMlSec'];

function number(value, field, minimum, maximum, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} 必须是有效数字`);
  if (value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new Error(`${field} 必须在 ${minimum}–${maximum} 范围内${integer ? '且为整数' : ''}`);
  }
  return value;
}

function text(value, field, maximum = 120, required = true) {
  if (typeof value !== 'string' || [...value.trim()].length > maximum || (required && !value.trim())) {
    throw new Error(`请填写有效的 ${field}（最多 ${maximum} 字）`);
  }
  return value.trim();
}

export function validateConfigFile(config, currentRevision = null) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('配置必须是 JSON 对象');
  if (config.deviceModel !== 'ESP32-WATER-C3') throw new Error('设备型号必须为 ESP32-WATER-C3');
  if (!['1.0', '2.0'].includes(config.configVersion)) throw new Error('不支持此配置格式版本，仅接受 1.0 或 2.0');
  if ((Object.hasOwn(config, 'protocolVersion') ? config.protocolVersion : '1.0') !== '1.0') throw new Error('不支持此协议版本');
  const revision = number(config.revision, 'revision', 1, 2147483647, true);
  if (currentRevision !== null) {
    number(currentRevision, 'currentRevision', 0, 2147483646, true);
    if (revision <= currentRevision) throw new Error('配置版本不高于设备当前版本，请重新生成配置');
  }
  text(config.plant, 'plant');
  const params = config.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('缺少 params 参数对象');
  for (const key of ['soilWeight', 'tempWeight', 'airWeight']) number(params[key], key, 0, 1);
  if (Math.abs(params.soilWeight + params.tempWeight + params.airWeight - 1) > 0.015) {
    throw new Error('三项权重之和必须为 1');
  }
  number(params.threshold, 'threshold', 20, 90);
  number(params.pulseCount, 'pulseCount', 1, 12, true);
  number(params.pulseOnMs, 'pulseOnMs', 500, 5000, true);
  number(params.pulseOffMs, 'pulseOffMs', 5000, 60000, true);
  if (params.pulseCount * (params.pulseOnMs + params.pulseOffMs) > 360000) {
    throw new Error('单轮脉冲总时长不得超过文档中的 6 分钟保护窗口');
  }
  if (config.configVersion === '2.0') {
    if (typeof config.targetDeviceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(config.targetDeviceId)) {
      throw new Error('目标设备 ID 格式无效');
    }
    number(params.minWaterIntervalSeconds, 'minWaterIntervalSeconds', 3600, 2592000, true);
  }
  const clean = {};
  for (const key of metadata) if (Object.hasOwn(config, key)) clean[key] = config[key];
  if (config.configVersion === '2.0') clean.targetDeviceId = config.targetDeviceId;
  for (const [key, value] of Object.entries(clean)) {
    if (!['revision', 'timestamp', 'waterNeedMlDay'].includes(key)) clean[key] = text(value, key, 200, false);
  }
  if (Object.hasOwn(clean, 'timestamp')) number(clean.timestamp, 'timestamp', 0, 9999999999999);
  if (Object.hasOwn(clean, 'waterNeedMlDay')) number(clean.waterNeedMlDay, 'waterNeedMlDay', 0, 100000);
  if (!['PREPARE', 'DISPLAY', 'LONGRUN'].includes(Object.hasOwn(clean, 'recommendedMode') ? clean.recommendedMode : 'PREPARE')) throw new Error('运行模式不合法');
  if (!['builtin', 'valve'].includes(Object.hasOwn(clean, 'supplyVariant') ? clean.supplyVariant : 'builtin')) throw new Error('供水变体不合法');
  clean.params = Object.fromEntries(parameterKeys.map(key => [key, params[key]]));
  if (config.configVersion === '2.0') clean.params.minWaterIntervalSeconds = params.minWaterIntervalSeconds;
  const display = Object.hasOwn(config, 'display') ? config.display : {};
  if (!display || typeof display !== 'object' || Array.isArray(display)) throw new Error('display 必须是对象');
  clean.display = {};
  for (const key of displayNumbers) {
    if (Object.hasOwn(display, key) && display[key] !== null) clean.display[key] = number(display[key], key, 0, 1000000);
  }
  for (const key of ['plant', 'source', 'irrigationMethod']) {
    if (Object.hasOwn(display, key)) clean.display[key] = text(display[key], key);
  }
  const reference=config.environmentReference;
  if(reference!=null){
    if(config.configVersion!=='2.0'||typeof reference!=='object'||Array.isArray(reference)||!['outdoor','indoor','greenhouse'].includes(reference.context))throw new Error('环境参考格式无效');
    const cleanReference={context:reference.context,title:text(reference.title,'参考标题',200),reference:text(reference.reference,'参考来源',300)};
    for(const [prefix,unit,low,high] of [['temperature','C',-20,60],['humidity','Pct',0,100]]){
      const minKey=prefix+'Min'+unit,maxKey=prefix+'Max'+unit;
      if(reference[minKey]!=null||reference[maxKey]!=null){cleanReference[minKey]=number(reference[minKey],minKey,low,high);cleanReference[maxKey]=number(reference[maxKey],maxKey,cleanReference[minKey],high);}
    }
    if(Object.keys(cleanReference).length===3)throw new Error('环境参考至少需要一组完整范围');
    clean.environmentReference=cleanReference;
  }
  return clean;
}

export function importedConfigResult(config) {
  const clean = validateConfigFile(config);
  return { status: 'ok', storage: 'temporary', config: clean, params: clean.params,
    warnings: ['导入文件已通过网页参数校验；设备仍需再次验证型号、版本、认证与安全范围'] };
}

export function configFileContents(config) {
  const clean = validateConfigFile(config);
  const contents = JSON.stringify(clean, null, 2) + '\n';
  if (new TextEncoder().encode(contents).length > 64 * 1024) throw new Error('配置文件超过 64 KB');
  return { contents, revision: clean.revision };
}
