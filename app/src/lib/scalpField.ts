import {interpolateSphereGain,sphereElectrodePotentials,type SphereFixture,type MontageKey,type SphereReference} from './sphereForward.ts';
import type {Vec3Mm} from './volumeConduction.ts';
/** Fixed physical µV scale: changing source magnitude must change the visual amplitude. */
export function potentialColor(valueUv:number,scaleUv:number):[number,number,number] {
 if(!Number.isFinite(valueUv)||!Number.isFinite(scaleUv)||scaleUv<=0)throw new RangeError('Invalid voltage scale');
 const v=Math.max(-1,Math.min(1,valueUv/scaleUv)),a=Math.abs(v);
 const neutral=[.25,.32,.37],end=v>=0?[1,.38,.32]:[.22,.66,1];
 return neutral.map((x,j)=>x+(end[j]-x)*a) as [number,number,number];
}
export function scalpVertexPotentials(fixture:SphereFixture,position:Vec3Mm,moment:Vec3Mm,montage:MontageKey,reference:SphereReference,selectedLabels?:readonly string[]):number[] {
 const grid=fixture.scalp_field_grid;
 if(!grid||grid.positions_mm.length!==grid.gain_uv_per_nAm.length)throw new Error('Scalp vertex forward model unavailable');
 const gains=interpolateSphereGain({...fixture,gain_uv_per_nAm:grid.gain_uv_per_nAm},position);
 const sensors=sphereElectrodePotentials(fixture,position,moment,montage,{mode:'infinity'},selectedLabels);
 let offset=0;
 if(reference.mode==='average')offset=sensors.voltageUv.reduce((a,b)=>a+b,0)/sensors.voltageUv.length;
 if(reference.mode==='electrode'){
  const i=sensors.sensors.findIndex(s=>s.label===reference.label);
  if(i<0)throw new Error('Reference sensor is absent');
  offset=sensors.voltageUv[i];
 }
 return gains.map(g=>g[0]*moment[0]+g[1]*moment[1]+g[2]*moment[2]-offset);
}
