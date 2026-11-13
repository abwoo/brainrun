import LocalBEMLab from './LocalBEMLab';
import {prepareTemplateAnalysis} from '../lib/templateExperiment';
import {preparePhysicalAnalysis,physicalFixtureReady,subscribePhysicalSource} from '../lib/physicalExperiment';
import { useSyncExternalStore,useState, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import type { BrainData } from '../lib/brainData';
import type { BackgroundMode, ResponseSummary } from '../lib/simClient';
import HeadSphereLab from './HeadSphereLab';
import ActivityChart from './ActivityChart';
import type { SimClient } from '../lib/simClient';
import LanguageSwitch from './ui/LanguageSwitch';
import Dropdown from './ui/Dropdown';
import { ControlField, RangeControl } from './ui/ControlField';

export type AdvancedDestination = 'signals' | 'cellular' | 'stimulation' | 'comparison' | 'atlas' | 'presets' | 'model';
export default function PhysicsHome({networkView,data,selectedId,onSelect,sim,ready,error,
 strength,durationMs,onStrength,onDuration,onPulse,onReset,onPause,paused,background,onBackground,
 response,onAdvanced}:{
 networkView:ReactNode; data:BrainData|null; selectedId:number|null; onSelect:(id:number)=>void;
 sim:SimClient|null; ready:boolean; error:string|null; strength:number; durationMs:number;
 onStrength:(v:number)=>void;onDuration:(v:number)=>void;onPulse:()=>void;onReset:()=>void;
 onPause:()=>void;paused:boolean;background:BackgroundMode;onBackground:(mode:BackgroundMode)=>void;
 response:ResponseSummary|null;onAdvanced:(target:AdvancedDestination)=>void;
}) {
 const physicalReady=useSyncExternalStore(subscribePhysicalSource,physicalFixtureReady);
 const {locale}=useI18n();
 const text=(zh:string,en:string)=>locale==='zh-CN'?zh:en;
 const [model,setModel]=useState<'electric'|'network'>('electric');
 const [headModel,setHeadModel]=useState<'sphere'|'bem'>('sphere');
 const [templateReady,setTemplateReady]=useState(false);
 const [advanced,setAdvanced]=useState(false);
 const [help,setHelp]=useState(false);
 const choices:Array<{key:AdvancedDestination;zh:string;en:string;hintZh:string;hintEn:string}>=[
  {key:'signals',zh:'信号分析',en:'Signal analysis',hintZh:'查看脑电波形、频谱与事件响应',hintEn:'Inspect recordings, spectra and event responses'},
  {key:'cellular',zh:'单个神经元',en:'Single neurons',hintZh:'改变电流，观察细胞放电',hintEn:'Change current and inspect neuronal spikes'},
  {key:'stimulation',zh:'刺激与电场',en:'Stimulation fields',hintZh:'探索电极和线圈的电场模型',hintEn:'Explore electrode and coil field models'},
  {key:'comparison',zh:'对照与回放',en:'Compare and replay',hintZh:'比较参数变化，检查保存的状态',hintEn:'Compare parameters and inspect saved states'},
  {key:'atlas',zh:'脑区与坐标',en:'Regions and coordinates',hintZh:'浏览模型使用的脑区与连接',hintEn:'Browse regions and connections'},
  {key:'presets',zh:'辅助预设',en:'Optional presets',hintZh:'按需载入示例，不自动运行',hintEn:'Choose an example only when needed'},
  {key:'model',zh:'模型说明',en:'About the models',hintZh:'数据来源、公式与适用范围',hintEn:'Data sources, equations and boundaries'},
 ];
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
    if(item.key==='signals'&&model==='electric'){if(headModel==='bem')prepareTemplateAnalysis();else preparePhysicalAnalysis();}
    onAdvanced(item.key);
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
    {headModel==='sphere'?<HeadSphereLab embedded onClose={()=>{}}/>:<LocalBEMLab embedded onClose={()=>{}} onReady={setTemplateReady} onAnalysis={()=>onAdvanced('signals')}/>}
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
      <button type="button" className="ui-button ui-button-primary" disabled={!ready||selectedId===null||paused}
       onClick={onPulse}>{!ready?text('模型加载中…','Loading model…'):paused?text('先继续仿真','Resume the model first'):selectedId===null?text('先选择一个位置','Choose a location first'):text('施加一次刺激','Apply one input')}</button>
      <div className="control-step"><span>3</span><h2>{text('观察变化','Inspect the response')}</h2></div>
      <p className="plain-explanation">{response?text('颜色表示活动变化，曲线显示当前选择位置的实际模型数值。尝试换一个位置或改变强度。','Colors show activity changes; the trace shows actual model values at your selection. Try another location or strength.'):
       text('输入前，模型保持背景活动。施加输入后，观察信号是否传播到其他位置。','The model shows background activity before input. After an input, watch whether activity spreads to other regions.')}</p>
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
