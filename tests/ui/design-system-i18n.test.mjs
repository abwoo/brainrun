import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(p,'utf8');
test('all scientific lab select elements use the same native Dropdown',()=>{
 const labs=['EegAnalysisLab','EegWaveTab','HeadSphereLab','LocalBEMLab','StimLab','ExperimentLab','InverseTab','TfrTab','DipoleLab','TopoTab'];
 let total=0;
 for(const name of labs){
  const s=read('app/src/components/'+name+'.tsx');
  assert.doesNotMatch(s,/<select\b/i,name+' still creates a bespoke select');
  assert.match(s,/import Dropdown from '.\/ui\/Dropdown'/);
  const n=(s.match(/<Dropdown\b/g)||[]).length;
  assert.ok(n>0,name+' must adopt shared Dropdown');
  assert.equal(n,(s.match(/<\/Dropdown>/g)||[]).length);
  total+=n;
 }
 assert.equal(total,44);
});
test('shared Dropdown deliberately uses native select and accessible focus behavior',()=>{
 const c=read('app/src/components/ui/Dropdown.tsx'),css=read('app/src/App.css');
 assert.match(c,/<select \{\.\.\.selectProps\}/);
 assert.match(c,/disabled=\{disabled\}/);
 assert.match(c,/<svg aria-hidden="true"/);
 assert.match(css,/\.brainrun-dropdown-native:focus-visible/);
 assert.match(css,/\.brainrun-dropdown-chevron[\s\S]*?pointer-events: none;/);
});
test('i18n has stable key coverage and separate saved locale choice',()=>{
 const i=read('app/src/lib/i18n.tsx');
 assert.match(i,/export type Locale = 'zh-CN' \| 'en-US'/);
 assert.match(i,/Record<MessageKey, string>/);
 assert.match(i,/brainrun.locale.v1/);
 assert.match(i,/document.documentElement.lang = locale/);
 const app=read('app/src/App.tsx');
 assert.match(app,/useI18n\(\)/);
 assert.match(app,/<LanguageSwitch/);
 const language=read('app/src/components/ui/LanguageSwitch.tsx');
 assert.ok(language.includes("setLocale('en-US')"));
 assert.ok(language.includes("setLocale('zh-CN')"));
});
test('workspace layout is visual-only and responds to focus, resize and reset',()=>{
 const app=read('app/src/App.tsx'),css=read('app/src/App.css');
 assert.match(app,/const \[stageWidth, setStageWidth\]/);
 assert.match(app,/data-mode=\{m\}/);
 assert.match(app,/brainrun.stage-share.v1/);
 assert.match(app,/brainrun-focus/);
 assert.match(app,/setStageWidth\(68\); setFocus3D\(false\)/);
 assert.match(css,/--brain-stage-share/);
 assert.match(css,/\.main.brainrun-focus \.panels \{ display: none; \}/);
});
test('control audit is updated, not weakened by migrating 36 selects',()=>{
 const c=JSON.parse(read('docs/p0-1b-control-register.json'));
 assert.equal(c.counts.total,244);
 assert.equal(c.entries.length,244);
 assert.equal(c.entries.filter(x=>x.element==='Dropdown').length,47);
 assert.ok(c.entries.every(x=>x.evidence.includes('not runtime-proven')));
});

test('presentation translation preserves scientific data and covers rendered Chinese phrases',()=>{
 const dictionary = read('app/src/lib/uiTranslations.ts');
 assert.ok(dictionary.includes('单通道记录不支持多电极地形或源定位'));
 const runtime = read('app/src/lib/localizedText.ts');
 assert.ok(!runtime.includes("result['value']"));
 assert.match(runtime, /'aria-label'/);
 assert.match(read('app/tsconfig.app.json'), /jsxImportSource/);
});
