/**
 * EEG 配置与导出一致性（bench 版；2026-11-18 P4 后重写，旧 EEG 实验页已砍；
 * 2026-11-19 简化改写：协议下拉改成四个大按钮，帽预设 / 参考 / 带通 /
 * 种子 / 样本数读数 / 导出全部进“详情 / 诊断”面板；先开面板再操作）。
 *
 * 覆盖：待定配置 vs 活动记录、切页后草稿保持、参考的实际取值、导出 lineage
 *（导联、种子、参考、dataRevision、epochs、Cz 通道全零）。
 *
 * 旧断言 → 台子映射（无等价物的已删，见文件末尾 DROPPED）：
 * - '#eeg-duration'（2000）→ 无等价物：台子没有记录时长控件（采集窗
 *   是 10 s 原生历史），已删。
 * - '#eeg-montage' → 脑电帽预设 combobox（预设即导联）：
 *   '10-10-32' → montage '10-10'，'10-5-128' → montage '10-05'。
 * - '#eeg-seed' → 实验电脑区里的“种子” RangeControl（受试者
 *   反应时种子）；填 17，跨页保持。
 * - '#eeg-reference' + '#eeg-reference-electrode' → 放大器区里
 *   单个“参考” combobox：'cz' 即 {mode:'electrode', label:'Cz'}。
 * - 待定 vs 活动（旧：改导联后活动记录仍是旧导联、configuration-status
 *   data-pending=true）→ 台子对帽预设/种子/参考没有“草稿”语义，改了
 *   立即应用；台子真正的草稿语义只在放大器带通（下限/上限 draft，点
 *   “应用带通”才生效），本测试用带通草稿覆盖“待定 vs 活动”这一项。
 * - 'active-recording' / 'configuration-status' / 'eeg-summary' testid →
 *   无等价物；等价证据是诊断面板头部与脑电帽区的导联说明与导出 JSON。
 * - 模式按钮 play/eeg 往返 → #basic（物理模型页）往返；台子设置存在
 *   外部 store 里，切页不丢，回来后按保持的设置重组记录。
 * - 导出 lineage：montage / reference / parameters.reference /
 *   dataRevision / Cz 全零与旧断言一致；种子与 epochs 见 DROPPED。
 * - 'English' 按钮：不再点，默认语言就是中文，全部断言用中文标签。
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {preview} from 'vite';
const server=await preview({preview:{port:0,host:'127.0.0.1'},logLevel:'error'});

async function exportJson(page){
  const ready=page.waitForEvent('download',{timeout:30000});
  await page.getByRole('button',{name:'导出 JSON',exact:true}).click();
  const download=await ready,stream=await download.createReadStream();let text='';
  for await(const chunk of stream)text+=chunk.toString();
  return JSON.parse(text);
}
async function waitTrials(page,min,timeoutMs){
  const trialRe=/试次数[:：]?\s*(\d+)/;
  const deadline=Date.now()+timeoutMs;let trials=0;
  for(;;){
    const txt=await page.locator('[data-testid="bench-experiment-computer"] .bench-readout').first().textContent();
    const m=txt?.match(trialRe);trials=m?Number(m[1]):0;
    if(trials>=min)return trials;
    if(Date.now()>deadline)throw new Error(`oddball protocol produced only ${trials} trials in ${timeoutMs/1000} s`);
    await page.waitForTimeout(2000);
  }
}

let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage();
 // 台子是默认入口（任何非 #basic 的 hash 都进台子）。
 await page.goto(server.resolvedUrls.local[0],{waitUntil:'domcontentloaded'});
 await page.getByTestId('closed-loop-bench').waitFor({timeout:60000});
 // 诊断面板先打开、一直开着：帽预设 / 参考 / 带通 / 种子 / 样本数 /
 // 导出都在里面；切页回来要重开（面板状态随组件卸载丢弃）。
 const openDiag=async()=>{
   if(!(await page.getByTestId('bench-diagnostics').count())){
     await page.getByTestId('bench-diagnostics-toggle').click();
     await page.getByTestId('bench-diagnostics').waitFor({timeout:15000});
   }
 };
 const diag=()=>page.getByTestId('bench-diagnostics');
 // 等自动采集出一份记录（本地无头 Chromium 很慢，放宽到 180 s）。
 await openDiag();
 await diag().locator('section[aria-label="记录"]').getByText(/样本数\s+[1-9]\d*/).first().waitFor({timeout:180000});
 const presetSel=page.getByRole('combobox',{name:'脑电帽预设',exact:true});
 const refSel=page.getByRole('combobox',{name:'参考',exact:true});
 const ampReadout=page.locator('section[aria-label="放大器"] .bench-readout');
 const capNote=()=>diag().locator('section[aria-label="头部与脑电帽"]');

 // 1. 帽预设改 10-10-32（montage 10-10）：台子无待定态，改了立即应用，
 //    点“更新记录”重组后头部与脑电帽区的导联说明即为新预设。
 await presetSel.selectOption('10-10-32');
 await page.getByRole('button',{name:'更新记录',exact:true}).click();
 await capNote().getByText('32 通道',{exact:false}).waitFor({timeout:60000});
 assert.ok((await capNote().textContent())?.includes('10-10'),
   'active recording must follow the applied 10-10-32 preset');
 assert.equal(await presetSel.inputValue(),'10-10-32');

 // 2. 待定 vs 活动（台子唯一的草稿语义：放大器带通 draft）。
 //    改 draft 不动已应用的滤波，点“应用带通”才生效。
 const loNum=page.locator('input.range-number[aria-label="带通下限 Hz"]');
 const hiNum=page.locator('input.range-number[aria-label="带通上限 Hz"]');
 await loNum.fill('1');await loNum.press('Enter');
 await hiNum.fill('30');await hiNum.press('Enter');
 await page.waitForTimeout(500);
 assert.ok((await ampReadout.textContent())?.includes('带通 0.5–40 Hz'),
   `band-pass draft must not change the applied filter, got ${await ampReadout.textContent()}`);
 await page.getByRole('button',{name:'应用带通',exact:true}).click();
 await page.waitForTimeout(800);
 assert.ok((await ampReadout.textContent())?.includes('带通 1–30 Hz'),
   `applied band-pass must follow the applied drafts, got ${await ampReadout.textContent()}`);
 console.log('band-pass draft: pending 1-30 Hz, applied stays 0.5-40 Hz until apply');

 // 3. 参考改 Cz（立即应用）：读数与重采后的记录都跟过去。
 await refSel.selectOption('cz');
 await page.getByRole('button',{name:'重新采集',exact:true}).click();
 await page.waitForTimeout(2000);
 assert.ok((await ampReadout.textContent())?.includes('参考: Cz'),
   `amplifier readout must show Cz reference, got ${await ampReadout.textContent()}`);

 // 4. 种子填 17（受试者反应时种子）。
 const seedNum=page.locator('input.range-number[aria-label="种子 "]');
 await seedNum.fill('17');await seedNum.press('Enter');
 assert.equal(await seedNum.inputValue(),'17');

 // 5. #basic 往返：预设 / 种子 / 参考 / 已应用带通都保持，记录按保持的
 //    设置重组（旧“草稿跨模式保持”的等价物；活动记录跟的是应用值，
 //    不是旧值——见 DROPPED）。
 await page.getByRole('button',{name:'返回物理模型',exact:true}).click();
 await page.getByTestId('closed-loop-bench').waitFor({state:'detached',timeout:30000});
 await page.getByRole('link',{name:'BrainRun'}).first().waitFor({timeout:30000});
 await page.evaluate(()=>{window.location.hash='bench';});
 await page.getByTestId('closed-loop-bench').waitFor({timeout:60000});
 await openDiag();
 await diag().locator('section[aria-label="记录"]').getByText(/样本数\s+[1-9]\d*/).first().waitFor({timeout:180000});
 assert.equal(await presetSel.inputValue(),'10-10-32','cap preset survives navigation');
 assert.equal(await page.locator('input.range-number[aria-label="种子 "]').inputValue(),'17','seed survives navigation');
 assert.ok((await capNote().textContent())?.includes('32 通道'),
   're-assembled recording after navigation must follow the kept preset');
 assert.equal(await refSel.inputValue(),'cz','reference survives navigation');
 assert.ok((await ampReadout.textContent())?.includes('带通 1–30 Hz'),
   'applied band-pass survives navigation');
 assert.ok((await ampReadout.textContent())?.includes('参考: Cz'),
   'reference readout survives navigation');
 console.log('navigation: preset/seed/reference/band-pass all survive the #basic round-trip');

 // 6. 导出 #1（尚未跑任何协议）：lineage 与旧断言一致；epochs 为 null
 //   （无脉冲即无试次——旧断言原样保留）。
 const rec1=await exportJson(page);
 assert.equal(rec1.montage,'10-10');assert.deepEqual(rec1.reference,{mode:'electrode',label:'Cz'});
 assert.deepEqual(rec1.experiment.parameters.reference,rec1.reference);
 assert.ok(rec1.dataRevision>=1);assert.equal(rec1.epochs,null);
 assert.ok(rec1.dataUv[rec1.channels.findIndex(c=>c.label==='Cz')].every(v=>v===0));
 console.log('export 1: montage 10-10, Cz reference, dataRevision',rec1.dataRevision,', epochs null, Cz all zero');

 // 7. 帽预设改 10-5-128：立即应用，下一份导出即为 10-05（旧“改导联后
 //    活动记录仍是旧导联”断言的反面：台子无待定态）。
 await presetSel.selectOption('10-5-128');
 await page.getByRole('button',{name:'更新记录',exact:true}).click();
 await page.waitForTimeout(2000);
 const rec2=await exportJson(page);
 assert.equal(rec2.montage,'10-05');assert.equal(rec2.channels.length,128);
 assert.deepEqual(rec2.reference,{mode:'electrode',label:'Cz'});
 assert.ok(rec2.dataRevision>=1);
 console.log('export 2: preset change applies immediately, montage 10-05, 128 channels');

 // 8. 跑一次 oddball 再导出：台子组装时自动切分试次，epochs 不再是 null
 //    （旧“epochs 为 null”只在无脉冲时成立；有脉冲即自动出 EpochSet）。
 await page.locator('.bench-protocol-btn',{hasText:'oddball'}).click();
 await page.getByRole('button',{name:'运行协议',exact:true}).click();
 const trials=await waitTrials(page,6,240000);
 console.log('oddball trials fired:',trials);
 await page.getByRole('button',{name:'更新记录',exact:true}).click();
 await page.getByRole('button',{name:'停止协议',exact:true}).click();
 const rec3=await exportJson(page);
 assert.ok(rec3.epochs!==null&&Array.isArray(rec3.epochs.kept),
   'bench auto-epochs once pulses exist in the assembled recording');
 assert.ok(rec3.epochs.kept.length>0,'auto-epochs must cover the run pulses');
 console.log('export 3: epochs auto-created, kept flags:',JSON.stringify(rec3.epochs.kept));
 console.log('EEG configuration: pending vs active, navigation, actual reference values and export lineage PASS');
}finally{await browser?.close();await server.httpServer.close();}

// DROPPED（旧断言，无台子等价物；不许为测试加产品 UI）：
// - '#eeg-duration'（2000）：台子没有记录时长控件，采集窗是 10 s 原生历史。
// - 改导联后 'active-recording' data-montage 仍是旧值、'configuration-status'
//   data-pending='true'、'eeg-summary' 文本不变：台子对帽预设无待定态，改了
//   立即应用；待定 vs 活动的覆盖改走带通草稿（第 2 节）。
// - 'active-recording' / 'configuration-status' / 'eeg-summary' testid：台子
//   没有这些 testid；等价证据是诊断面板头部与脑电帽区的导联说明与导出 JSON。
// - 导出 'rec.seed === 17'：记录种子恒为 1（runNativeExperiment 写死），
//   不取受试者种子；种子 17 的保持由第 4–5 节的控件值断言覆盖。
// - 导出 'rec.epochs === null'（有脉冲时）：台子组装时自动切分试次，有脉冲
//   即出 EpochSet；null 只在无脉冲时成立（第 6 节保留了该断言）。
