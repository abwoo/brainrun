/**
 * PictorialLoop — the one big pictorial loop diagram (design §1) + the
 * control bar, status line, q chip and footer (design §4).
 *
 * A composed pictorial diagram, not all-3D: an SVG (viewBox 0 0 1200 760)
 * carries the nodes, arrows and labels in Fig. 12.1's layout and colours
 * (blue amplifier, green-bordered recording PC, purple stimulus PC,
 * orange "EEG electrodes", green peripheral line, blue "triggers"), and
 * the Three.js head (PictorialHead, passed in as `headView`) sits in the
 * head node as an HTML overlay. The recording PC's screen shows a live
 * waveform thumbnail (the same displayed series, display only,
 * pointer-events none — clicking the PC opens its drill-down).
 *
 * Forward arrows are as drawn in Fig. 12.1. The closed-loop return is a
 * NEW dashed amber path (recording PC -> stimulus PC "分析结果 → 决策"
 * -> stimulator "刺激命令" -> head "刺激电流"), labelled "E 闭环回程",
 * with a legend telling it apart from the blue triggers arrow (event
 * marking, not the return path). Flow animation is driven by the existing
 * benchTrace: the latest hop's node gets a highlight ring + a sub-label
 * with the event, and a pulse dot travels the edge leaving that node —
 * only while a protocol runs; a still picture when nothing runs.
 *
 * Nodes are keyboard-reachable buttons (role="button", Enter/Space).
 * The head node itself is the 3D canvas (brain click = select + brain
 * drill-down; disc/band click = cap drill-down); the SVG frame around
 * it opens the brain drill-down.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import type { BenchTraceEvent } from '../lib/benchTrace';
import type { BenchProtocolId } from '../lib/benchProtocol';
import { drawWaveform } from '../lib/benchWaveform';
import SimulatedHand from './SimulatedHand';

export type PictorialNodeId =
  | 'brain' | 'cap' | 'amplifier' | 'test' | 'experiment' | 'stimulator' | 'peripheral';

export interface PictorialLoopProps {
  headView: ReactNode;
  flowNow: BenchTraceEvent | null;
  protocolRunning: boolean;
  /** Full q line text, or null when the engine has no value yet. */
  qText: string | null;
  qHigh: boolean;
  onQReset: () => void;
  subjectSummary: string;
  waveSeries: number[] | null;
  selectedChannel: string;
  protocolId: BenchProtocolId;
  onProtocolSelect: (id: BenchProtocolId) => void;
  engineReady: boolean;
  notReadyReason: string;
  onRun: () => void;
  onStop: () => void;
  statusText: string;
  onOpenNode: (node: PictorialNodeId) => void;
  handPressing: boolean;
  footerText: string;
}

/** Which node a trace hop lights up, and which edge the pulse travels. */
const HOP_NODE: Record<BenchTraceEvent['hop'], PictorialNodeId> = {
  brain: 'brain',
  amplifier: 'amplifier',
  'test-computer': 'test',
  'experiment-computer': 'experiment',
  stimulator: 'stimulator',
};
const HOP_EDGE: Record<BenchTraceEvent['hop'], string> = {
  brain: 'M282,170 H478',
  amplifier: 'M722,180 H878',
  'test-computer': 'M1020,302 V540 H722',
  'experiment-computer': 'M600,622 V680 H432',
  stimulator: 'M355,638 V300 H202 V282',
};

const PROTOCOLS: BenchProtocolId[] = ['single-pulse', 'oddball', 'flicker', 'closed-loop'];

export default function PictorialLoop(props: PictorialLoopProps) {
  const {
    headView, flowNow, protocolRunning, qText, qHigh, onQReset,
    subjectSummary, waveSeries, selectedChannel, protocolId,
    onProtocolSelect, engineReady, notReadyReason, onRun, onStop,
    statusText, onOpenNode, handPressing, footerText,
  } = props;
  const { locale, t } = useI18n();
  const text = (zh: string, en: string) => (locale === 'zh-CN' ? zh : en);

  const thumbRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = thumbRef.current;
    if (!canvas || !waveSeries) return;
    drawWaveform(canvas, waveSeries, { peakLabel: false });
  }, [waveSeries]);

  const activeNode: PictorialNodeId | null = flowNow ? HOP_NODE[flowNow.hop] : null;
  const activeEdge: string | null = flowNow ? HOP_EDGE[flowNow.hop] : null;
  const flowLabel = flowNow ? `${flowNow.label} · t=${Math.round(flowNow.tMs)} ms` : null;

  const nodeProps = (node: PictorialNodeId, label: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    'data-testid': `pict-node-${node}`,
    className: `pict-node${activeNode === node ? ' pict-node-active' : ''}`,
    onClick: () => onOpenNode(node),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpenNode(node);
      }
    },
  });

  const flowSub = (node: PictorialNodeId, x: number, y: number, anchor: 'middle' | 'start' = 'middle') =>
    activeNode === node && flowLabel ? (
      <text x={x} y={y} textAnchor={anchor} className="pict-flow-sub">{flowLabel}</text>
    ) : null;

  return (
    <div className="pict" data-testid="pictorial-loop">
      <div className="pict-canvas-wrap">
        <svg className="pict-svg" viewBox="0 0 1200 760" role="img"
          aria-label={text('闭环实验回路图', 'Closed-loop experiment diagram')}>
          <defs>
            <marker id="pict-arrow-orange" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L9,3 L0,6 Z" fill="#ff9a3c" />
            </marker>
            <marker id="pict-arrow-blue" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L9,3 L0,6 Z" fill="#4fb6f2" />
            </marker>
            <marker id="pict-arrow-green" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L9,3 L0,6 Z" fill="#2fd47a" />
            </marker>
            <marker id="pict-arrow-amber" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
              <path d="M0,0 L9,3 L0,6 Z" fill="#ffb340" />
            </marker>
          </defs>

          {/* ===== forward arrows (as drawn in Fig. 12.1) ===== */}
          <path d="M282,170 H478" className="pict-edge pict-edge-eeg" markerEnd="url(#pict-arrow-orange)" />
          <text x={380} y={152} textAnchor="middle" className="pict-edge-label">EEG electrodes</text>
          <path d="M722,180 H878" className="pict-edge pict-edge-usb" markerEnd="url(#pict-arrow-orange)" />
          <text x={800} y={162} textAnchor="middle" className="pict-edge-label">USB</text>
          <path d="M600,458 V268" className="pict-edge pict-edge-triggers" markerEnd="url(#pict-arrow-blue)" />
          <text x={614} y={360} className="pict-edge-label">triggers</text>
          <path d="M185,450 V350 H320 V200 H478" className="pict-edge pict-edge-periph" markerEnd="url(#pict-arrow-green)" />
          <path d="M150,350 H185" className="pict-edge pict-edge-periph" />
          <text x={255} y={338} textAnchor="middle" className="pict-edge-label">
            {text('外周生理传感器（接口预留）', 'Peripheral sensors (reserved)')}
          </text>

          {/* ===== closed-loop return path (NEW, dashed amber) ===== */}
          <path d="M1020,302 V540 H722" className="pict-edge pict-edge-return" markerEnd="url(#pict-arrow-amber)" />
          <text x={1032} y={425} className="pict-edge-label pict-edge-label-return">
            {text('分析结果 → 决策', 'Analysis → decision')}
          </text>
          <path d="M600,622 V680 H432" className="pict-edge pict-edge-return" markerEnd="url(#pict-arrow-amber)" />
          <text x={516} y={668} textAnchor="middle" className="pict-edge-label pict-edge-label-return">
            {text('刺激命令', 'Stimulus command')}
          </text>
          <path d="M355,638 V300 H202 V282" className="pict-edge pict-edge-return" markerEnd="url(#pict-arrow-amber)" />
          <text x={368} y={470} className="pict-edge-label pict-edge-label-return">
            {text('刺激电流', 'Stimulus current')}
          </text>
          <g className="pict-step-badge">
            <circle cx={1020} cy={322} r={13} />
            <text x={1020} y={327} textAnchor="middle">E</text>
          </g>
          <text x={1040} y={327} className="pict-edge-label pict-edge-label-return">
            {text('闭环回程', 'Closed-loop return')}
          </text>

          {/* ===== flow pulse: only while a protocol runs ===== */}
          {protocolRunning && flowNow && activeEdge && (
            <circle key={flowNow.seq} r={6} className="pict-pulse" fill="#ffb340">
              <animateMotion dur="1.4s" repeatCount="indefinite" path={activeEdge} />
            </circle>
          )}

          {/* ===== head node frame (the 3D canvas sits on top of this) ===== */}
          <g {...nodeProps('brain', t('bench.brain'))}>
            <rect x={40} y={60} width={240} height={220} rx={10} className="pict-node-box" />
            <text x={46} y={52} className="pict-step-letter">A</text>
            <text x={160} y={52} textAnchor="middle" className="pict-node-label">
              {text('大脑', 'Brain')}
            </text>
          </g>
          <g className="pict-step-badge">
            <circle cx={292} cy={72} r={11} />
            <text x={292} y={76} textAnchor="middle">3</text>
          </g>
          {flowSub('brain', 160, 302)}

          {/* ===== peripheral sensors: heart + lung icons ===== */}
          <g {...nodeProps('peripheral', text('外周生理传感器', 'Peripheral physiology sensors'))}>
            <g fill="none" stroke="#d7e5ef" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
              <path d="M120,332 C110,320 94,328 98,344 C101,356 114,364 120,370 C126,364 139,356 142,344 C146,328 130,320 120,332 Z" />
              <path d="M104,420 C96,420 90,430 90,444 C90,458 98,466 106,466 C112,466 114,458 114,448 L114,432 Z" />
              <path d="M136,420 C144,420 150,430 150,444 C150,458 142,466 134,466 C128,466 126,458 126,448 L126,432 Z" />
              <path d="M120,412 L120,430" />
            </g>
            <text x={160} y={352} className="pict-node-label">{text('心脏', 'Heart')}</text>
            <text x={160} y={452} className="pict-node-label">{text('肺', 'Lungs')}</text>
          </g>

          {/* ===== amplifier ===== */}
          <g {...nodeProps('amplifier', t('bench.amplifier'))}>
            <rect x={480} y={120} width={240} height={140} rx={10} className="pict-node-box pict-node-amplifier" />
            <text x={486} y={112} className="pict-step-letter">B</text>
            <text x={600} y={160} textAnchor="middle" className="pict-node-title">EEG amplifier</text>
            <text x={600} y={184} textAnchor="middle" className="pict-node-label">{t('bench.amplifier')}</text>
            <g stroke="#9fc8ff" strokeWidth={2} fill="none">
              <circle cx={540} cy={220} r={10} />
              <circle cx={600} cy={220} r={10} />
              <circle cx={660} cy={220} r={10} />
            </g>
            <text x={600} y={248} textAnchor="middle" className="pict-node-sub">
              {text('滤波 · 放大 · 转数字', 'Filter · amplify · digitise')}
            </text>
          </g>
          {flowSub('amplifier', 600, 282)}

          {/* ===== recording PC (test computer) ===== */}
          <g {...nodeProps('test', t('bench.testComputer'))}>
            <rect x={880} y={100} width={280} height={200} rx={10} className="pict-node-box pict-node-test" />
            <text x={886} y={92} className="pict-step-letter">D</text>
            <rect x={900} y={125} width={240} height={140} rx={4} className="pict-screen" />
            <text x={1020} y={292} textAnchor="middle" className="pict-node-label">
              {t('bench.testComputer')} · {text('记录', 'Recording')}
            </text>
            <rect x={1000} y={300} width={40} height={14} className="pict-stand" />
            <rect x={960} y={314} width={120} height={6} rx={3} className="pict-stand" />
          </g>
          <g className="pict-step-badge">
            <circle cx={868} cy={112} r={11} />
            <text x={868} y={116} textAnchor="middle">3</text>
          </g>
          {flowSub('test', 1020, 340)}

          {/* ===== stimulus PC (experiment computer) + keyboard + hand ===== */}
          <g {...nodeProps('experiment', t('bench.experimentComputer'))}>
            <rect x={480} y={460} width={240} height={160} rx={10} className="pict-node-box pict-node-experiment" />
            <text x={486} y={452} className="pict-step-letter">C</text>
            <rect x={500} y={480} width={200} height={120} rx={4} className="pict-screen" />
            <g stroke="#ffb829" strokeWidth={2.5} fill="none" strokeLinecap="round">
              <circle cx={600} cy={540} r={24} />
              {Array.from({ length: 8 }, (_, i) => {
                const a = (i * Math.PI) / 4;
                return (
                  <line key={i}
                    x1={600 + Math.cos(a) * 32} y1={540 + Math.sin(a) * 32}
                    x2={600 + Math.cos(a) * 42} y2={540 + Math.sin(a) * 42} />
                );
              })}
            </g>
            <text x={600} y={614} textAnchor="middle" className="pict-node-label">
              {t('bench.experimentComputer')} · {text('刺激', 'Stimulus')}
            </text>
            <rect x={580} y={620} width={40} height={12} className="pict-stand" />
            <rect x={540} y={632} width={120} height={6} rx={3} className="pict-stand" />
            {/* keyboard */}
            <rect x={500} y={648} width={200} height={56} rx={6} className="pict-keyboard" />
            <g fill="#0d1824" stroke="#2b4254" strokeWidth={1}>
              <rect x={508} y={654} width={24} height={12} rx={2} />
              <rect x={536} y={654} width={24} height={12} rx={2} />
              <rect x={564} y={654} width={24} height={12} rx={2} />
              <rect x={592} y={654} width={24} height={12} rx={2} />
              <rect x={620} y={654} width={24} height={12} rx={2} />
              <rect x={648} y={654} width={24} height={12} rx={2} />
              <rect x={676} y={654} width={16} height={12} rx={2} />
              <rect x={508} y={670} width={24} height={12} rx={2} />
              <rect x={536} y={670} width={24} height={12} rx={2} />
              <rect x={564} y={670} width={24} height={12} rx={2} />
              <rect x={592} y={670} width={24} height={12} rx={2} />
              <rect x={620} y={670} width={24} height={12} rx={2} />
              <rect x={648} y={670} width={24} height={12} rx={2} />
              <rect x={676} y={670} width={16} height={12} rx={2} />
            </g>
            <rect x={560} y={686} width={80} height={12} rx={3}
              className={handPressing ? 'pict-spacebar pict-spacebar-pressed' : 'pict-spacebar'} />
          </g>
          <g className="pict-step-badge">
            <circle cx={492} cy={472} r={11} />
            <text x={492} y={476} textAnchor="middle">1</text>
          </g>
          {flowSub('experiment', 730, 470, 'start')}
          <SimulatedHand
            x={560} y={606} pressing={handPressing}
            onOpen={() => onOpenNode('experiment')}
            label={text('模拟受试者的手（仿真）', 'Simulated subject hand (simulation)')}
          />
          <text x={600} y={722} textAnchor="middle" className="pict-node-sub">
            {text('模拟受试者（仿真）——按键由实验电脑驱动，不是真人。', 'Simulated subject (simulation) — key presses are driven by the experiment computer, not a real person.')}
          </text>

          {/* ===== stimulator (on the closed-loop return path) ===== */}
          <g {...nodeProps('stimulator', t('bench.stimulator'))}>
            <rect x={280} y={640} width={150} height={80} rx={10} className="pict-node-box pict-node-stimulator" />
            <path d="M362,656 L344,684 L356,684 L348,706 L372,676 L360,676 L368,656 Z"
              fill="#ffb340" stroke="#ffb340" strokeWidth={1} strokeLinejoin="round" />
            <text x={398} y={684} className="pict-node-label">{t('bench.stimulator')}</text>
          </g>
          {flowSub('stimulator', 355, 740)}

          {/* ===== legend ===== */}
          <text x={1156} y={748} textAnchor="end" className="pict-legend">
            {text('实线 = 信号正向；虚线琥珀 = 闭环回程；蓝箭头 triggers = 事件标记',
              'Solid = forward signal; dashed amber = closed-loop return; blue triggers = event marking')}
          </text>
        </svg>

        {/* Three.js head node (HTML overlay, same coords as the SVG frame) */}
        <div className="pict-head-slot">{headView}</div>

        {/* Recording-PC screen thumbnail (display only) */}
        <div className="pict-thumb" aria-hidden="true">
          <canvas ref={thumbRef} aria-label={`${selectedChannel} ${t('bench.waveform')}`} />
        </div>

        {/* q chip under the head node */}
        <div className="pict-q">
          {qText !== null && (
            <p className="bench-q" data-testid="bench-brain-q">{qText}</p>
          )}
          {qHigh && (
            <p className="bench-q-high" data-testid="bench-q-high-state">
              {t('bench.qHighState')}{' '}
              <button type="button" className="ui-button" onClick={onQReset}
                disabled={!engineReady} title={!engineReady ? notReadyReason : undefined}>
                {t('bench.qHighStateReset')}
              </button>
            </p>
          )}
          <p className="pict-q-subject">{subjectSummary}</p>
        </div>
      </div>

      {/* ===== control bar: 4 protocol buttons + run/stop, one tap away ===== */}
      <div className="bench-strip">
        <div className="bench-protocols" role="group" aria-label={text('协议', 'Protocol')}>
          {PROTOCOLS.map((id) => (
            <button key={id} type="button" className="bench-protocol-btn"
              aria-pressed={protocolId === id}
              disabled={!engineReady || protocolRunning}
              title={!engineReady ? notReadyReason : protocolRunning ? text('协议运行中，停下后再换', 'Stop the protocol before switching') : undefined}
              onClick={() => onProtocolSelect(id)}>
              <span className="bench-protocol-name">{t(`bench.protocol.${id}`)}</span>
              <span className="bench-protocol-desc">{t(`bench.protocolDesc.${id}`)}</span>
            </button>
          ))}
        </div>
        <div className="bench-strip-run">
          <button className="ui-button ui-button-primary" type="button"
            onClick={onRun} disabled={!engineReady || protocolRunning}
            title={!engineReady ? notReadyReason : undefined}>
            <span className="pict-step-badge-inline">2</span> {t('bench.runProtocol')}
          </button>
          <button className="ui-button" type="button"
            onClick={onStop} disabled={!engineReady || !protocolRunning}>
            {t('bench.stopProtocol')}
          </button>
        </div>
        <p className="bench-status" data-testid="bench-status-line" role="status">{statusText}</p>
      </div>

      <footer className="bench-footnote">{footerText}</footer>
    </div>
  );
}
