const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve('test-results/shell-fade');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();
  await page.addInitScript(()=>{
   // Observe the opacity actually uploaded and used by WebGL draw calls.
   // This catches a visible fade failure even if the route's JS progress is smooth.
   const locations=new WeakMap(),opacity=new WeakMap(),physical=new WeakSet(),programs=new WeakMap();window.fadeDraws=[];
   for(const type of [WebGLRenderingContext,WebGL2RenderingContext]){
    const proto=type.prototype,get=proto.getUniformLocation,use=proto.useProgram,uniform=proto.uniform1f,draw=proto.drawElements;
    proto.getUniformLocation=function(program,name){const loc=get.call(this,program,name);if(loc&&name==='opacity')locations.set(loc,program);if(loc&&name==='roughness')physical.add(program);return loc;};
    proto.useProgram=function(program){programs.set(this,program);return use.call(this,program);};
    proto.uniform1f=function(loc,value){const program=locations.get(loc);if(program)opacity.set(program,value);return uniform.call(this,loc,value);};
    proto.drawElements=function(...args){
     const alpha=opacity.get(programs.get(this));
     if(document.body?.dataset.page==='home'&&alpha!==undefined)window.fadeDraws.push({time:performance.now(),alpha,physical:physical.has(programs.get(this)),depth:this.getParameter(this.DEPTH_WRITEMASK)});
     return draw.apply(this,args);
    };
   }
  });
  await page.goto((process.env.TEST_URL||'http://127.0.0.1:5000')+'/#device');
  await page.waitForFunction(()=>document.querySelector('#model-stage').dataset.ready==='true'&&!document.querySelector('#main').inert&&document.querySelector('#model-stage').dataset.moving==='false');
  await page.clock.pauseAt((await page.evaluate(()=>Date.now()))+100);
  await page.evaluate(()=>{window.fadeDraws=[];location.hash='home';});
  let elapsed=0;
  for(const time of [100,200,300,400,440,600]){
   await page.clock.runFor(time-elapsed);elapsed=time;
   await page.screenshot({path:path.join(out,`home-${time}.png`)});
  }
  // The ShadowMaterial ground also has partial opacity but intentionally does
  // not write depth. Inspect PBR shell draws, excluding ground/shadow passes.
  const draws=await page.evaluate(()=>window.fadeDraws),fading=draws.filter(d=>d.physical&&d.alpha>.001&&d.alpha<.999);
  assert.ok(fading.length>10,'shell is actually drawn at intermediate opacity');
  assert.ok(fading.some(d=>d.alpha<.2)&&fading.some(d=>d.alpha>.9),'fade spans transparent and near-solid coverage');
  assert.ok(fading.every(d=>d.depth===true),'occlusion remains stable instead of switching near the end of the fade');
  const samples=[...new Map(fading.map(d=>[d.time,d.alpha])).values()];
  assert.ok(samples.every((n,i)=>!i||n>=samples[i-1]-.001),'shell opacity rises continuously');
  assert.ok(Math.max(...samples.slice(1).map((n,i)=>n-samples[i]))<.1,'no abrupt opacity step between frames');
  assert.equal(await page.locator('#model-stage').getAttribute('data-moving'),'false');
  fs.writeFileSync(path.join(out,'draws.json'),JSON.stringify(draws,null,2));
  assert.deepEqual(errors,[]);console.log('PASS: hardware-to-home shell fade uses continuous rendered opacity and stable occlusion');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
