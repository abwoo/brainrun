import { useState, type ReactNode } from 'react';
export function ControlField({label,hint,children}:{label:string;hint?:string;children:ReactNode}) {
 return <label className="control-field"><span className="control-field-label">{label}</span>
  {children}{hint&&<span className="control-field-hint">{hint}</span>}</label>;
}
export function RangeControl({label,hint,value,min,max,step,unit='',onChange,disabled=false}:{
 label:string;hint?:string;value:number;min:number;max:number;step:number;unit?:string;
 onChange:(value:number)=>void;disabled?:boolean;
}) {
 const [draft,setDraft]=useState<string|null>(null);
 const apply=(raw:string)=>{const n=Number(raw);if(raw.trim()&&Number.isFinite(n))onChange(Math.min(max,Math.max(min,n)));setDraft(null);};
 return <ControlField label={label} hint={hint}>
  <div className="range-control">
   <input aria-label={label} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
    onChange={e=>onChange(Number(e.target.value))}/>
   <input className="range-number" aria-label={label+' '+unit} type="number"
    min={min} max={max} step={step} value={draft??String(value)} disabled={disabled}
    onChange={e=>setDraft(e.target.value)} onBlur={e=>apply(e.target.value)}
    onKeyDown={e=>{if(e.key==='Enter'){apply(e.currentTarget.value);e.currentTarget.blur();}}}/>
   {unit&&<span>{unit}</span>}
  </div>
 </ControlField>;
}
