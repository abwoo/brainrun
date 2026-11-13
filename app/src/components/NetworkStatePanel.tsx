import {useEffect,useState} from 'react';
import {useI18n} from '../lib/i18n';
import type {SimClient} from '../lib/simClient';
import type {Snapshot} from '../worker/protocol';

/** Read-only status from Worker snapshots. Flat activity never stops the clock. */
export default function NetworkStatePanel({sim,selectedId,onRecover}:{sim:SimClient|null;selectedId:number|null;onRecover:()=>void}){
 const {locale}=useI18n(),text=(zh:string,en:string)=>locale==='zh-CN'?zh:en;
 const [view,setView]=useState<{snap:Snapshot|null;stalled:boolean;settled:boolean}>({snap:sim?.getLatest()??null,stalled:false,settled:false});
 useEffect(()=>{
  let latest=sim?.getLatest()??null,lastTime=latest?.t_ms??-1,lastRun=latest?.run_id,lastAdvance=performance.now(),lastPaint=0;
  let history:Array<{t:number;e:number;i:number}>=[];
  const publish=()=>{
   const span=history.length?history.at(-1)!.t-history[0].t:0;
   const range=(key:'e'|'i')=>history.length?Math.max(...history.map(p=>p[key]))-Math.min(...history.map(p=>p[key])):Infinity;
   setView({snap:latest,stalled:!!latest&&!latest.paused&&performance.now()-lastAdvance>1500,
    settled:span>=450&&range('e')<1e-6&&range('i')<1e-6});
  };
  const unsubscribe=sim?.subscribe(snap=>{
   if(snap.run_id!==lastRun||snap.t_ms<lastTime){history=[];lastAdvance=performance.now();}
   if(snap.t_ms!==lastTime){lastAdvance=performance.now();lastTime=snap.t_ms;}
   lastRun=snap.run_id;latest=snap;
   if(selectedId!==null&&Number.isFinite(snap.e[selectedId])&&history.at(-1)?.t!==snap.t_ms){
    history.push({t:snap.t_ms,e:snap.e[selectedId],i:snap.i[selectedId]});
    while(history.length&&snap.t_ms-history[0].t>500)history.shift();
   }
   if(performance.now()-lastPaint>100){lastPaint=performance.now();publish();}
  });
  const timer=window.setInterval(publish,500);
  return()=>{unsubscribe?.();clearInterval(timer);};
 },[sim,selectedId]);
 const s=view.snap;
 const status=!s?'loading':s.diverged?'diverged':s.paused?'paused':view.stalled?'stalled':s.locked?'high':view.settled?'settled':'running';
 const labels={
  loading:text('等待求解器','Waiting for solver'),
  diverged:text('计算已停止：数值发散','Computation stopped: numerical divergence'),
  paused:text('已暂停','Paused'),
  stalled:text('模型时间未更新，请暂停后继续或恢复默认','Model time is not updating. Pause/resume or restore defaults.'),
  high:text('高活动状态；求解器仍在运行','High activity state; solver is still running'),
  settled:text('当前响应趋于稳定；求解器仍在运行','Response has settled; solver is still running'),
  running:text('模型正在计算','Solver running'),
 };
 return <section className="plain-explanation" data-testid="network-state" data-state={status} data-time-ms={s?.t_ms??''}
   data-e={selectedId!==null?s?.e[selectedId]??'':''} data-i={selectedId!==null?s?.i[selectedId]??'':''}
   data-active-inputs={s?.active_input_count??''} data-queued-inputs={s?.queued_input_count??''}>
  <p role="status">{labels[status]}</p>
  <p>{text('模型时间','Model time')}: {s?(s.t_ms/1000).toFixed(3):'—'} s · E {selectedId!==null?s?.e[selectedId]?.toFixed(6)??'—':'—'} · I {selectedId!==null?s?.i[selectedId]?.toFixed(6)??'—':'—'}</p>
  <p>{text('进行中的输入','Active inputs')}: {s?.active_input_count??'—'} · {text('待执行','Queued')}: {s?.queued_input_count??'—'}</p>
  {(status==='high'||status==='settled')&&<p>{text('稳定值不表示卡住。模型可能停留在一个稳态；重复强刺激会叠加。背景活动模式决定是否有持续起伏。','A steady value does not mean the app froze. The model can remain at an equilibrium; strong repeated inputs can accumulate. The background mode determines ongoing fluctuations.')}</p>}
  <button type="button" className="ui-button" disabled={s?.pulse_checkpoint_ms===undefined} onClick={onRecover}>{text('恢复刺激前','Restore before input')}</button>
 </section>;
}
