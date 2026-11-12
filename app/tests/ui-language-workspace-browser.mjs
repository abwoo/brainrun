import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {preview} from 'vite';
const server=await preview({preview:{port:0,host:'127.0.0.1'},logLevel:'error'});
let browser;
const misses=new Set(),errors=[];
try {
 const url=server.resolvedUrls?.local?.[0];assert.ok(url);
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 // The Linux runner has no CJK system fonts; provide the same fallback that
 // Chinese users' operating systems normally supply, without a production CDN.
 let fontCss=await readFile('node_modules/@fontsource/noto-sans-sc/400.css','utf8');
 for(const match of [...fontCss.matchAll(/url\(([^)]+)\)/g)]){
  const asset=match[1].replace(/['"]/g,'');
  const bytes=await readFile('node_modules/@fontsource/noto-sans-sc/'+asset);
  fontCss=fontCss.replace(match[0],'url(data:font/woff2;base64,'+bytes.toString('base64')+')');
 }
 await page.addStyleTag({content:fontCss});
 await page.evaluate(()=>{
  document.documentElement.style.setProperty('--sans','"Noto Sans SC", system-ui, "Helvetica Neue", Arial, sans-serif');
  document.documentElement.style.setProperty('--mono','"Noto Sans SC", ui-monospace, "SF Mono", Menlo, Consolas, monospace');
 });
 await page.evaluate(()=>document.fonts.load('16px "Noto Sans SC"','中文物理模型'));
 await page.getByTestId('physics-home').waitFor();
 await page.waitForFunction(()=>document.querySelector('[data-testid="peak-potential"]')?.getAttribute('data-voltage')!=='');
 assert.equal(await page.getByRole('dialog').count(),0,'home must never open a preset dialog');
 assert.equal(await page.locator('.topbar').count(),0,'advanced toolbar must not crowd the default workspace');
 const peak=()=>page.getByTestId('peak-potential').getAttribute('data-voltage').then(Number);
 const original=await peak();assert.ok(Math.abs(original)>1e-6);
 await page.getByRole('spinbutton',{name:'源强度 nA·m'}).fill('20');
 await page.getByRole('spinbutton',{name:'源强度 nA·m'}).press('Enter');
 await page.waitForFunction(before=>Math.abs(Number(document.querySelector('[data-testid="peak-potential"]').dataset.voltage)-2*before)<1e-7,original);
 await page.getByRole('spinbutton',{name:'左右位置 mm'}).fill('30');
 await page.getByRole('spinbutton',{name:'左右位置 mm'}).press('Enter');
 await page.getByRole('combobox',{name:'电流方向',exact:true}).selectOption('Z');
 const moved=await peak();assert.notEqual(moved,2*original,'source position and direction must change real forward potentials');
 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.lang==='en-US');
 assert.equal(await page.getByRole('spinbutton',{name:'Source strength nA·m'}).inputValue(),'20');
 assert.equal(await page.getByRole('spinbutton',{name:'Left–right position mm'}).inputValue(),'30');
 assert.equal(await peak(),moved,'language switch must preserve scientific state');
 const collect=async(label)=>{
  const items=await page.evaluate(()=>{
   const found=new Set(),han=/[\u3400-\u9fff]/;
   const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
   while(walker.nextNode()){
    const node=walker.currentNode,parent=node.parentElement;
    if(!parent||parent.closest('.language-switch,script,style'))continue;
    if(!parent.getClientRects().length)continue;
    const text=node.textContent.trim();if(han.test(text))found.add(text);
   }
   for(const element of document.querySelectorAll('[title],[aria-label],[placeholder]')){
    if(element.closest('.language-switch')||!element.getClientRects().length)continue;
    for(const attr of ['title','aria-label','placeholder']){
     const text=element.getAttribute(attr);if(text&&han.test(text))found.add(text);
    }
   }
   return [...found];
  });
  items.forEach(x=>misses.add(x));console.log('LANGUAGE_SURFACE',label,items.length);
 };
 await collect('manual-electric');
 await mkdir('../tests/ui/screenshots',{recursive:true});
 const shot=async(name,embed=false)=>{
  await page.evaluate(async()=>{
   document.body.getBoundingClientRect();
   for(const weight of [400,600,700]){
    await document.fonts.load(weight+' 16px "Noto Sans SC"',document.body.innerText);
   }
   await document.fonts.ready;
  });
  const bytes=await page.screenshot({type:'jpeg',quality:55,fullPage:true});
  await writeFile('../tests/ui/screenshots/'+name+'.jpg',bytes);
  if(embed)console.log('SCREENSHOT_'+name.toUpperCase()+'='+bytes.toString('base64'));
 };
 await shot('physics-home-en',true);
 await page.getByRole('button',{name:'中文',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');
 await shot('physics-home-zh',true);
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile home must not overflow horizontally');
 await shot('physics-home-mobile',true);
 await page.setViewportSize({width:1440,height:1050});
 await page.getByRole('tab',{name:'脑区与传播',exact:true}).click();
 await page.waitForFunction(()=>window.__brainSim?.isReady?.()&&window.__brainSim.getSnapshot(),null,{timeout:60000});
 await page.getByRole('button',{name:'恢复默认',exact:true}).click();
 await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.t_ms>=0);
 const markerCount=await page.evaluate(()=>window.__brainSim.getMarkers().length);
 await page.getByRole('combobox',{name:'选择脑区',exact:true}).selectOption('40');
 assert.equal(await page.evaluate(()=>window.__brainSim.getMarkers().length),markerCount,'selection must not stimulate');
 await page.getByRole('spinbutton',{name:'刺激强度',exact:true}).fill('1');
 await page.getByRole('spinbutton',{name:'刺激强度',exact:true}).press('Enter');
 await page.getByRole('spinbutton',{name:'持续时间 ms',exact:true}).fill('200');
 await page.getByRole('spinbutton',{name:'持续时间 ms',exact:true}).press('Enter');
 await page.waitForFunction(()=>window.__brainSim.getExperimentSession().commands.some(c=>c.command==='set_params'&&c.inputs?.stim_amplitude===1)&&window.__brainSim.getExperimentSession().commands.some(c=>c.command==='set_params'&&c.inputs?.stim_duration_ms===200));
 await page.getByRole('button',{name:'施加一次刺激',exact:true}).click();
 await page.waitForFunction(()=>window.__brainSim.getExperimentSession().commands.some(c=>c.command==='stimulus'&&c.inputs?.node===40&&c.inputs.amplitude===1&&c.inputs.duration_ms===200));
 await page.waitForFunction(()=>window.__brainSim.getMaxAbsDeltaE()?.[40]>.01,null,{timeout:12000});
 const liveRun=await page.evaluate(()=>window.__brainSim.getExperimentSession().provenance.runId);
 await page.getByRole('button',{name:'English',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__brainSim.getExperimentSession().provenance.runId),liveRun);
 await collect('manual-network');
 await page.getByRole('button',{name:'Advanced labs',exact:true}).click();
 assert.equal(await page.getByRole('dialog').count(),0,'advanced menu expands in flow, never over the model');
 await collect('advanced-menu');
 await page.getByRole('button',{name:/^Signal analysis/}).click();
 await page.waitForURL(/#advanced/);
 await collect('signals-empty');
 await page.getByRole('button',{name:'Run experiment',exact:true}).click();
 await page.getByTestId('eeg-summary').waitFor({timeout:30000});
 await collect('signals-raw');
 for(const tab of ['Spectrum','ERP','Time-frequency','Topography','Source localization']){
  await page.getByRole('tab',{name:tab,exact:true}).click();await collect('signals-'+tab);
 }
 await page.getByRole('tab',{name:'ERP',exact:true}).click();
 await page.getByRole('button',{name:/Run oddball/}).click();
 await page.waitForFunction(()=>{
  const id=document.querySelector('[data-eeg-run-id]')?.getAttribute('data-eeg-run-id');
  return id&&id===document.querySelector('[data-epoch-run-id]')?.getAttribute('data-epoch-run-id');
 });
 await collect('oddball-results');
 await page.getByRole('tab',{name:'EEG',exact:true}).click();
 const promised=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON',exact:true}).click();
 const download=await promised,stream=await download.createReadStream();let body='';
 for await(const chunk of stream)body+=chunk.toString();
 const bundle=JSON.parse(body);assert.equal(bundle.provenance.runId,bundle.epochs.provenance.runId);assert.ok(bundle.events.every(e=>e.runId===bundle.provenance.runId));
 await page.locator('button[data-mode="play"]').click();
 for(const label of ['Cellular lab','Stimulation lab','Comparisons','DIPOLE LAB','HEAD EEG','Model info']){
  await page.getByRole('button',{name:label,exact:true}).click();await collect(label);
  if(label==='Cellular lab'){
   await page.getByRole('button',{name:'Run simulation',exact:true}).click();await collect('cell-result');
   await page.getByRole('button',{name:'Hodgkin–Huxley',exact:true}).click();
   await page.getByRole('button',{name:'Run simulation',exact:true}).click();await collect('hh-result');
  }
  if(label==='Stimulation lab'){
   for(const level of ['B','C','D']){await page.getByRole('combobox',{name:'Stimulation level',exact:true}).selectOption(level);await collect('stim-'+level);}
  }
  // The persistent language control must work inside an open scientific lab.
  await page.getByRole('button',{name:'中文',exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');
  await page.getByRole('button',{name:'English',exact:true}).click();
  await page.keyboard.press('Escape');
 }
 await page.locator('button[data-mode="explore"]').click();await collect('atlas');
 await page.getByRole('button',{name:'Quick experiments',exact:true}).click();
 assert.equal(await page.getByRole('dialog').count(),0,'presets must be a separate page, not a modal');
 await page.locator('.scenario-inline').waitFor();await collect('presets');
 await page.getByRole('button',{name:'Back to physical models',exact:true}).click();
 await page.getByTestId('physics-home').waitFor();
 assert.equal(await page.getByRole('spinbutton',{name:'Source strength nA·m'}).inputValue(),'20','returning from advanced labs preserves the manual source');
 assert.equal(await page.locator('html').getAttribute('lang'),'en-US');
 await page.reload({waitUntil:'domcontentloaded'});await page.getByTestId('physics-home').waitFor();
 assert.equal(await page.locator('html').getAttribute('lang'),'en-US');
 console.log('MISSING_MESSAGES='+JSON.stringify([...misses]));
 assert.deepEqual(errors,[],'JavaScript errors');
 assert.deepEqual([...misses],[],'All displayed messages and accessibility text must have complete translations');
 console.log('Manual physics → actual forward values; explicit network input → Worker ACK; full-page languages and nonblocking presets PASS');
} finally {await browser?.close();await server.httpServer.close();}
