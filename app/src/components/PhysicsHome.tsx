import NetworkStatePanel from './NetworkStatePanel';
import {getHeadModelSelection,subscribeHeadModelSelection,setHeadModelSelection} from '../lib/headModelSelection';
import LocalBEMLab from './LocalBEMLab';
import EegAnalysisLab from './EegAnalysisLab';
import ExperimentLab from './ExperimentLab';
import {prepareTemplateAnalysis} from '../lib/templateExperiment';
import {preparePhysicalAnalysis,physicalFixtureReady,subscribePhysicalSource} from '../lib/physicalExperiment';
import type { SphereFixture } from '../lib/sphereForward';
import {validateSphereFixture} from '../lib/sphereForward';
import { useEffect,useSyncExternalStore,useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import type { BrainData } from '../lib/brainData';
import type { BackgroundMode, ResponseSummary, SnapshotSummary } from '../lib/simClient';
import HeadSphereLab from './HeadSphereLab';
import ActivityChart from './ActivityChart';
import type { SimClient } from '../lib/simClient';
import LanguageSwitch from './ui/LanguageSwitch';
import Dropdown from './ui/Dropdown';
import { ControlField, RangeControl } from './ui/ControlField';

export default function PhysicsHome({networkView,data,selectedId,onSelect,sim,ready,error,
 strength,durationMs,onStrength,onDuration,onPulse,onReset,onPause,paused,background,onBackground,
 response,onRecover,onRestore}:{
 networkView:ReactNode; data:BrainData|null; selectedId:number|null; onSelect:(id:number)=>void;
 sim:SimClient|null; ready:boolean; error:string|null; strength:number; durationMs:number;
 onStrength:(v:number)=>void;onDuration:(v:number)=>void;onPulse:()=>void;onReset:()=>void;
 onPause:()=>void;paused:boolean;background:BackgroundMode;onBackground:(mode:BackgroundMode)=>void;
 onRecover:()=>void;onRestore?:(summary:SnapshotSummary)=>void;
 response:ResponseSummary|null;
}) {
 const {locale,t}=useI18n();
 const text=(zh:string,en:string)=>locale==='zh-CN'?zh:en;
 const [model,setModel]=useState<'electric'|'network'>('electric');
 const headModel=useSyncExternalStore(subscribeHeadModelSelection,getHeadModelSelection);
 const setHeadModel=setHeadModelSelection;
 const physicalReady=useSyncExternalStore(subscribePhysicalSource,physicalFixtureReady);
 const [templateReady,setTemplateReady]=useState(false);
 const [help,setHelp]=useState(false);
 const [advanced,setAdvanced]=useState(false);
 // Option A restore (2026-11-18): the Advanced labs nav returns to #basic
 // with exactly two destinations — signals and comparison. The other five
 // pre-P4 destinations stay cut. The bench is still the only default entry.
 const choices:Array<{key:'signals'|'comparison';zh:string;en:string;hintZh:string;hintEn:string}>=[
  {key:'signals',zh:'信号分析',en:'Signal analysis',hintZh:'查看脑电波形、频谱与事件响应',hintEn:'Inspect recordings, spectra and event responses'},
  {key:'comparison',zh:'对照与回放',en:'Compare and replay',hintZh:'比较参数变化，检查保存的状态',hintEn:'Compare parameters and inspect saved states'},
 ];
 // Template-dipole analysis entry (restored after P4): LocalBEMLab's
 // "Analyze this template experiment" opens the EEG lab inline, replacing
 // the home exactly as the old #advanced signals flow did; the back button
 // below returns to the template home. The bench has no equivalent for
 // this template-dipole experiment flow, so the entry lives here in #basic.
 const [analysisOpen,setAnalysisOpen]=useState(false);
 // Option A restore (2026-11-18), More → Comparisons: pre-P4 the old App
 // topbar had a More/Less toggle whose tools row held a Comparisons chip
 // opening ExperimentLab. P4 deleted it; the network-comparison browser
 // test still drives that path (analysis view → More → Comparisons →
 // Compare A/B). Restored here, inside the analysis branch only: the
 // toggle's accessible name starts with "More" in English, the chip uses
 // shell.experiments ("Comparisons" / "对照实验"), and clicking it closes
 // the analysis branch and opens the comparison branch — same as pre-P4.
 const [labMore,setLabMore]=useState(false);
 // Comparison entry: experimentActive keeps the lab branch (and its back
 // button) mounted while experimentOpen tracks whether the lab itself is
 // mounted. The lab's own Close only unmounts the lab: unmounting stops
 // the live feedback controller (Worker reports phase 'stopped'), while
 // the back button stays clickable to return home. Reopening remounts
 // the lab, which reads the live Worker feedback state on mount instead
 // of defaults. The two flags must not be collapsed into one.
 const [experimentActive,setExperimentActive]=useState(false);
 const [experimentOpen,setExperimentOpen]=useState(false);
 const [expFixture,setExpFixture]=useState<SphereFixture|null>(null);
 const [expFixtureError,setExpFixtureError]=useState<string|null>(null);
 useEffect(()=>{
  if(!experimentActive||expFixture||expFixtureError)return;
  const controller=new AbortController();
  fetch(import.meta.env.BASE_URL+'forward-assets/sphere-model.json',{signal:controller.signal})
   .then(async r=>{if(!r.ok)throw new Error('模型资源缺失：请先运行 scientific/forward/generate_sphere_model.py');
    const data=(await r.json()) as SphereFixture;validateSphereFixture(data);setExpFixture(data);})
   .catch(e=>{if(!controller.signal.aborted)setExpFixtureError(String(e));});
  return ()=>controller.abort();
 },[experimentActive,expFixture,expFixtureError]);
 const closeLabs=()=>{setLabMore(false);setAnalysisOpen(false);setExperimentActive(false);setExperimentOpen(false);};
 const openAnalysisFromExperiment=()=>{setExperimentActive(false);setExperimentOpen(false);setAnalysisOpen(true);};
 const selected=selectedId!==null&&data?data.regions[selectedId]:null;
 if(analysisOpen||experimentActive)return <div className="physics-home" data-testid="physics-home">
  <header className="physics-header">
   <a className="physics-brand" href="#" aria-label="BrainRun">BrainRun<span>{text('交互物理仿真','Interactive physics')}</span></a>
   <div className="physics-header-actions"><LanguageSwitch/></div>
  </header>
  <main className="physics-main">
   <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
    <button type="button" className="ui-button" onClick={closeLabs}>{text('返回物理模型','Back to physical models')}</button>
    {analysisOpen&&<button type="button" className="ui-button" aria-pressed={labMore} onClick={()=>setLabMore(v=>!v)}>{t(labMore?'shell.less':'shell.more')} {labMore?'▲':'▼'}</button>}
   </div>
   {analysisOpen&&labMore&&<div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginTop:'8px'}}>
    <button type="button" className="ui-button" onClick={()=>{setLabMore(false);setAnalysisOpen(false);setExperimentActive(true);setExperimentOpen(true);}}>{t('shell.experiments')}</button>
   </div>}
   {analysisOpen&&<EegAnalysisLab inline initialTab="eeg" onClose={()=>setAnalysisOpen(false)}
    liveSource={{sim,node:selectedId,regionLabel:selected?.label??null,positionMm:selected?selected.centre:null}}/>}
   {experimentActive&&experimentOpen&&<>
    {expFixtureError&&<p className="panel-text" style={{color:'#ffb340'}}>球形正向模型未加载（{expFixtureError}）：源定位对照不可用，双脑数值比较与时间机器、闭环照常可用。</p>}
    <ExperimentLab fixture={expFixture} onRestore={onRestore} onOpenAnalysis={openAnalysisFromExperiment}
     onClose={()=>setExperimentOpen(false)}
     live={{sim,node:selectedId,label:selected?.label??null,positionMm:selected?selected.centre:null}}/>
   </>}
  </main>
 </div>;
 return <div className="physics-home" data-testid="physics-home">
  <header className="physics-header">
   <a className="physics-brand" href="#" aria-label="BrainRun">BrainRun<span>{text('交互物理仿真','Interactive physics')}</span></a>
   <div className="physics-header-actions">
    <LanguageSwitch/>
    <button className="ui-button" type="button" aria-expanded={help} onClick={()=>setHelp(v=>!v)}>{text('操作帮助','How to use')}</button>
    <button className="ui-button" type="button" aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)}>{text('高级实验','Advanced labs')} <span aria-hidden="true">{advanced?'−':'+'}</span></button>
   </div>
  </header>
  {help&&<section className="physics-help" role="region" aria-label={text('操作帮助','How to use')}>
   <strong>{text('先动手，再看结果。','Change something. Watch what happens.')}</strong>
   <p>{model==='electric'?text('拖动橙色电流源，或调整右侧的位置和强度。头皮上的测量点和下方数字会一起更新。拖动空白处旋转视角。','Drag the orange current source, or change its position and strength with the controls. Sensor readings update immediately. Drag empty space to rotate the view.'):
    text('点击大脑选择位置，再按“施加刺激”。调整强度和持续时间，比较活动曲线。单纯选择和旋转不会施加刺激。','Select a location on the brain, then apply an input. Adjust its strength and duration and compare the trace. Selecting and rotating do not stimulate the model.')}</p>
  </section>}
  {advanced&&<nav className="physics-advanced" aria-label={text('高级实验分类','Advanced lab categories')}>
   {choices.map(item=><button type="button" className="advanced-card" key={item.key} disabled={item.key==='signals'&&model==='electric'&&!(headModel==='sphere'?physicalReady:templateReady)} onClick={()=>{
    setAdvanced(false);
    if(item.key==='signals'){if(model==='electric'){if(headModel==='bem')prepareTemplateAnalysis();else preparePhysicalAnalysis();}setAnalysisOpen(true);}
    else{setExperimentActive(true);setExperimentOpen(true);}
   }}>
    <strong>{text(item.zh,item.en)}</strong><span>{text(item.hintZh,item.hintEn)}</span>
   </button>)}
  </nav>}
  <main className="physics-main">
   <div className="physics-intro">
    <div><p className="eyebrow">{text('由你操作，即时计算','Your controls. Live calculations.')}</p>
     <h1>{model==='electric'?text('移动电流源，观察测量如何变化','Move a source. See what sensors measure.'):text('选择一个位置，观察活动如何传播','Choose a region. Watch activity spread.')}</h1>
    </div>
    <div className="physics-model-tabs" role="tablist" aria-label={text('物理模型','Physical model')}>
     <button type="button" role="tab" aria-selected={model==='electric'} onClick={()=>setModel('electric')}>{text('电流与测量','Currents & sensors')}</button>
     <button type="button" role="tab" aria-selected={model==='network'} onClick={()=>setModel('network')}>{text('脑区与传播','Regions & activity')}</button>
    </div>
   </div>
   {model==='electric'?<>
    <details className="physics-details"><summary>{text('头部模型','Head model')} · {headModel==='sphere'?text('球形教学模型','Teaching sphere'):'fsaverage BEM'}</summary>
     <Dropdown aria-label={text('头部模型','Head model')} value={headModel} onChange={e=>setHeadModel(e.target.value as 'sphere'|'bem')}>
      <option value="sphere">{text('四层球形：自由移动源','Four-layer sphere: move the source freely')}</option>
      <option value="bem">{text('真实模板 BEM：选择皮层位置','Anatomical template BEM: choose a cortical location')}</option>
     </Dropdown>
    </details>
    {headModel==='sphere'?<HeadSphereLab embedded onClose={()=>{}}/>:<LocalBEMLab embedded onClose={()=>{}} onReady={setTemplateReady} onAnalysis={()=>setAnalysisOpen(true)}/>}
   </>:
    <div className="manual-network" data-testid="manual-network">
     <section className="manual-network-view">
      <div className="model-instruction">{text('点击选择位置 · 拖动旋转 · 滚轮缩放','Click to select · drag to rotate · scroll to zoom')}</div>
      <div className="manual-brain">{networkView}</div>
      <div className="manual-trace"><h2>{text('当前脑区的活动','Activity in the selected region')}</h2>
       <ActivityChart simple sim={sim} selectedId={selectedId} resetSignal={0} replay={null}/></div>
     </section>
     <aside className="physics-controls">
      <div className="control-step"><span>1</span><h2>{text('选择位置','Choose a location')}</h2></div>
      <ControlField label={text('脑区','Brain region')} hint={text('也可以直接点击左侧模型。选择本身不会施加输入。','Or click the model. Selection alone applies no input.')}>
       <Dropdown aria-label={text('选择脑区','Choose brain region')} value={selectedId??''}
        onChange={e=>onSelect(Number(e.target.value))}>
        <option value="" disabled>{text('在模型上点选，或在此选择','Select on the model or choose here')}</option>
        {data?.regions.map(region=><option value={region.id} key={region.id}>{region.label} · #{region.id}</option>)}
       </Dropdown>
      </ControlField>
      <div className="control-step"><span>2</span><h2>{text('调整输入','Adjust the input')}</h2></div>
      <RangeControl label={text('刺激强度','Input strength')} hint={text('从较轻的输入开始，再比较变化。','Start gently, then compare.')} value={strength} min={0.5} max={2} step={0.05} onChange={onStrength}/>
      <RangeControl label={text('持续时间','Duration')} value={durationMs} min={20} max={500} step={10} unit="ms" onChange={onDuration}/>
      <button type="button" className="ui-button" onClick={()=>{onStrength(.5);onDuration(20);}}>{text('使用轻输入设置','Use gentle input settings')}</button>
      <button type="button" className="ui-button ui-button-primary" disabled={!ready||selectedId===null||paused}
       onClick={onPulse}>{!ready?text('模型加载中…','Loading model…'):paused?text('先继续仿真','Resume the model first'):selectedId===null?text('先选择一个位置','Choose a location first'):text('施加一次刺激','Apply one input')}</button>
      <div className="control-step"><span>3</span><h2>{text('观察变化','Inspect the response')}</h2></div>
      <p className="plain-explanation">{response?text('颜色表示活动变化，曲线显示当前选择位置的实际模型数值。尝试换一个位置或改变强度。','Colors show activity changes; the trace shows actual model values at your selection. Try another location or strength.'):
       text('输入前，模型保持背景活动。施加输入后，观察信号是否传播到其他位置。','The model shows background activity before input. After an input, watch whether activity spreads to other regions.')}</p>
      <NetworkStatePanel sim={sim} selectedId={selectedId} onRecover={onRecover}/>
      {response&&<p className="plain-explanation">{text('下方汇总最近一次刺激窗口（刺激前 0.5 秒至刺激后 2 秒）的峰值变化；窗口结束后保留该次结果。','Below is the peak-change summary from 0.5 s before to 2 s after the most recent input. It retains that result after the window ends.')}</p>}
      {response&&<output className="physics-readout">{text('超过响应阈值的位置','Regions above response threshold')}: <strong>{response.count}</strong></output>}
      <details className="physics-details"><summary>{text('背景与模型说明','Background and model details')}</summary>
       <ControlField label={text('背景活动','Background activity')}>
        <Dropdown aria-label={text('背景活动','Background activity')} value={background} onChange={e=>onBackground(e.target.value as BackgroundMode)}>
         <option value="quiet">{text('安静','Quiet')}</option><option value="spontaneous">{text('持续背景活动','Spontaneous background')}</option><option value="oscillatory">{text('规律的外部输入','Regular external input')}</option>
        </Dropdown>
       </ControlField>
       <p>{text('这是 Wilson–Cowan 神经群体模型，数值没有量纲，不是头皮脑电电压。它用于理解模型中的传播，不代表真实人脑预测。','This Wilson–Cowan population model uses dimensionless activity, not scalp EEG voltage. It illustrates model propagation rather than predicting a real brain.')}</p>
      </details>
      {error&&<p className="physics-error" role="alert">{text('模型暂时不可用，请恢复默认或刷新重试。','The model is unavailable. Restore defaults or reload to retry.')} <details><summary>{text('技术信息','Technical details')}</summary>{error}</details></p>}
      <div className="physics-actions"><button type="button" className="ui-button" disabled={!ready} onClick={onPause}>{paused?text('继续','Resume'):text('暂停','Pause')}</button>
       <button type="button" className="ui-button" onClick={onReset}>{text('恢复默认','Restore defaults')}</button></div>
     </aside>
    </div>}
   <footer className="physics-footnote">{text('教学模型 · 你改动的是计算参数，显示来自模型求解结果。','Educational models · controls change computational parameters; displays use solver results.')}</footer>
  </main>
 </div>;
}
