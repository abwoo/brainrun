import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {advanceAcquiring,appendNativeChunk,filterAndDecimate} from '../../app/src/lib/nativeAcquisition.ts';
const fake=()=>{let t=0;return {time_ms:()=>t,dt_ms:()=>1,n_nodes:()=>1,step:()=>{t++;return true},
 snapshot_e:()=>Float64Array.of(.5+.1*Math.sin(2*Math.PI*40*t/1000)),
 snapshot_i:()=>Float64Array.of(.1)};};
test('integration rows are invariant to display batching and do not share mutable WASM buffers',()=>{
 const a=[],b=[],one=fake(),two=fake();
 for(let j=0;j<1000;j+=10)appendNativeChunk(a,advanceAcquiring(one,10,'run'));
 for(let j=0;j<1000;j+=100)appendNativeChunk(b,advanceAcquiring(two,100,'run'));
 assert.equal(a.length,1001);assert.deepEqual(a,b);assert.equal(a.at(-1).t_ms,1000);
 assert.notEqual(a[0].e,a[1].e);assert.equal(a[0].e[0],.5);
});
test('250/500 Hz FIR output matches independently implemented SciPy firwin/convolve',()=>{
 const reference=JSON.parse(execFileSync('python',['scientific/eeg/native_reference.py'],{encoding:'utf8'}));
 const input=Array.from({length:2001},(_,j)=>.5+.2*Math.sin(2*Math.PI*40*j/1000)+.1*Math.sin(2*Math.PI*350*j/1000));
 for(const rate of [250,500]){
  const out=filterAndDecimate(input,rate);
  assert.equal(out.offsetMs,64);assert.equal(out.stepMs,1000/rate);
  assert.equal(out.values.length,reference[rate].length);
  assert.ok(Math.max(...out.values.map((x,j)=>Math.abs(x-reference[rate][j])))<2e-13);
 }
});
test('anti-alias rejects out-of-band signal and preserves a genuine 80 Hz source',()=>{
 for(const rate of [250,500]){
  const wave=f=>Array.from({length:4001},(_,j)=>Math.sin(2*Math.PI*f*j/1000));
  const rms=x=>Math.sqrt(x.reduce((a,b)=>a+b*b,0)/x.length);
  assert.ok(rms(filterAndDecimate(wave(80),rate).values)>.68);
  assert.ok(rms(filterAndDecimate(wave(350),rate).values)<.002);
 }
 assert.throws(()=>filterAndDecimate([1,2,3],250),/Insufficient/);
});
