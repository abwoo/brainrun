import { englishPhrases } from './uiTranslations';
export type TextLocale = 'zh-CN' | 'en-US';
let locale: TextLocale = 'zh-CN';
export function setTextLocale(next: TextLocale): void { locale = next; }
const missing = new Set<string>();
export function getMissingTranslations(): string[] { return [...missing]; }
const chineseLabels: Record<string, string> = {
 'PLAY':'互动', 'WAVES':'频谱', 'EXPLORE':'探索', '3D LIVE BRAIN':'3D 实时大脑',
 'PARAMETERS':'参数', 'REGION / CONNECTION':'脑区与连接', 'LIVE ACTIVITY':'实时活动',
 'TIME':'时间', 'STATE':'状态', 'RESPONSE':'刺激响应', 'DIPOLE LAB':'偶极子实验',
 'HEAD EEG':'头皮 EEG', 'BRAIN PHYSICS':'脑科学仿真',
};
const phraseCache = new Map<string, string | null>();
function translatePhrase(phrase: string): string | undefined {
 if (englishPhrases[phrase] !== undefined) return englishPhrases[phrase];
 if (phraseCache.has(phrase)) return phraseCache.get(phrase) ?? undefined;
 // Dynamic labels can concatenate separately translated scientific phrases.
 // Prefer the longest complete segmentation; never drop unknown characters.
 const paths: Array<string | undefined> = new Array(phrase.length + 1);
 paths[phrase.length] = '';
 for (let start = phrase.length - 1; start >= 0; start--) {
   for (let end = phrase.length; end > start; end--) {
     const word = englishPhrases[phrase.slice(start, end)];
     if (word !== undefined && paths[end] !== undefined) {
       paths[start] = word + (paths[end] ? ' ' + paths[end] : ''); break;
     }
   }
 }
 phraseCache.set(phrase, paths[0] ?? null);
 return paths[0];
}
export function localizeText(text: string): string {
 if (locale === 'zh-CN') {
   const label = chineseLabels[text.trim()] ?? text;
   const controls: Record<string, string> = {
     PLAY: '仿真', CONNECT: '连接', RESET: '重置', BACKGROUND: '背景活动',
     STIMULUS: '刺激强度', DURATION: '持续时间', CONNECTIVITY: '连接强度',
   };
   return label.replace(/\b(PLAY|CONNECT|RESET|BACKGROUND|STIMULUS|DURATION|CONNECTIVITY)\b/g,
     word => controls[word]);
 }
 if (text.trim() === '简体中文') return text;
 return text.replace(/[\u3400-\u9fff]+/g, phrase => {
   const translated = translatePhrase(phrase);
   if (translated === undefined) { missing.add(phrase); return phrase; }
   return ' ' + translated + ' ';
 }).replace(/[，、]/g, ', ').replace(/。/g, '. ').replace(/；/g, '; ')
   .replace(/：/g, ': ').replace(/（/g, ' (').replace(/）/g, ') ')
   .replace(/[“”]/g, '"').replace(/[ \t]+/g, ' ');
}
/** Strings only: React elements and computational objects retain identity. */
export function localizeChildren(value: unknown): unknown {
 if (typeof value === 'string') return localizeText(value);
 if (Array.isArray(value)) return value.map(localizeChildren);
 return value;
}
export function localizeProps<T>(props: T): T {
 if (!props || typeof props !== 'object') return props;
 const result = { ...(props as Record<string, unknown>) };
 for (const key of ['children', 'title', 'aria-label', 'aria-description', 'placeholder', 'alt']) {
   if (key in result) result[key] = localizeChildren(result[key]);
 }
 return result as T;
}
