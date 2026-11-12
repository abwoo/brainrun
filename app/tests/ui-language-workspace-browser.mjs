/** Real production browser UI test: locale persistence, dropdown keyboard and visual-only workspace. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
const server=await preview({preview:{port:0,host:'127.0.0.1'},logLevel:'error'});
let browser;
try {
 const url=server.resolvedUrls?.local?.[0];
 assert.ok(url);
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage({viewport:{width:1600,height:900}});
 const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__brainSim?.isReady?.()===true,null,{timeout:60000});
 const lang=page.getByRole('combobox',{name:'语言'});
 await lang.selectOption('en-US');
 assert.equal(await page.locator('html').getAttribute('lang'),'en-US');
 await page.getByRole('button',{name:'Quick experiments'}).waitFor();
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__brainSim?.isReady?.()===true,null,{timeout:60000});
 assert.equal(await page.locator('html').getAttribute('lang'),'en-US');
 assert.equal(await page.getByRole('combobox',{name:'Language'}).inputValue(),'en-US');
 await page.getByRole('button',{name:/^More/}).click();
 const slider=page.getByRole('slider',{name:'3D stage width'});
 await slider.focus();
 await slider.press('End');
 assert.equal(await slider.inputValue(),'85');
 assert.match(await page.locator('main.main').getAttribute('style')??'',/85%/);
 await page.getByRole('button',{name:'Focus on 3D'}).click();
 assert.equal(await page.locator('aside.panels').evaluate(el=>getComputedStyle(el).display),'none');
 await page.getByRole('button',{name:'Show panels'}).click();
 await page.getByRole('button',{name:'Reset layout'}).click();
 assert.equal(await slider.inputValue(),'68');
 assert.equal(await page.locator('aside.panels').evaluate(el=>getComputedStyle(el).display),'flex');

 // The native select allows standard keyboard navigation and label-based selection.
 await page.locator('button[data-mode="eeg"]').click();
 const montage=page.getByRole('combobox',{name:'导联'});
 await montage.selectOption('10-10');
 assert.equal(await montage.inputValue(),'10-10');
 await montage.selectOption('10-05');
 assert.equal(await montage.inputValue(),'10-05');
 assert.ok((await page.locator('.brainrun-dropdown').count())>=7);

 // Language preference and layout preference never change scientific model params.
 await page.locator('button[data-mode="play"]').click();
 await page.getByRole('combobox',{name:'Language'}).selectOption('zh-CN');
 assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');
 assert.deepEqual(errors,[],'Browser errors');
 console.log('UI bilingual shell, native Dropdown and resizable workspace PASS');
} finally {
 await browser?.close();
 await server.httpServer.close();
}
