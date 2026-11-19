import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';

import { setTextLocale } from './localizedText';

export type Locale = 'zh-CN' | 'en-US';
export const LOCALE_STORAGE_KEY = 'brainrun.locale.v1';
const zh = {
  'lang.label': '语言', 'lang.zh': '简体中文', 'lang.en': 'English',

  'mode.play': '互动', 'mode.waves': '频谱', 'mode.eeg': 'EEG', 'mode.explore': '探索',
  'mode.playDesc': '触碰大脑：施加输入并观察神经网络响应',
  'mode.wavesDesc': '探索振荡与频谱，区分外部驱动和自发节律',
  'mode.eegDesc': '探索 EEG、ERP、时频、头皮电位与源定位',
  'mode.exploreDesc': '探索脑区、图谱、坐标与细胞级模型',
  'shell.subtitle': '交互式脑科学仿真',
  'shell.more': '更多', 'shell.less': '收起', 'shell.scenarios': '一键场景',
  'shell.pause': '暂停', 'shell.resume': '继续',
  'shell.loading': '加载中', 'shell.running': '运行中', 'shell.paused': '已暂停',
  'shell.stopped': '已停止',
  'shell.connections': '连接', 'shell.reset': '重置',
  'shell.brainModel': '头部物理', 'shell.eegLab': 'EEG 分析',
  'shell.dipole': '偶极子', 'shell.cellular': '细胞实验',
  'shell.stimulation': '刺激实验', 'shell.experiments': '对照实验',
  'shell.modelInfo': '模型说明',
  'scene.title': '3D 实时大脑', 'scene.absolute': '绝对活动 E',
  'scene.delta': '活动变化 ΔE', 'scene.rotation': '自动旋转',
  'scene.on': '开', 'scene.off': '关',
  'scene.loading': '正在加载脑数据…',
  'scene.hoverHint': '单击脑区施加刺激；拖动旋转；长按连续刺激',
  'workspace.focus': '专注 3D', 'workspace.exitFocus': '显示面板',
  'workspace.width': '3D 区域宽度', 'workspace.resetLayout': '恢复布局',
  'workspace.advanced': '高级界面与科学参数',
  'science.noRegistration': 'TVB 演示网络尚未配准到真实人类头部模型',
  'bench.title': '闭环实验台', 'bench.subtitle': '设计实验 → 组成被试 → 运行 → 看大脑与波形',
  'bench.backToPhysics': '返回物理模型',
  'bench.loop': '回路图', 'bench.brain': '大脑', 'bench.cap': '脑电帽',
  'bench.amplifier': '放大器', 'bench.testComputer': '测试电脑',
  'bench.experimentComputer': '实验电脑', 'bench.stimulator': '刺激器',
  'bench.trace': '回路追踪', 'bench.signalDetection': '信号检测',
  'bench.protocol.single-pulse': '单脉冲', 'bench.protocol.oddball': '稀有刺激',
  'bench.protocol.flicker': '闪烁', 'bench.protocol.closed-loop': '闭环触发',
  'bench.protocolDesc.single-pulse': '发一次刺激，看脑电怎么变',
  'bench.protocolDesc.oddball': '重复刺激里偶尔混一个不一样的',
  'bench.protocolDesc.flicker': '按固定频率闪，看脑电跟不跟得上',
  'bench.protocolDesc.closed-loop': '脑电一到阈值就自动刺激',
  'bench.protocol.notStarted': '未开始',
  'bench.status.notReady': '引擎启动中，稍等一下。',
  'bench.status.notStarted': '还没开始。先在实验电脑里设计实验、组成被试，再点“运行协议”。',
  'bench.status.running': '正在运行', 'bench.status.runningAfter': '，信号在回路里走。',
  'bench.status.paused': '已暂停，整个仿真都停住了。',
  'bench.status.stopped': '已停止。再点“运行协议”可以重跑。',
  'bench.diagnostics': '详情 / 诊断', 'bench.diagnosticsHide': '收起详情',
  'bench.diagnosticsHint': '这里是给调试看的细节，平时不用管。',
  'bench.qLabel': '大脑 q（模型估计）',
  'bench.qHighState': '大脑现在处在一个持续活跃的高状态，q 几乎不动是正常的，不是卡住了。求解器仍在运行。',
  'bench.qHighStateReset': '重置，回到安静状态',
  'bench.runProtocol': '运行协议', 'bench.stopProtocol': '停止协议',
  'bench.notReady': '引擎未就绪', 'bench.sendPulse': '发送一次刺激',
  'bench.clearTrace': '清空追踪', 'bench.refreshAcquisition': '重新采集',
  'bench.updateRecording': '更新记录', 'bench.exportJson': '导出 JSON',
  'bench.exportCsv': '导出 CSV', 'bench.applyBandpass': '应用带通',
  'bench.waveform': '实时 EEG 波形', 'bench.recording': '记录',
  'bench.footer': '教学仿真 · 幅度缺口仍在（模型 EEG 幅度与真实 EEG 约 51 倍差距、基线与 alpha 结构缺口未解决），显示来自模型求解结果，不是临床测量。',
  'bench.drilldownBack': '← 回到回路图',
  'bench.peripheralReserved': '外周生理传感器（心电 / 呼吸）接口预留，暂无真实信号。本版本不显示心肺数据，也不模拟。',
  'bench.drill.manualStim': '手动刺激（次要入口）',
  'bench.drill.manualStimNote': '主流程是在实验电脑里设计实验、组成被试、运行；这里只作单次手动刺激。',
  'bench.drill.step1': '① 设计实验',
  'bench.drill.step2': '② 组成被试',
  'bench.drill.step3': '③ 运行与观察',
  'bench.drill.handNote': '手在稀有刺激试次的响应时按下。',
  'bench.drill.brainNote': '点击大脑选择一个脑区；拖动旋转，滚轮缩放。',
  'bench.drill.returnPathNote': '刺激器在闭环回程上：实验电脑决策 → 刺激器 → 大脑；triggers 箭头是另外一回事（事件打点进放大器）。',
  'bench.drill.amplifierNote': 'B：模拟信号滤波、放大、转数字。',
  'bench.composer.title': '组成被试',
  'bench.composer.modelVariant': '这里拼出的被试是模型参数组合，不是真实的人，也不是临床诊断。同一个实验，换一组参数，反应就不一样。',
  'bench.composer.modelVariantShort': '模型参数组合，非临床诊断',
  'bench.composer.groupA': '兴奋 / 抑制（E/I 平衡）',
  'bench.composer.groupB': '背景活动与节律',
  'bench.composer.groupC': '认知与行为',
  'bench.composer.g': '脑区互相带动的强度',
  'bench.composer.gHint': '越高，网络越容易整体同步、越容易翻进高活动态。',
  'bench.composer.cEi': '抑制的强度',
  'bench.composer.cEiHint': '越低，抑制越弱、网络越容易兴奋。滑到 3.2 以下时已接近模型稳定边界。',
  'bench.composer.background': '背景活动',
  'bench.composer.ouSigma': '背景噪声的起伏',
  'bench.composer.ouSigmaHint': '0.12 以上接近锁定边界。',
  'bench.composer.extSineAmp': '振荡驱动的幅度',
  'bench.composer.extSineAmpHint': '只在振荡模式下起作用。',
  'bench.composer.extSineFreqHz': '振荡驱动的频率',
  'bench.composer.extSineFreqHzHint': '只在振荡模式下起作用。',
  'bench.composer.rtMin': '反应时下限',
  'bench.composer.rtMax': '反应时上限',
  'bench.composer.seed': '随机种子',
  'bench.composer.resetSubject': '恢复默认被试',
  'bench.composer.directionsTitle': '常说的“癫痫的各个方向”，在这个模型里没有一颗对应的旋钮；能表达的只是下面四个参数方向。',
  'bench.composer.summaryLabel': '当前组合',
} as const;
export type MessageKey = keyof typeof zh;
const en: Record<MessageKey, string> = {
  'lang.label': 'Language', 'lang.zh': '简体中文', 'lang.en': 'English',

  'mode.play': 'Network', 'mode.waves': 'Spectra', 'mode.eeg': 'Signals', 'mode.explore': 'Atlas',
  'mode.playDesc': 'Touch the brain, apply input and observe a real network response',
  'mode.wavesDesc': 'Explore oscillations and spectra, distinguishing driven from spontaneous rhythms',
  'mode.eegDesc': 'Explore EEG, ERP, time-frequency and source localization',
  'mode.exploreDesc': 'Explore regions, atlases, coordinates and cellular models',
  'shell.subtitle': 'Advanced model workbench',
  'shell.more': 'More', 'shell.less': 'Less',
  'shell.scenarios': 'Quick experiments',
  'shell.pause': 'Pause', 'shell.resume': 'Resume',
  'shell.loading': 'Loading', 'shell.running': 'Running', 'shell.paused': 'Paused',
  'shell.stopped': 'Stopped',
  'shell.connections': 'Connections', 'shell.reset': 'Reset',
  'shell.brainModel': 'Head physics', 'shell.eegLab': 'EEG analysis',
  'shell.dipole': 'Dipole', 'shell.cellular': 'Cellular lab',
  'shell.stimulation': 'Stimulation lab', 'shell.experiments': 'Comparisons',
  'shell.modelInfo': 'Model info',
  'scene.title': '3D LIVE BRAIN', 'scene.absolute': 'Absolute activity E',
  'scene.delta': 'Activity change ΔE', 'scene.rotation': 'Auto-rotate',
  'scene.on': 'On', 'scene.off': 'Off', 'scene.loading': 'Loading brain data…',
  'scene.hoverHint': 'Click a region to stimulate; drag to orbit; press and hold to apply input',
  'workspace.focus': 'Focus on 3D', 'workspace.exitFocus': 'Show panels',
  'workspace.width': '3D stage width', 'workspace.resetLayout': 'Reset layout',
  'workspace.advanced': 'Advanced controls and science settings',
  'science.noRegistration': 'The TVB demo connectome is not registered to human head anatomy',
  'bench.title': 'Closed-loop bench', 'bench.subtitle': 'Design the experiment → assemble the subject → run → watch the brain and the waveform',
  'bench.backToPhysics': 'Back to physics model',
  'bench.loop': 'Loop diagram', 'bench.brain': 'Brain', 'bench.cap': 'Cap',
  'bench.amplifier': 'Amplifier', 'bench.testComputer': 'Test computer',
  'bench.experimentComputer': 'Experiment computer', 'bench.stimulator': 'Stimulator',
  'bench.trace': 'Loop trace', 'bench.signalDetection': 'Signal detection',
  'bench.protocol.single-pulse': 'Single pulse', 'bench.protocol.oddball': 'Oddball',
  'bench.protocol.flicker': 'Flicker', 'bench.protocol.closed-loop': 'Closed-loop trigger',
  'bench.protocolDesc.single-pulse': 'One stimulus; watch the EEG change',
  'bench.protocolDesc.oddball': 'Repeating stimuli with an occasional odd one out',
  'bench.protocolDesc.flicker': 'Flashing at a fixed rate; watch the EEG follow',
  'bench.protocolDesc.closed-loop': 'Stimulates automatically when the EEG hits a threshold',
  'bench.protocol.notStarted': 'Not started',
  'bench.status.notReady': 'Starting the engine — one moment…',
  'bench.status.notStarted': 'Not started yet. Design the experiment and assemble the subject in the experiment computer first, then press “Run protocol”.',
  'bench.status.running': 'Running', 'bench.status.runningAfter': ' — the signal is going around the loop.',
  'bench.status.paused': 'Paused — the whole simulation is stopped.',
  'bench.status.stopped': 'Stopped. Press “Run protocol” to run it again.',
  'bench.diagnostics': 'Details / diagnostics', 'bench.diagnosticsHide': 'Hide details',
  'bench.diagnosticsHint': 'Details for debugging; you can ignore this in normal use.',
  'bench.qLabel': 'Brain q (model estimate)',
  'bench.qHighState': 'The brain is in a sustained high-activity state — q barely moving is normal, not a freeze. The solver is still running.',
  'bench.qHighStateReset': 'Reset to quiet state',
  'bench.runProtocol': 'Run protocol', 'bench.stopProtocol': 'Stop protocol',
  'bench.notReady': 'Engine not ready', 'bench.sendPulse': 'Send one stimulus',
  'bench.clearTrace': 'Clear trace', 'bench.refreshAcquisition': 'Re-acquire',
  'bench.updateRecording': 'Update recording', 'bench.exportJson': 'Export JSON',
  'bench.exportCsv': 'Export CSV', 'bench.applyBandpass': 'Apply band-pass',
  'bench.waveform': 'Live EEG waveform', 'bench.recording': 'Recording',
  'bench.footer': 'Educational simulation · the amplitude gap remains (model EEG amplitude is ~51× off real EEG; baseline and alpha-structure gaps are unresolved). Displays use solver results, not clinical measurements.',
  'bench.drilldownBack': '← Back to the loop diagram',
  'bench.peripheralReserved': 'Peripheral physiology sensors (ECG / respiration): interface reserved, no real signal yet. This version shows no heart/lung data and simulates none.',
  'bench.drill.manualStim': 'Manual stimulation (secondary entry)',
  'bench.drill.manualStimNote': 'The main flow is: design the experiment and assemble the subject in the experiment computer, then run. This is only for one manual stimulus at a time.',
  'bench.drill.step1': '1. Design the experiment',
  'bench.drill.step2': '2. Assemble the subject',
  'bench.drill.step3': '3. Run & observe',
  'bench.drill.handNote': 'The hand presses on the response to a rare-stimulus trial.',
  'bench.drill.brainNote': 'Click the brain to select a region; drag to rotate, scroll to zoom.',
  'bench.drill.returnPathNote': 'The stimulator sits on the closed-loop return path: experiment computer decides → stimulator → brain. The triggers arrow is something else (event marks into the amplifier).',
  'bench.drill.amplifierNote': 'B: analogue signal filtered, amplified, converted to digital.',
  'bench.composer.title': 'Assemble the subject',
  'bench.composer.modelVariant': 'The subject assembled here is a combination of model parameters — not a real person and not a clinical diagnosis. The same experiment gives different responses under different parameters.',
  'bench.composer.modelVariantShort': 'Model parameter combination, not a clinical diagnosis',
  'bench.composer.groupA': 'Excitation / inhibition (E/I balance)',
  'bench.composer.groupB': 'Background activity & rhythm',
  'bench.composer.groupC': 'Cognition & behaviour',
  'bench.composer.g': 'How strongly regions drive each other',
  'bench.composer.gHint': 'Higher: the network synchronises more easily and flips into high activity more easily.',
  'bench.composer.cEi': 'Strength of inhibition',
  'bench.composer.cEiHint': 'Lower: weaker inhibition, easier excitation. Below 3.2 you are near the model stability boundary.',
  'bench.composer.background': 'Background activity',
  'bench.composer.ouSigma': 'Size of spontaneous fluctuations',
  'bench.composer.ouSigmaHint': 'Above 0.12 you are near the lock boundary.',
  'bench.composer.extSineAmp': 'Strength of rhythmic drive',
  'bench.composer.extSineAmpHint': 'Only applies in oscillatory mode.',
  'bench.composer.extSineFreqHz': 'Frequency of rhythmic drive',
  'bench.composer.extSineFreqHzHint': 'Only applies in oscillatory mode.',
  'bench.composer.rtMin': 'Fastest reaction time',
  'bench.composer.rtMax': 'Slowest reaction time',
  'bench.composer.seed': 'Random seed',
  'bench.composer.resetSubject': 'Restore default subject',
  'bench.composer.directionsTitle': 'The "directions of epilepsy" people talk about have no matching knob in this model; only the four parameter directions below can express them.',
  'bench.composer.summaryLabel': 'Current combination',
};
const strings: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zh, 'en-US': en,
};
export const translate = (locale: Locale, key: MessageKey): string => strings[locale][key];
export const allMessageKeys = Object.freeze(Object.keys(zh) as MessageKey[]);

interface I18nContext {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
}
const Context = createContext<I18nContext | null>(null);
function initialLocale(): Locale {
  try { return localStorage.getItem(LOCALE_STORAGE_KEY) === 'en-US' ? 'en-US' : 'zh-CN'; }
  catch { return 'zh-CN'; }
}
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(() => {
    const next = initialLocale(); setTextLocale(next); return next;
  });
  const setLocale = useCallback((next: Locale) => {
    setTextLocale(next); updateLocale(next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    try { localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* storage disabled */ }
  }, [locale]);
  const t = useCallback((key: MessageKey) => translate(locale, key), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n(): I18nContext {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('I18nProvider missing');
  return ctx;
}
