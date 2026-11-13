import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {potentialColor,scalpVertexPotentials} from '../../app/src/lib/scalpField.ts';
import {setPhysicalSource,getPhysicalSource,registerPhysicalFixture,preparePhysicalAnalysis} from '../../app/src/lib/physicalExperiment.ts';
const fixture=JSON.parse(readFileSync('app/public/forward-assets/sphere-model.json','utf8'));
test('scalp colors have a fixed physical scale, not per-frame normalization',()=>{
 assert.notDeepEqual(potentialColor(.25,2),potentialColor(.5,2));
 assert.deepEqual(potentialColor(2,2),potentialColor(20,2));
 assert.throws(()=>potentialColor(1,0),RangeError);
});
test('scalp forward amplitudes double and reverse with the physical dipole',()=>{
 const f=q=>scalpVertexPotentials(fixture,[16,0,16],[q,0,0],'10-20',{mode:'average'});
 const a=f(10),b=f(20),reverse=f(-10);
 assert.ok(a.length>400);
 a.forEach((v,i)=>{assert.ok(Math.abs(b[i]-2*v)<1e-12);assert.ok(Math.abs(reverse[i]+v)<1e-12);});
 assert.ok(fixture.scalp_field_grid.positions_mm.every(p=>Math.abs(Math.hypot(...p)-95)<1e-9));
});
test('free physical orientations are normalized and preserved in the generated source history',()=>{
 registerPhysicalFixture(fixture);
 setPhysicalSource({axis:'free',direction:[1,2,3],moment:12});
 const s=getPhysicalSource();assert.ok(Math.abs(Math.hypot(...s.direction)-1)<1e-12);
 const rec=preparePhysicalAnalysis();
 assert.deepEqual(rec.sourceSeries.sources[0].direction,s.direction);
 assert.throws(()=>setPhysicalSource({axis:'free',direction:[0,0,0]}),RangeError);
});
