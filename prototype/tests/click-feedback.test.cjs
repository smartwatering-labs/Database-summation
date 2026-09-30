const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve('test-results/click-feedback');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const base=process.env.TEST_URL||'http://127.0.0.1:5000';
  const settle=()=>page.waitForFunction(()=>!document.querySelector('#main').inert&&document.querySelector('#main').dataset.surfaceMoving==='false');
  const freeze=()=>page.evaluate(()=>{
   const spark=document.querySelector('.click-feedback:last-child');
   if(!spark)throw new Error('missing click feedback');
   spark.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=80;});
   // The top layer is raised on the next frame; before then its rect can be zero.
   return {x:parseFloat(spark.style.left),y:parseFloat(spark.style.top)};
  });
  const release=async()=>{
   await page.evaluate(()=>document.querySelectorAll('.click-feedback').forEach(n=>n.getAnimations({subtree:true}).forEach(a=>a.finish())));
   await page.waitForFunction(()=>!document.querySelector('.click-feedback'));
   assert.equal(await page.locator('.click-feedback-layer').evaluate(n=>n.matches(':popover-open')),false);
  };
  const stable=async point=>{
   const actual=await page.locator('.click-feedback').last().evaluate(n=>{
    const r=n.getBoundingClientRect(),s=getComputedStyle(n.parentElement);
    return {x:r.x,y:r.y,filter:s.filter,opacity:s.opacity,top:n.parentElement.matches(':popover-open'),hit:document.elementFromPoint(r.x,r.y)?.closest('.click-feedback-layer')!==null};
   });
   assert.ok(Math.abs(actual.x-point.x)<1&&Math.abs(actual.y-point.y)<1,`spark stays at the original viewport position: ${JSON.stringify({actual,point})}`);
   assert.equal(actual.filter,'none');assert.equal(actual.opacity,'1');assert.equal(actual.top,true);assert.equal(actual.hit,false,'feedback does not intercept clicks');
  };
  const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');
  for(const theme of ['classic','minimal']){
   await page.goto(base+'/?theme='+theme+'#configure');await settle();
   const collapse=page.getByRole('button',{name:'收起侧边栏',exact:true});
   const box=await collapse.boundingBox();await collapse.click();const point=await freeze();
   await page.waitForTimeout(700);await stable(point);
   const moved=await page.locator('.sidebar-toggle').boundingBox();assert.ok(moved.x<box.x-100);
   await page.screenshot({path:path.join(out,theme+'-sidebar.png')});await release();
   await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();await page.waitForTimeout(700);
   await page.getByRole('button',{name:'查看 3D 模型',exact:true}).click();await page.waitForTimeout(500);
   await page.getByRole('button',{name:'返回配置面板',exact:true}).click();const panelPoint=await freeze();
   await page.waitForTimeout(200);await stable(panelPoint);
   assert.notEqual(await page.locator('#model-stage').evaluate(n=>getComputedStyle(n).filter),'none');await release();await settle();
   await page.locator('[data-detail="structure"]').click();const modalPoint=await freeze();
   await page.waitForTimeout(500);await stable(modalPoint);
   assert.equal(await page.locator('#detail-dialog').evaluate(n=>n.open),true);
   await cdp.send('DOM.getDocument');
   const {nodeIds}=await cdp.send('DOM.getTopLayerElements');
   const {node}=await cdp.send('DOM.describeNode',{nodeId:nodeIds.at(-1)});
   assert.ok(node.attributes.includes('click-feedback-layer'),'feedback paints above the native dialog and backdrop');
   assert.equal(await page.evaluate(()=>document.activeElement.closest('dialog')?.id),'detail-dialog','feedback never steals dialog focus');
   await page.screenshot({path:path.join(out,theme+'-dialog.png')});await release();await page.keyboard.press('Escape');await page.waitForTimeout(250);
   const rows=await page.locator('.field-row + .field-row').evaluateAll(nodes=>nodes.map(n=>({width:getComputedStyle(n).borderTopWidth,color:getComputedStyle(n).borderTopColor})));
   assert.ok(rows.length>3);rows.forEach(r=>{assert.equal(r.width,'1px');assert.notEqual(r.color,'rgba(0, 0, 0, 0)');});
   const group=page.locator('.settings-section').filter({has:page.getByRole('heading',{name:'栽培环境',exact:true})});
   await group.scrollIntoViewIfNeeded();await group.screenshot({path:path.join(out,theme+'-separators.png')});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.sidebar-toggle').click();
  assert.equal(await page.locator('.click-feedback').count(),0);assert.deepEqual(errors,[]);
  console.log('PASS: fixed click position during sidebar movement/panel blur, top layer above modal backdrop, pointer passthrough, focus retention, cleanup, separators via saved palette URLs, reduced motion');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
