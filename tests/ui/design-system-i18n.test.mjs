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
 assert.equal(total,45);
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
 // Phase 4：语言切换不在 App 顶栏，改由台子自己渲染；bench.openAdvanced
 // 键随 #advanced 一起从 i18n 字典删除。
 assert.doesNotMatch(app,/<LanguageSwitch/);
 const bench=read('app/src/components/ClosedLoopBench.tsx');
 assert.match(bench,/<LanguageSwitch/);
 assert.doesNotMatch(i,/bench\.openAdvanced/);
 const language=read('app/src/components/ui/LanguageSwitch.tsx');
 assert.ok(language.includes("setLocale('en-US')"));
 assert.ok(language.includes("setLocale('zh-CN')"));
});
test('workspace layout: #advanced stage/focus controls are cut; App is bench/basic only',()=>{
 const app=read('app/src/App.tsx');
 // Phase 4：#advanced 工作台布局（stageWidth / data-mode / brainrun-focus /
 // brainrun.stage-share.v1 / setStageWidth(68)）已删除；App 只剩
 // bench/basic 两档切换。App.css 里残留的 --brain-stage-share 与
 // .main.brainrun-focus 规则现已无人引用（死样式），本测试不为其背书。
 assert.doesNotMatch(app,/const \[stageWidth, setStageWidth\]/);
 assert.doesNotMatch(app,/data-mode=\{m\}/);
 assert.doesNotMatch(app,/brainrun\.stage-share\.v1/);
 assert.doesNotMatch(app,/brainrun-focus/);
 assert.doesNotMatch(app,/setStageWidth\(68\); setFocus3D\(false\)/);
 assert.match(app,/useState<'bench' \| 'basic'>/);
});
test('control audit is updated, not weakened by migrating 36 selects',()=>{
 const c=JSON.parse(read('docs/p0-1b-control-register.json'));
 // Phase 4 重数：235（257 − App 48 − PhysicsHome 2 + 台子 27 + 模板分析返回按钮 1），
 // Option A（2026-11-18）恢复高级实验导航 +2 → 237，PhysicsHome 13，NAV 18；
 // Option A 补项（2026-11-18）分析视图内恢复 More/Less + Comparisons +2 → 239，PhysicsHome 15，NAV 20。
 // Dropdown 57（48 + 台子 9）。
 assert.equal(c.counts.total,239);
 assert.equal(c.entries.length,239);
 assert.equal(c.entries.filter(x=>x.element==='Dropdown').length,57);
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
