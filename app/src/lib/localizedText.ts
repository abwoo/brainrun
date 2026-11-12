import { messageCatalog } from './messageCatalog';
import { messageTemplates } from './messageTemplates';
import { englishPhrases } from './uiTranslations';
export type TextLocale = 'zh-CN' | 'en-US';
let locale:TextLocale='zh-CN';
export function setTextLocale(next:TextLocale):void { locale=next; }
const missing=new Set<string>();
export function getMissingTranslations():string[] { return [...missing]; }
const norm=(s:string)=>s.replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const english=new Map(messageCatalog.map(m=>[norm(m.zh),m.en]));
const chinese=new Map(messageCatalog.filter(m=>!/[\u3400-\u9fff]/.test(m.en)).map(m=>[norm(m.en),m.zh]));
const chineseTitles:Record<string,string>={
 'BRAIN PHYSICS':'脑科学物理仿真','PLAY':'互动','WAVES':'频谱','EXPLORE':'脑区',
 'PLAY —':'仿真 —','CONNECT —':'连接 —','RESET':'恢复默认','HEAD EEG':'头部电位',
 'DIPOLE LAB':'电流源','LIVE ACTIVITY':'活动曲线','PARAMETERS':'参数',
 'REGION / CONNECTION':'脑区与连接','TIME':'时间','STATE':'状态','RESPONSE':'刺激响应',
 'PR-13 · CELLULAR LAB':'细胞模型','PR-15 · EXPERIMENT LAB':'对照实验',
 'PR5 · DIPOLE PHYSICS LAB':'电流源物理模型','FOUR-LAYER SPHERE · PHYSICS EEG':'四层头部导体模型',
 'FSAVERAGE · MRI/BEM PHYSICS':'MRI/BEM 物理模型','PR-14 · STIMULATION LAB':'刺激与电场模型',
 'Oddball':'少见刺激','Standard':'常见刺激','Raw：':'原始记录：',
 'WAVES · 频段 / PSD':'频段与功率谱','EXPLORE · 解剖 / 图谱 / 坐标':'脑区、解剖与坐标',
 '刺激响应 · RESPONSE':'刺激响应','回放 · REPLAY':'回放','背景活动 · BACKGROUND':'背景活动','实验快照 · SNAPSHOT':'实验快照',
 'BOTH':'两者','STIMULUS':'刺激强度','DURATION':'持续时间','CONNECTIVITY':'连接强度',
 'EXC/INH':'兴奋与抑制','EXC / INH':'兴奋与抑制',
};
const escapeRegex=(s:string)=>s.replace(/[.*+?^\$\{\}()|[\]\\]/g,'\\$&');
const templates=messageTemplates.map(m=>{
 const parts=norm(m.zh).split(/(\{\d+\})/g);const indices:number[]=[];
 const pattern=parts.map(p=>/^\{\d+\}$/.test(p)?(indices.push(Number(p.slice(1,-1))),'(.+?)'):escapeRegex(p)).join('');
 return {pattern:new RegExp('^'+pattern+'$'),en:m.en,indices};
});
const cache=new Map<string,string>();
export function localizeText(text:string):string {
 const key=norm(text);
 if(!key || ['中文','简体中文','English'].includes(key))return text;
 if(locale==='zh-CN')return chineseTitles[key]??chinese.get(key)??text;
 const cached=cache.get(key);if(cached!==undefined)return cached;
 let translated=english.get(key);
 if(translated===undefined) {
  for(const rule of templates) {
   const match=key.match(rule.pattern);if(!match)continue;
   const values:Record<number,string>={};
   rule.indices.forEach((n,i)=>{values[n]=match[i+1]===key ? match[i+1] : localizeText(match[i+1]);});
   translated=rule.en.replace(/\{(\d+)\}/g,(_,n)=>values[Number(n)]??'');break;
  }
 }
 // Single complete terminology entries remain supported; never assemble a
 // sentence by translating arbitrary subwords or hide an unknown message.
 if(translated===undefined)translated=englishPhrases[key];
 if(translated===undefined) {
  if(/[\u3400-\u9fff]/.test(key))missing.add(key);
  return text;
 }
 if(cache.size>5000)cache.clear();cache.set(key,translated);return translated;
}
export function localizeChildren(value:unknown):unknown {
 if(typeof value==='string')return localizeText(value);
 if(Array.isArray(value))return value.map(localizeChildren);
 return value;
}
export function localizeProps<T>(props:T):T {
 if(!props||typeof props!=='object')return props;
 const result={...(props as Record<string,unknown>)};
 for(const key of ['children','title','aria-label','aria-description','placeholder','alt'])
  if(key in result)result[key]=localizeChildren(result[key]);
 return result as T;
}
