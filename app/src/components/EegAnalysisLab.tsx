import {getTemplateSource,setTemplateSource} from '../lib/templateExperiment';
/**
 * PR-07 EEG 分析实验壳（B1）。
 *
 * 持有共享状态：`recording` / `events` / `epochs` / `selectedChannel` /
 * `reference` / `montage` / `noise` / 源模型 / 种子 / 时长 / 正向模型。
 * 六个 tab 各自独立文件，props 按 `docs/pr6-design.md` §1.3 约定：
 * 壳传什么，tab 就接什么；tab 不自己再写一套数据源。
 * “运行实验”只在 EEG tab（B1）：柱模型 → 正向模型 → 噪声 → 生成
 * recording + events；ERP tab 只做分段/平均，不重新跑模型。
 * 全批只用一份 EEG 记录：ERP / 时频 / 地形 / 源定位全部读同一份
 * recording，不许各写一套不相关的模拟波形。
 */
import { useEffect, useState } from 'react';
import {getPhysicalSource,setPhysicalSource} from '../lib/physicalExperiment';
import {RangeControl} from './ui/ControlField';
import Dropdown from './ui/Dropdown';
import {runNativeExperiment,NATIVE_EEG_ID} from '../lib/nativeEeg';
import { useI18n } from '../lib/i18n';
import { configurationForRecording, configurationsEqual, type EegRunConfiguration } from '../lib/eegConfiguration';
import {
  SPHERE_MODEL_ID,
  validateSphereFixture,
  type MontageKey,
  type SphereFixture,
} from '../lib/sphereForward';
import type { EegEvent, EegRecording, EegReference, EpochSet, NoiseParams } from '../lib/eegData';
import {
  getLiveRecordingStore,
  LIVE_DERIVATION_ID,
  reReferenceRecording,
  runExperiment,
  setLiveRecordingStore,
  type SourceModel,
} from '../lib/eegRecording';
import type { SimClient } from '../lib/simClient';
import { ExperimentSession } from '../lib/experimentSession';
import type { Vec3Mm } from '../lib/volumeConduction';
import EegWaveTab from './EegWaveTab';
import WavesTab from './WavesTab';
import ErpTab from './ErpTab';
import TfrTab from './TfrTab';
import TopoTab from './TopoTab';
import InverseTab from './InverseTab';

export type EegLabTab = 'eeg' | 'waves' | 'erp' | 'tfr' | 'topo' | 'inverse';

const TABS: { key: EegLabTab; label: string }[] = [
  { key: 'eeg', label: 'EEG' },
  { key: 'waves', label: '频谱' },
  { key: 'erp', label: 'ERP' },
  { key: 'tfr', label: '时频' },
  { key: 'topo', label: '地形' },
  { key: 'inverse', label: '源定位' },
];

export default function EegAnalysisLab({
  onClose,
  inline = false,
  initialTab,
  liveSource,
}: {
  onClose: () => void;
  /** inline：EEG 模式内联渲染（无 backdrop、无关闭按钮），不是弹窗。 */
  inline?: boolean;
  /** 打开时默认切到的 tab；变化时切过去（S8–S11 的“打开实验台”用）。 */
  initialTab?: EegLabTab;
  /**
   * PR8-LINK 直播来源（App 传）：主仿真客户端 + 选中脑区 + 其 TVB 中心。
   * 不传时只有独立柱模型一路；传了才能“从直播推导记录”。
   */
  liveSource?: {
    sim: SimClient | null;
    node: number | null;
    regionLabel: string | null;
    positionMm: Vec3Mm | null;
  };
}) {
  const {locale}=useI18n();
  const text=(zh:string,en:string)=>locale==='zh-CN'?zh:en;
  const [fixture, setFixture] = useState<SphereFixture | null>(null);
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  // PR8-LINK：记录持久化——挂载时从模块级 store 恢复（关弹窗、切模式都不丢）；
  // 运行时经 effect 写回（独立柱模型与直播推导两路都进同一份 store）。
  const storedLive = getLiveRecordingStore();
  const [recording, setRecording] = useState<EegRecording | null>(storedLive?.recording ?? null);
  const [events, setEvents] = useState<EegEvent[]>(storedLive?.events ?? []);
  const [epochs, setEpochs] = useState<EpochSet | null>(storedLive?.epochs ?? null);
  const initialConfiguration=storedLive?.workspace?.configuration??configurationForRecording(storedLive?.recording??null);
  const [selectedChannel, setSelectedChannel] = useState(storedLive?.workspace?.selectedChannel??
    (storedLive?.recording.channels.some(c=>c.label==='Pz')?'Pz':storedLive?.recording.channels[0]?.label??'Pz'));
  const [reference, setReference] = useState<EegReference>(initialConfiguration.reference);
  const [montage, setMontage] = useState<MontageKey>(initialConfiguration.montage);
  const [noise, setNoise] = useState<NoiseParams | null>(initialConfiguration.noise);
  const [sourceModel, setSourceModel] = useState<SourceModel>(initialConfiguration.sourceModel);
  const [seed, setSeed] = useState(initialConfiguration.seed);
  const [durationMs, setDurationMs] = useState(initialConfiguration.durationMs);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EegLabTab>(initialTab ?? 'eeg');
  const [atTimeMs, setAtTimeMs] = useState(storedLive?.workspace?.atTimeMs??400);

  const [nativeRate,setNativeRate]=useState<250|500>(storedLive?.workspace?.nativeRate??250);
  const configuration:EegRunConfiguration={sourceModel,durationMs,montage,reference,noise,seed};
  const pending=!!recording&&(!configurationsEqual(configuration,configurationForRecording(recording))
    ||recording.provenance?.origin==='live-derived'||recording.sourceSnapshot!==undefined||recording.sourceModelId.includes('late'));
  useEffect(()=>{
    if(recording)setAtTimeMs(previous=>Math.max(recording.timesMs[0],Math.min(recording.timesMs.at(-1)??0,previous)));
  },[recording]);
  // PR8-LINK：记录一变就写回 store（两路都进同一份 store；挂载时已从 store 恢复）。
  useEffect(() => {
    if (recording) setLiveRecordingStore({ recording, events, epochs,
      workspace:{configuration:{sourceModel,durationMs,montage,reference,noise,seed},selectedChannel,atTimeMs,nativeRate} });
  }, [recording, events, epochs,sourceModel,durationMs,montage,reference,noise,seed,selectedChannel,atTimeMs,nativeRate]);

  // PR8-LINK 直播推导的状态（与独立柱模型的 running 分开）。
  const [nativeResult,setNativeResult]=useState<{rate:number;peak:number}|null>(null);
  const [liveRunning, setLiveRunning] = useState(false);

  // PR8-A：initialTab 变化时切过去（例如已在 EEG 模式时从场景启动器点
  // “打开实验台 ERP”）；只在有明确要求时切，不碰用户自己切的 tab。
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(import.meta.env.BASE_URL + 'forward-assets/sphere-model.json', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('模型资源缺失：请先运行 scientific/forward/generate_sphere_model.py');
        const data = (await r.json()) as SphereFixture;
        validateSphereFixture(data);
        setFixture(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setFixtureError(String(e));
      });
    return () => controller.abort();
  }, []);

  const handleReferenceChange = (ref: EegReference) => {
    setReference(ref);
    if (!recording) return;
    if (ref.mode === 'electrode' && !recording.channels.some((c) => c.label === ref.label)) {
      return; // 电极不在当前记录的导联内：只记选择，不重算（下次运行再生效）。
    }
    try {
      const processed=reReferenceRecording(recording,ref);
      if(recording.sourceSnapshot&&recording.sourceSnapshot.revision===getPhysicalSource().revision){
        const source=setPhysicalSource({reference:ref});
        processed.sourceSnapshot={...source};
        if(processed.experiment)processed.experiment={
          ...processed.experiment,parameters:{...processed.experiment.parameters,sourceState:source},
        };
      }
      if(recording.templateSnapshot&&recording.templateSnapshot.revision===getTemplateSource().revision){
        setTemplateSource({...getTemplateSource(),reference:ref});
        const source=getTemplateSource();processed.templateSnapshot={...source};
        if(processed.experiment)processed.experiment={...processed.experiment,parameters:{...processed.experiment.parameters,sourceState:source}};
      }
      setRecording(processed);
      setEpochs(null);
    } catch (e) {
      setRunError(String(e));
    }
  };

  const handleMontageChange = (m: MontageKey) => {
    setMontage(m);
    // 电极参考的标签若不在新导联内，下次运行时不再是有效参考：先回平均参考。
    if (reference.mode === 'electrode' && fixture && !fixture.montages[m].includes(reference.label)) {
      setReference({ mode: 'average' });
    }
  };

  const handleRunExperiment = () => {
    if (!fixture || running) return;
    setRunning(true);
    setNativeResult(null);
    setRunError(null);
    // 让“运行中…”先画出来，再跑同步计算（10 秒双源约几百毫秒）。
    window.setTimeout(() => {
      try {
        const { recording: rec, events: evs } = runExperiment({
          fixture,
          durationMs,
          montage,
          reference,
          sourceModel,
          noise,
          seed,
        });
        const session = new ExperimentSession({
          origin: 'independent', solverId: `local-column-${sourceModel}`,
          anatomyId: SPHERE_MODEL_ID, registration: 'unregistered', seed,
        });
        const runId = session.runId;
        session.recordModelTime(runId, rec.timesMs.at(-1) ?? 0);
        session.recordArtifact({
          id: 'raw', runId, kind: 'eeg-raw', tMs: 0,
          sourceId: rec.sourceModelId, methodId: 'runExperiment-sphere-forward-v1',
        });
        session.recordArtifact({
          id: 'events', runId, kind: 'events', tMs: 0,
          sourceId: 'local-column-stimulus-schedule', methodId: 'runExperiment-v1',
        });
        setRecording({ ...rec, provenance: session.provenance,
          experiment: { session: session.getSnapshot(), parameters: {
            durationMs, montage, reference, sourceModel, noise, seed,
            sourcePositionMm: [0, 0, 16], sourceNormalHead: [0, 0, 1],
            secondSourcePositionMm: [16, -16, 16], secondSourceNormalHead: [0, 0, 1],
          } } });
        setEvents(evs.map(event => ({ ...event, runId })));
        setEpochs(null);
        if (!rec.channels.some((c) => c.label === selectedChannel)) {
          setSelectedChannel(rec.channels.some((c) => c.label === 'Pz') ? 'Pz' : rec.channels[0].label);
        }
      } catch (e) {
        setRunError(String(e));
      } finally {
        setRunning(false);
      }
    }, 30);
  };

  const handleEpochsChange = (
    ep: EpochSet, origin: 'raw' | 'independent-late',
    input?: { recording: EegRecording; events: EegEvent[]; parameters: Record<string, unknown> },
  ) => {
    if (origin === 'raw' && recording?.provenance) {
      setEpochs({ ...ep, provenance: recording.provenance, dataRevision:recording.dataRevision??0,
        events: ep.events.map(event => ({ ...event, runId: recording.provenance!.runId })) });
      return;
    }
    if (!input) throw new Error('Independent epochs must include their original Raw and events');
    const session = new ExperimentSession({
      origin: 'independent', solverId: input.recording.sourceModelId,
      anatomyId: input.recording.forwardModelId, registration: 'unregistered',
      seed: input.recording.seed,
    });
    session.recordModelTime(session.runId, Math.max(0, input.recording.timesMs.at(-1) ?? 0));
    for (const kind of ['eeg-raw', 'events', 'epochs'] as const) {
      session.recordArtifact({ id: kind, runId: session.runId, kind, tMs: 0,
        sourceId: input.recording.sourceModelId, methodId: 'late-oddball-v1' });
    }
    const rec = { ...input.recording, provenance: session.provenance,
      experiment: { session: session.getSnapshot(), parameters: input.parameters } };
    // React batches this transaction: every analysis tab receives the same run.
    setRecording(rec);
    setEvents(input.events.map(event => ({ ...event, runId: session.runId })));
    setEpochs({ ...ep, provenance: session.provenance, dataRevision:input.recording.dataRevision??0,
      events: ep.events.map(event => ({ ...event, runId: session.runId })) });
    setSelectedChannel(input.recording.channels[0].label);
    setNativeResult(null);
    const loaded=configurationForRecording(rec);
    setReference(loaded.reference);setMontage(loaded.montage);setNoise(loaded.noise);setSeed(loaded.seed);
    setDurationMs(loaded.durationMs);setSourceModel(loaded.sourceModel);
  };

  // Native 1 ms solver history -> anti-alias FIR -> 250/500 Hz EEG.
  // The TVB-to-sphere source mapping is still explicitly unregistered.
  const handleRunLive = () => {
    const ls = liveSource;
    if (!fixture || !ls || !ls.sim || ls.node === null || !ls.positionMm || liveRunning) return;
    setLiveRunning(true);
    setNativeResult(null);
    setRunError(null);
    window.setTimeout(() => {
      try {
        const sim = ls.sim!;
        const node = ls.node!;
        const samples = sim.getNativeHistory();
        if (samples.length < 1001) throw new Error(text('原生积分记录不足，请等待至少 1 秒。','Wait for at least 1 second of native integration history.'));
        const first = samples[0];
        const { recording: rec, events: evs, t0Ms } = runNativeExperiment({
          sfreqHz:nativeRate,
          fixture,
          samples,
          node,
          baselineE: first.e[node],
          baselineI: first.i[node],
          markers: sim.getMarkers(),
          positionMm: ls.positionMm!,
          montage,
          reference,
          noise,
          seed,
        });
        const upstream = sim.getExperimentSession().provenance;
        const derived = new ExperimentSession({
          origin:'live-derived',solverId:NATIVE_EEG_ID,anatomyId:rec.forwardModelId,
          registration:'unregistered',seed,parentRunId:upstream.runId,clock:'solver-integration-ms',
        });
        const runId = derived.runId;
        // This recording is a 250 Hz interpolation of ≈60 Hz visual
        // snapshots; the actual source clock and rate remain visible.
        derived.recordModelTime(runId, rec.timesMs.at(-1) ?? 0);
        derived.recordArtifact({
          id: 'raw', runId, kind: 'eeg-raw', tMs: 0,
          sourceId: upstream.runId, methodId: NATIVE_EEG_ID,
        });
        setRecording({
          ...rec, experiment: { session: derived.getSnapshot(), parameters: {
            node, positionMm: ls.positionMm, montage, reference, noise, seed,sfreqHz:nativeRate,
            acquisition:rec.acquisition,
            upstreamSession: sim.getExperimentBundle(),
          } }, provenance: {
            ...derived.provenance, upstreamStartMs: t0Ms,

          },
        });
        setEvents(evs.map(event => ({ ...event, runId })));
        setEpochs(null);
        if (!rec.channels.some((c) => c.label === selectedChannel)) {
          setSelectedChannel(rec.channels.some((c) => c.label === 'Pz') ? 'Pz' : rec.channels[0].label);
        }
        const pzIdx = rec.channels.findIndex((c) => c.label === 'Pz');
        const pzPeak =
          pzIdx >= 0 ? Math.max(...rec.dataUv[pzIdx].map(Math.abs)) : NaN;
        setNativeResult({rate:nativeRate,peak:pzPeak});

      } catch (e) {
        setRunError(String(e));
      } finally {
        setLiveRunning(false);
      }
    }, 30);
  };

  const labBody = (
    <div className={inline ? 'screen eeg-lab-inline' : 'modal screen eeg-lab-modal'} data-analysis-run-id={recording?.provenance?.runId} data-source-model={recording?.sourceModelId}>
      <div className="screen-title">EEG 分析实验 — 多导 EEG · 频谱 · ERP · 时频 · 地形 · 源定位</div>
      {recording&&<div className="panel-text" data-testid="active-recording"
        data-montage={recording.montage} data-reference={recording.reference.mode}
        data-revision={recording.dataRevision??0}>
        <strong>{text('当前显示的记录','Displayed recording')}</strong>
        {' · '}{recording.channels.length}{text(' 通道',' channels')}{' · '}{recording.montage}
        {' · '}{recording.sfreqHz} Hz{' · '}{JSON.stringify(recording.reference)}
        {' · '}{text('处理版本','Processing revision')} {recording.dataRevision??0}
        <details><summary>{text('记录来源与参数','Recording source and parameters')}</summary>
          <code>{recording.sourceModelId}</code>
          <pre>{JSON.stringify({sourceModelId:recording.sourceModelId,montage:recording.montage,reference:recording.reference,seed:recording.seed,noise:recording.noise,durationMs:recording.timesMs.at(-1)??0},null,2)}</pre>
        </details>
      </div>}
      <div className="panel-text" role="status" data-testid="configuration-status" data-pending={pending}>
        {text('下方配置用于下一次运行；参考方式可直接作用于当前记录。','Configuration below is for the next run; reference changes can apply to the displayed recording.')}
        {pending&&<strong>{text(' 有待运行的配置，当前波形和导出仍使用上方记录。',' Pending configuration: plots and exports still use the displayed recording above.')}</strong>}
      </div>
      {recording&&<div className="panel-text">
        <RangeControl label={text('原始记录观察时刻','Raw recording observation time')}
          value={atTimeMs} min={recording.timesMs[0]} max={recording.timesMs.at(-1)??0}
          step={1000/recording.sfreqHz} unit="ms" onChange={setAtTimeMs}/>
        {recording.sourceSnapshot&&<p>{text(
          '当前数据来自首页的物理源与明确给定的时间变化。恒定源保持平直；脉冲按记录中的 q(t) 计算，不自动添加脑电振荡。源、电极和组织参数随记录导出。',
          'This record uses the home physical sources and their defined time course. Constant sources remain flat; pulses follow the recorded q(t), without added EEG oscillations. Sources, electrodes and conductor parameters are exported.'
        )}</p>}
      </div>}
      <div className="eeg-tabs" role="tablist" aria-label="EEG 分析">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            className={`chip chip-small${activeTab === t.key ? ' chip-on' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        {!inline && (
          <button type="button" className="chip chip-small eeg-lab-close" onClick={onClose}>
            关闭
          </button>
        )}
      </div>
        {liveSource && (
          <div>
            <p className="panel-text">{text(
              '主网络信号来自每 1 ms 的求解器积分状态，经抗混叠滤波后记录；与画面刷新率无关。TVB 到头部源位置仍是未配准的演示映射。',
              'Network signals use every 1 ms solver state, followed by anti-alias filtering, independently of display rate. TVB-to-head source positions remain an unregistered demonstration mapping.'
            )}</p>
            <label className="panel-text">{text('原生 EEG 采样率','Native EEG sample rate')}
             <Dropdown aria-label={text('原生 EEG 采样率','Native EEG sample rate')} value={nativeRate}
              onChange={e=>setNativeRate(Number(e.target.value) as 250|500)}>
              <option value={250}>250 Hz</option><option value={500}>500 Hz</option>
             </Dropdown>
            </label>
            <button type="button" className="chip chip-small"
              disabled={!fixture || !liveSource.sim || liveSource.node === null || !liveSource.positionMm || liveRunning}
              onClick={handleRunLive}>
              {liveRunning?text('记录中…','Recording…'):text('记录当前脑区 EEG','Record selected region EEG')}
            </button>
            {nativeResult&&<p className="panel-text">{text(
              '原生记录完成：'+nativeResult.rate+' Hz，来自每 1 ms 的积分状态；边缘各舍弃 64 ms。Pz 峰值 ',
              'Native recording: '+nativeResult.rate+' Hz from 1 ms integration states; 64 ms discarded at each edge. Pz peak '
            )}{Number.isFinite(nativeResult.peak)?nativeResult.peak.toFixed(3):'—'} µV</p>}
          </div>
        )}
        {runError && <p className="eeg-error">{runError}</p>}
        {activeTab === 'eeg' && (
          <EegWaveTab
            recording={recording}
            reference={reference}
            onReferenceChange={handleReferenceChange}
            montage={montage}
            onMontageChange={handleMontageChange}
            noise={noise}
            onNoiseChange={setNoise}
            onRunExperiment={handleRunExperiment}
            running={running}
            selectedChannel={selectedChannel}
            onSelectedChannelChange={setSelectedChannel}
            sourceModel={sourceModel}
            onSourceModelChange={setSourceModel}
            seed={seed}
            onSeedChange={setSeed}
            durationMs={durationMs}
            onDurationMsChange={setDurationMs}
            fixtureReady={fixture !== null}
            fixtureError={fixtureError}
          />
        )}
        {activeTab === 'waves' && <WavesTab recording={recording} channel={selectedChannel} />}
        {activeTab === 'erp' && (
          <ErpTab
            recording={recording}
            events={events}
            epochs={epochs}
            onEpochsChange={handleEpochsChange}
            channel={selectedChannel}
          />
        )}
        {activeTab === 'tfr' && <TfrTab epochs={epochs} channel={selectedChannel} />}
        {activeTab === 'topo' && (
          <TopoTab recording={recording} atTimeMs={atTimeMs} onAtTimeMsChange={setAtTimeMs} />
        )}
        {activeTab === 'inverse' && <InverseTab recording={recording} fixture={fixture} atTimeMs={atTimeMs} />}
        {recording?.provenance && (
          <p className="panel-text" data-eeg-run-id={recording.provenance.runId}>
            Raw：{recording.acquisition ? text('主求解器原生积分记录','Native solver integration recording') : recording.provenance.origin === 'live-derived' ? '主仿真快照派生' : '独立神经群体'}
            {' · '}Run {recording.provenance.runId.slice(0, 8)}
            {recording.provenance.parentRunId
              ? ` · 上游 Worker Run ${recording.provenance.parentRunId.slice(0, 8)}` : ''}
            {recording.provenance.effectiveSourceSnapshotHz
              ? ` · 有效来源采样≈${recording.provenance.effectiveSourceSnapshotHz.toFixed(1)} Hz（不是原生 250 Hz EEG）`
              : ''}
            {epochs?.provenance && (
              <span data-epoch-run-id={epochs.provenance.runId}>
                {' · '}ERP/TFR：{epochs.provenance.runId === recording.provenance.runId
                  ? '同一 Raw 运行' : `独立运行 ${epochs.provenance.runId.slice(0, 8)}（不可与 Raw 直接比较）`}
              </span>
            )}
          </p>
        )}
        <p className="panel-text eeg-foot">
          {text('正向模型','Forward model')} {recording?.forwardModelId??SPHERE_MODEL_ID}
          {' · '}{recording?.acquisition?text('主求解器原生积分记录','Native solver integration recording'):
            (recording?.sourceSnapshot||recording?.templateSnapshot)?text('首页手动物理源','Manual physical source from home'):
            recording?.sourceModelId===LIVE_DERIVATION_ID?text('旧版显示快照派生记录','Legacy display-snapshot derivation'):
            text('独立模型实验','Independent model experiment')}
          {' · '}{text('测量噪声与神经源分开记录。','Measurement noise is separate from neural sources.')}

        </p>
    </div>
  );

  if (inline) return labBody;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div role="dialog" aria-label="EEG 分析实验" onClick={(e) => e.stopPropagation()}>
        {labBody}
      </div>
    </div>
  );
}
