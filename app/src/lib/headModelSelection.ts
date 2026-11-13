/** Shared conductor choice across the physical home and advanced measurements. */
export type HeadModelSelection='sphere'|'bem';
let selected:HeadModelSelection='sphere';
const listeners=new Set<()=>void>();
export function getHeadModelSelection():HeadModelSelection{return selected;}
export function subscribeHeadModelSelection(fn:()=>void):()=>void{listeners.add(fn);return()=>{listeners.delete(fn);};}
export function setHeadModelSelection(value:HeadModelSelection):void {
 if(value!=='sphere'&&value!=='bem')throw new RangeError('Unknown head model');
 if(selected===value)return;selected=value;listeners.forEach(fn=>fn());
}
