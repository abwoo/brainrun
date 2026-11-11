import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SPHERE_MODEL_ID, validateSphereFixture, interpolateSphereGain,
  sphereElectrodePotentials,
} from '../../app/src/lib/sphereForward.ts';

const data = JSON.parse(readFileSync(new URL(
  '../../app/public/forward-assets/sphere-model.json', import.meta.url), 'utf8'));
const near = (a,b,tol=1e-6) => assert.ok(Math.abs(a-b) <= tol,
  'expected '+a+' ≈ '+b+' within '+tol);

test('version, units, validated model metadata and dimensions', () => {
  validateSphereFixture(data);
  assert.equal(data.model_id,SPHERE_MODEL_ID);
  assert.equal(data.gain_units,'microvolts_per_nanoampere_metre');
  assert.equal(data.sensors.length,345);
  assert.equal(data.gain_uv_per_nAm[0].length,192);
  assert.equal(data.mne_version,'1.11.0');
  assert.ok(data.limitations.includes('BEM/FEM'));
});
test('all montage labels belong to the common head-coordinate sphere', () => {
  for (const [key,expected] of [['10-20',19],['10-10',94],['10-05',343]]) {
    assert.equal(data.montages[key].length,expected);
    for (const name of ['Cz','Pz']) assert.ok(data.montages[key].includes(name));
    if (key !== '10-20') assert.ok(data.montages[key].includes('Oz'));
    else assert.ok(!data.montages[key].includes('Oz'), 'classic 19-electrode 10-20 subset omits Oz');
  }
  for (const s of data.sensors) near(Math.hypot(...s.position_mm),95,0.001);
});
test('exact grid nodes reproduce the precomputed MNE leadfield in µV/nA.m', () => {
  const xyz = [-16,16,-16];
  const gridIdx = (1*4+2)*4+1;
  const g=interpolateSphereGain(data,xyz);
  for(const i of [0,21,99,250,344])
    for(let k=0;k<3;k++)
      near(g[i][k],data.gain_uv_per_nAm[i][gridIdx*3+k],1e-8);
});
test('trilinear interpolation is finite and continuous near grid planes', () => {
  const a=interpolateSphereGain(data,[-16-1e-5,0,0]);
  const b=interpolateSphereGain(data,[-16+1e-5,0,0]);
  for(let j=0;j<a.length;j++)for(let k=0;k<3;k++)near(a[j][k],b[j][k],1e-5);
});
test('montage-specific average re-referencing has zero mean', () => {
  for (const montage of ['10-20','10-10','10-05']) {
    const x=sphereElectrodePotentials(data,[10,10,10],[10,0,0],montage);
    assert.equal(x.sensors.length,data.montages[montage].length);
    near(x.voltageUv.reduce((a,b)=>a+b,0),0,1e-6);
    assert.ok(Math.max(...x.voltageUv)-Math.min(...x.voltageUv)>0.01);
  }
});
test('dipole reversal reverses all electrode voltages', () => {
  const a=sphereElectrodePotentials(data,[10,10,10],[10,0,0]).voltageUv;
  const b=sphereElectrodePotentials(data,[10,10,10],[-10,0,0]).voltageUv;
  a.forEach((v,i)=>near(v,-b[i],1e-8));
});
test('dipole moment linearity and superposition', () => {
  const a=sphereElectrodePotentials(data,[0,0,10],[10,0,0]).voltageUv;
  const b=sphereElectrodePotentials(data,[0,0,10],[0,5,0]).voltageUv;
  const c=sphereElectrodePotentials(data,[0,0,10],[10,5,0]).voltageUv;
  c.forEach((v,i)=>near(v,a[i]+b[i],1e-8));
});
test('changing axis and source position changes measured distribution', () => {
  const x=sphereElectrodePotentials(data,[0,0,10],[10,0,0]).voltageUv;
  const z=sphereElectrodePotentials(data,[0,0,10],[0,0,10]).voltageUv;
  const moved=sphereElectrodePotentials(data,[20,10,-10],[10,0,0]).voltageUv;
  assert.ok(x.some((v,i)=>Math.abs(v-z[i])>0.01));
  assert.ok(x.some((v,i)=>Math.abs(v-moved[i])>0.005));
});
test('reference electrode vanishes, unknown electrode rejected', () => {
  const x=sphereElectrodePotentials(data,[10,0,10],[10,0,0],'10-20',
    {mode:'electrode',label:'Cz'});
  near(x.voltageUv[x.sensors.findIndex(s=>s.label==='Cz')],0);
  assert.throws(()=>sphereElectrodePotentials(data,[0,0,10],[10,0,0],'10-20',
    {mode:'electrode',label:'NOT_THERE'}),/Reference/);
});
test('out-of-grid source and invalid moments fail loudly', () => {
  for(const p of [[49,0,0],[-49,0,0],[NaN,0,0]])
    assert.throws(()=>sphereElectrodePotentials(data,p,[10,0,0]),/outside/);
  assert.throws(()=>sphereElectrodePotentials(data,[0,0,10],[NaN,0,0]),/finite/);
});
test('incorrect sensor order or corrupted matrix fails validation', () => {
  const broken={...data,gain_uv_per_nAm:data.gain_uv_per_nAm.slice(1)};
  assert.throws(()=>validateSphereFixture(broken),/row count/);
  const duplicate={...data,sensors:[data.sensors[0],...data.sensors.slice(1)]};
  duplicate.sensors[1]={...duplicate.sensors[1],label:duplicate.sensors[0].label};
  assert.throws(()=>validateSphereFixture(duplicate),/duplicate/);
});
