const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
const phase=process.env.PROFILE_PHASE||'before';
const out=path.resolve('test-results/poster/performance');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const results=[];
  for(const network of ['local','10mbps']){
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
   await page.addInitScript(()=>{
    window.modelLongTasks=[];
    new PerformanceObserver(list=>window.modelLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
   });
   await page.route('**/static/js/model-stage.js',async route=>{
    const response=await route.fetch();let source=await response.text();
    for(const [target,label] of [
     ["const response = await fetch('/static/assets/models/model.json');",'start'],
     ['const modelData = fetch','start'],
     ['renderer = new THREE.WebGLRenderer','renderer'],
     ['studioEnvironment(); scene.add','environment'],
     ["if (config.format === 'obj')",'load-start'],
     ['const grain = moldedGrain();','load-end'],
     ['parts = (config.parts || []).map','materials-end'],
     ['await renderer.compileAsync(scene, camera);','compile-start'],
     ['ready = true; stage.dataset.ready','compile-end'],
    ]) source=source.replace(target,`performance.mark('model:${label}'); ${target}`);
    await route.fulfill({response,body:source});
   });
   const cdp=await context.newCDPSession(page);
   if(network==='10mbps')await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1250000,uploadThroughput:1250000});
   await page.goto('http://127.0.0.1:5000');
   await page.waitForFunction(()=>document.querySelector('#model-stage').dataset.ready==='true'&&document.querySelector('#model-stage').dataset.moving==='false',null,{timeout:90000});
   await page.waitForTimeout(300);
   const result=await page.evaluate(()=>({marks:performance.getEntriesByType('mark').map(e=>({name:e.name,time:e.startTime})),resources:performance.getEntriesByType('resource').filter(e=>/glb|three.*js|model.json/.test(e.name)).map(e=>({name:e.name.split('/').pop(),start:e.startTime,duration:e.duration,bytes:e.transferSize})),longTasks:window.modelLongTasks,paint:performance.getEntriesByType('paint').map(e=>({name:e.name,time:e.startTime}))}));
   results.push({network,...result});console.log(JSON.stringify(results.at(-1)));await context.close();
  }
  fs.writeFileSync(path.join(out,`${phase}.json`),JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
