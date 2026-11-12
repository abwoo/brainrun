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
