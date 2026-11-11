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
import {
  SPHERE_MODEL_ID,
  validateSphereFixture,
  type MontageKey,
  type SphereFixture,
} from '../lib/sphereForward';
import type { EegEvent, EegRecording, EegReference, EpochSet, NoiseParams } from '../lib/eegData';
import {
  reReferenceRecording,
  runExperiment,
  type SourceModel,
} from '../lib/eegRecording';
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

export default function EegAnalysisLab({ onClose }: { onClose: () => void }) {
  const [fixture, setFixture] = useState<SphereFixture | null>(null);
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  const [recording, setRecording] = useState<EegRecording | null>(null);
  const [events, setEvents] = useState<EegEvent[]>([]);
  const [epochs, setEpochs] = useState<EpochSet | null>(null);
  const [selectedChannel, setSelectedChannel] = useState('Pz');
  const [reference, setReference] = useState<EegReference>({ mode: 'average' });
  const [montage, setMontage] = useState<MontageKey>('10-20');
  const [noise, setNoise] = useState<NoiseParams | null>(null);
  const [sourceModel, setSourceModel] = useState<SourceModel>('wc');
  const [seed, setSeed] = useState(1);
  const [durationMs, setDurationMs] = useState(10000);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EegLabTab>('eeg');
  const [atTimeMs, setAtTimeMs] = useState(400);

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
        setRecording(rec);
        setEvents(evs);
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal screen eeg-lab-modal"
        role="dialog"
        aria-label="EEG 分析实验"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="screen-title">EEG 分析实验 — 多导 EEG · 频谱 · ERP · 时频 · 地形 · 源定位</div>
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
          <button type="button" className="chip chip-small eeg-lab-close" onClick={onClose}>
            关闭
          </button>
        </div>
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
            onEpochsChange={setEpochs}
            channel={selectedChannel}
          />
        )}
        {activeTab === 'tfr' && <TfrTab epochs={epochs} channel={selectedChannel} />}
        {activeTab === 'topo' && (
          <TopoTab recording={recording} atTimeMs={atTimeMs} onAtTimeMsChange={setAtTimeMs} />
        )}
        {activeTab === 'inverse' && <InverseTab recording={recording} fixture={fixture} />}
        <p className="panel-text eeg-foot">
          正向模型 {SPHERE_MODEL_ID} · 同一份 EEG 记录供六个 tab 共用 ·
          噪声是伪迹，不作神经源活动解释。
        </p>
      </div>
    </div>
  );
}
