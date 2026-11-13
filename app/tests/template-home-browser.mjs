import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {preview} from 'vite';
const server=await preview({preview:{port:0,host:'127.0.0.1'},logLevel:'error'});
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage();
 await page.goto(server.resolvedUrls.local[0],{waitUntil:'domcontentloaded'});

 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.getByText('Head model · Teaching sphere',{exact:true}).click();
 await page.getByRole('combobox',{name:'Head model',exact:true}).selectOption('bem');
 await page.getByTestId('template-physics').waitFor({timeout:120000});
 await page.getByRole('combobox',{name:'Cortical source position',exact:true}).selectOption('2');
 const homeValue=Number(await page.getByTestId('template-physics').getAttribute('data-voltage'));
 await page.getByRole('button',{name:'Analyze this template experiment',exact:true}).click();
 await page.getByTestId('eeg-summary').waitFor();
 assert.equal(await page.locator('[data-analysis-run-id]').getAttribute('data-source-model'),'manual-static-template-dipole-v1');
 const ready=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export JSON',exact:true}).click();
 const download=await ready,stream=await download.createReadStream();let text='';
 for await(const chunk of stream)text+=chunk.toString();
 const rec=JSON.parse(text),i=rec.channels.findIndex(c=>c.label==='Cz');
 assert.ok(Math.abs(rec.dataUv[i][0]-homeValue)<1e-12);
 assert.equal(rec.templateSnapshot.sourceIndex,2);
 assert.equal(rec.forwardModelId,'fsaverage-mne-three-layer-bem-v1');
 await page.getByRole('tab',{name:'Topography',exact:true}).click();
 assert.ok(await page.getByRole('img',{name:'Forward samples of the current sources',exact:true}).count());
 await page.getByRole('tab',{name:'Source localization',exact:true}).click();
 assert.ok((await page.getByTestId('inverse-observation').innerText()).includes('fsaverage-mne-three-layer-bem-v1'));
 console.log('Template auto-load without file import, matching Raw/export, topography and BEM inverse PASS');
}finally{await browser?.close();await server.httpServer.close();}
