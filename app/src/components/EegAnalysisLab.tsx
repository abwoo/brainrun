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
  runLiveExperiment,
  setLiveRecordingStore,
  type SourceModel,
} from '../lib/eegRecording';
import type { SimClient } from '../lib/simClient';
import { ExperimentSession, makeDerivedSession } from '../lib/experimentSession';
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

  const configuration:EegRunConfiguration={sourceModel,durationMs,montage,reference,noise,seed};
  const pending=!!recording&&(!configurationsEqual(configuration,configurationForRecording(recording))
    ||recording.provenance?.origin==='live-derived'||recording.sourceModelId.includes('late'));
  // PR8-LINK：记录一变就写回 store（两路都进同一份 store；挂载时已从 store 恢复）。
  useEffect(() => {
    if (recording) setLiveRecordingStore({ recording, events, epochs,
      workspace:{configuration:{sourceModel,durationMs,montage,reference,noise,seed},selectedChannel,atTimeMs} });
  }, [recording, events, epochs,sourceModel,durationMs,montage,reference,noise,seed,selectedChannel,atTimeMs]);

  // PR8-LINK 直播推导的状态（与独立柱模型的 running 分开）。
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(
    storedLive?.recording?.sourceModelId === LIVE_DERIVATION_ID
      ? '当前记录来自直播推导（关弹窗前跑的，还在）。'
      : null,
  );

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
      setRecording(reReferenceRecording(recording, ref));
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
    const loaded=configurationForRecording(rec);
    setReference(loaded.reference);setMontage(loaded.montage);setNoise(loaded.noise);setSeed(loaded.seed);
    setDurationMs(loaded.durationMs);setSourceModel(loaded.sourceModel);
    setLiveStatus(null);
  };

  // PR8-LINK：从直播推导记录——读 SimClient 的 60 Hz 快照历史（最近约
  // 10 s）+ 真实脉冲标记，经 runLiveExperiment 走同一条 q→leadfield
  // 管线。改 G / 换选区 / 改刺激强度后重跑，记录跟着变（数值见
  // tests/pr8/methods-link.test.mjs 的 L1–L3）；源模型与种子对此路无效
  //（用的是直播 WC 网络，不是独立柱模型），时长取历史实际跨度。
  const handleRunLive = () => {
    const ls = liveSource;
    if (!fixture || !ls || !ls.sim || ls.node === null || !ls.positionMm || liveRunning) return;
    setLiveRunning(true);
    setRunError(null);
    setLiveStatus(null);
    window.setTimeout(() => {
      try {
        const sim = ls.sim!;
        const node = ls.node!;
        const samples = sim.getSnapshotHistory();
        if (samples.length < 2) throw new Error('直播快照历史不足：等仿真跑满 1 秒再推导');
        const first = samples[0];
        const { recording: rec, events: evs, snapshotHz, t0Ms } = runLiveExperiment({
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
        const derived = makeDerivedSession(upstream, LIVE_DERIVATION_ID);
        const runId = derived.runId;
        // This recording is a 250 Hz interpolation of ≈60 Hz visual
        // snapshots; the actual source clock and rate remain visible.
        derived.recordModelTime(runId, rec.timesMs.at(-1) ?? 0);
        derived.recordArtifact({
          id: 'raw', runId, kind: 'eeg-raw', tMs: 0,
          sourceId: upstream.runId, methodId: LIVE_DERIVATION_ID,
        });
        setRecording({
          ...rec, experiment: { session: derived.getSnapshot(), parameters: {
            node, positionMm: ls.positionMm, montage, reference, noise, seed,
            upstreamSession: sim.getExperimentBundle(),
          } }, provenance: {
            ...derived.provenance, upstreamStartMs: t0Ms,
            effectiveSourceSnapshotHz: snapshotHz,
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
        const spanS = rec.timesMs.length > 0 ? rec.timesMs[rec.timesMs.length - 1] / 1000 : 0;
        setLiveStatus(
          `直播推导完成：窗口 ${spanS.toFixed(1)} s（仿真 ${(t0Ms / 1000).toFixed(1)}–${((t0Ms + rec.timesMs[rec.timesMs.length - 1]) / 1000).toFixed(1)} s）· ` +
            `快照 ${samples.length} 条（实测 ${snapshotHz.toFixed(1)} Hz）· 事件 ${evs.length} 个（真实脉冲）· ` +
            `Pz 峰值 ${Number.isFinite(pzPeak) ? pzPeak.toFixed(3) : '—'} µV · 源位置钳制进球网格。`,
        );
      } catch (e) {
        setRunError(String(e));
      } finally {
        setLiveRunning(false);
      }
    }, 30);
  };

  const labBody = (
    <div className={inline ? 'screen eeg-lab-inline' : 'modal screen eeg-lab-modal'} data-analysis-run-id={recording?.provenance?.runId}>
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
            <p className="panel-text">
              直播推导：{liveSource.node === null
                ? '未选脑区——先在主界面点一个脑区，再从直播推导记录。'
                : `源脑区 #${liveSource.node} ${liveSource.regionLabel ?? ''}（中心 ${liveSource.positionMm ? liveSource.positionMm.map((v) => v.toFixed(1)).join(', ') : '—'} mm，TVB 坐标、未配准 HEAD，钳制进 ±48 mm 球网格）`}
              · 60 Hz 快照 → 线性插值 250 Hz（有效采样率 60 Hz，4 ms 网格上的高频成分为插值产物，不是实测）
              · 基线取窗口首样本 E/I · 事件只取真实脉冲标记 · 源模型与种子对此路无效（用直播 WC 网络）。
            </p>
            <button
              type="button"
              className="chip chip-small"
              disabled={!fixture || !liveSource.sim || liveSource.node === null || !liveSource.positionMm || liveRunning}
              onClick={handleRunLive}
              title="从约 60 Hz 可视化快照构造近似 EEG 记录；不是 250 Hz 原生采样。late ERP 与地形右侧物理源仍可能独立，P0-3/4 待完成。"
            >
              {liveRunning ? '推导中…' : '从直播推导记录'}
            </button>
            {liveStatus && <p className="panel-text">{liveStatus}</p>}
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
        {activeTab === 'inverse' && <InverseTab recording={recording} fixture={fixture} />}
        {recording?.provenance && (
          <p className="panel-text" data-eeg-run-id={recording.provenance.runId}>
            Raw：{recording.provenance.origin === 'live-derived' ? '主仿真快照派生' : '独立神经群体'}
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
          正向模型 {SPHERE_MODEL_ID} · 原始记录、事件与试次同步更新；
          地形页右侧正向采样图另用独立偶极子 ·
          噪声是伪迹，不作神经源活动解释。
          {recording
            ? recording.sourceModelId === LIVE_DERIVATION_ID
              ? '当前记录来源：直播推导（直播 WC 网络快照流，60 Hz 快照插值到 250 Hz）。'
              : '当前记录来源：独立柱模型（种子/源模型跑出来的，与直播无关）。'
            : '尚未运行实验。'}
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
