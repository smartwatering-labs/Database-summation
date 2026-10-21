// Real browser cache is enabled: route interception would disable it.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 const results=[];
 try{
  for(const network of ['local','10mbps']){
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
   await page.addInitScript(()=>{
    window.startupLongTasks=[];
    new PerformanceObserver(list=>window.startupLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
    const watch=()=>{
     if(document.querySelector('#model-stage')?.dataset.ready==='true'){
      requestAnimationFrame(()=>window.modelFirstFrame=performance.now());
     }else requestAnimationFrame(watch);
    };requestAnimationFrame(watch);
   });
   const cdp=await context.newCDPSession(page);
   if(network==='10mbps')await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:1250000,uploadThroughput:1250000});
   for(const visit of ['cold','reload','repeat']){
    if(visit==='cold')await page.goto(process.env.TEST_URL||'http://127.0.0.1:5000');else await page.reload();
    await page.waitForFunction(()=>window.modelFirstFrame>0,null,{timeout:60000});
    const timings=await page.evaluate(()=>({firstModelFrameMs:window.modelFirstFrame,firstContentfulPaintMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,longTasks:window.startupLongTasks,model:performance.getEntriesByType('resource').filter(e=>e.name.endsWith('.glb')).map(e=>({transferBytes:e.transferSize,encodedBytes:e.encodedBodySize,decodedBytes:e.decodedBodySize,durationMs:e.duration}))}));
    results.push({network,visit,...timings});console.log(JSON.stringify(results.at(-1)));
   }
   await context.close();
  }
 }finally{await browser.close();}
 const file=path.resolve('test-results/poster/performance/cache.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exit(1);});
