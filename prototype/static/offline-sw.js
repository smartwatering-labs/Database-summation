const CACHE='watering-offline-kit-v5';
const FILES=['/offline-kit','/static/offline-kit.js','/static/offline-kit.css',
  '/static/js/services/device.js','/static/js/services/ble.js','/static/js/services/demo.js',
  '/static/js/services/protocol.js','/static/js/services/config-file.js','/static/js/services/api.js',
  '/static/js/services/connection-session.js'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('watering-offline-kit-')&&key!==CACHE)
    .map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!FILES.includes(url.pathname))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    try{
      const response=await fetch(event.request);
      if(response.ok)await cache.put(event.request,response.clone());
      return response;
    }catch(error){
      const cached=await cache.match(event.request);
      if(cached)return cached;
      throw error;
    }
  }));
});
