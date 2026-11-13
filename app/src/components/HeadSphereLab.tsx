import {potentialColor,scalpVertexPotentials} from '../lib/scalpField';
import {getPhysicalSource,setPhysicalSource,registerPhysicalFixture,sourceWaveformAt} from '../lib/physicalExperiment';
import type {EegReference} from '../lib/eegData';
import Dropdown from './ui/Dropdown';
import { ControlField, RangeControl } from './ui/ControlField';
import { useI18n } from '../lib/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  SPHERE_MODEL_ID, sphereElectrodePotentials, validateSphereFixture,
  moveSphereElectrodes,type SphereFixture, type MontageKey,
} from '../lib/sphereForward';
import { clampSourcePositionMm } from '../lib/eegRecording';
import type { Vec3Mm } from '../lib/volumeConduction';

/**
 * MNE four-shell spherical volume-conduction demonstration.
 * Coordinates/electrode directions are registered to a common HEAD space,
 * NOT to the TVB demo cortex. This is deliberately independent from
 * BrainScene: none of its cortical vertices are claimed to be MNI.
 */
export default function HeadSphereLab({onClose,onOpenReal,liveSource,embedded=false}:{onClose:()=>void;onOpenReal?:()=>void;embedded?:boolean;
  /**
   * PR8-LINK 直播源（App 传）：选中脑区的 TVB 中心 + 由直播 E/I 经 PR5
   * q 链算出的偶极矩（基线 = 选区切换时该脑区的 E/I）。不传时只有手动
   * 偶极子一路（独立演示）。
   */
  liveSource?: { positionMm: Vec3Mm; momentNAm: number; regionLabel: string; regionId: number } | null;
}) {
  const manualHeadState=getPhysicalSource();
  const {locale}=useI18n();
  const text=(zh:string,en:string)=>locale==='zh-CN'?zh:en;
  const [baseData,setBaseData]=useState<SphereFixture|null>(null);
  const [modelId,setModelId]=useState(embedded?manualHeadState.modelId:SPHERE_MODEL_ID);
  const [electrodeVertices,setElectrodeVertices]=useState<Record<string,number>>(embedded?manualHeadState.electrodeVertices:{});
  const data=useMemo(()=>baseData&&baseData.model_id===modelId?moveSphereElectrodes(baseData,electrodeVertices):null,[baseData,modelId,electrodeVertices]);
  const [editElectrodes,setEditElectrodes]=useState(false);
  const editElectrodesRef=useRef(false);editElectrodesRef.current=editElectrodes;
  const [waveform,setWaveform]=useState<'constant'|'pulse'>(embedded?manualHeadState.waveform:'constant');
  const [timeMs,setTimeMs]=useState(embedded?manualHeadState.timeMs:0);
  const [pulsePlaying,setPulsePlaying]=useState(false);
  const factor=sourceWaveformAt(waveform,timeMs);
  useEffect(()=>{
   if(!pulsePlaying)return;let frame=0,start:number|null=null;
   const tick=(now:number)=>{start??=now;const t=Math.min(2000,now-start);setTimeMs(t);if(t<2000)frame=requestAnimationFrame(tick);else setPulsePlaying(false);};
   frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[pulsePlaying]);
  const [secondary,setSecondary]=useState(embedded?manualHeadState.secondary:undefined);
  const secondaryRef=useRef(secondary);secondaryRef.current=secondary;
  const [error,setError]=useState<string|null>(null);
  const [position,setPosition]=useState<Vec3Mm>(embedded?manualHeadState.position:[0,0,16]);
  const [axis,setAxis]=useState<'X'|'Y'|'Z'|'free'>(embedded?manualHeadState.axis:'X');
  const [orientation,setOrientation]=useState<Vec3Mm>(embedded?manualHeadState.direction:[1,0,0]);
  const [colorScale,setColorScale]=useState(2);
  const direction=useMemo<Vec3Mm>(()=>axis==='free'?orientation:axis==='X'?[1,0,0]:axis==='Y'?[0,1,0]:[0,0,1],[axis,orientation]);
  const azimuth=Math.atan2(direction[1],direction[0])*180/Math.PI;
  const elevation=Math.asin(Math.max(-1,Math.min(1,direction[2])))*180/Math.PI;
  const setAngles=(a:number,e:number)=>{
    const p=a*Math.PI/180,t=e*Math.PI/180;
    setOrientation([Math.cos(t)*Math.cos(p),Math.cos(t)*Math.sin(p),Math.sin(t)]);setAxis('free');
  };
  const [moment,setMoment]=useState(embedded?manualHeadState.moment:10);
  const [montage,setMontage]=useState<MontageKey>(embedded?manualHeadState.montage:'10-20');
  const [selectedLabels,setSelectedLabels]=useState<readonly string[]|undefined>(embedded?manualHeadState.selectedLabels:undefined);
  const [reference,setReference]=useState<'average'|'infinity'|'electrode'>(embedded?manualHeadState.reference.mode:'average');
  const [selectedElectrode,setSelectedElectrode]=useState(embedded?manualHeadState.electrode:'Cz');
  const availableLabels=data?.montages[montage]??[];
  const activeLabels=selectedLabels??availableLabels;
  const chooseLabels=(labels:readonly string[]|undefined)=>{
   setSelectedLabels(labels);
   if(labels&&!labels.includes(selectedElectrode))setSelectedElectrode(labels[0]);
  };
  const referenceSpec:EegReference=reference==='electrode'
    ?{mode:'electrode',label:manualHeadState.reference.mode==='electrode'?manualHeadState.reference.label:'Cz'}
    :{mode:reference};
  // PR8-LINK：直播模式（默认开，只要传了 liveSource）；开着时位置与偶极矩
  // 跟随直播源，手动滑杆与拖动被直播值覆盖（拖动后下一帧即恢复）。
  const [liveMode,setLiveMode]=useState(liveSource != null);
  useEffect(()=>{
    if(!liveMode||!liveSource||!data)return;
    let next: Vec3Mm;
    try {
      next = clampSourcePositionMm(data, liveSource.positionMm);
    } catch {
      next = liveSource.positionMm;
    }
    // 值没变时返回旧引用，免得每帧（liveSource 约 15 Hz 换身份）都重算电位与重绘 3D。
    setPosition((prev) => (prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2] ? prev : next));
    const q = liveSource.momentNAm;
    setMoment((prev) => (prev === q ? prev : q));
  },[liveMode,liveSource,data]);
  useEffect(()=>{
    if(embedded)setPhysicalSource({waveform,timeMs,modelId,electrodeVertices,secondary,position:[position[0],position[1],position[2]],axis,direction,moment,montage,selectedLabels,reference:referenceSpec,electrode:selectedElectrode});
  },[embedded,waveform,timeMs,modelId,electrodeVertices,secondary,position,axis,direction,moment,montage,selectedLabels,reference,selectedElectrode]);
  useEffect(()=>{if(embedded&&data)registerPhysicalFixture(data);},[embedded,data]);
  const mount=useRef<HTMLDivElement>(null);
  const sceneUpdate=useRef<((p:Vec3Mm,dir:Vec3Mm,voltages:Map<string,number>,q:number,scale:number,selected:string,fieldValues:number[]|null,sensorPositions:Map<string,Vec3Mm>,signalFactor:number)=>void)|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setBaseData(null);setError(null);
    const file=modelId===SPHERE_MODEL_ID?'sphere-model.json':modelId.endsWith('0.002')?'sphere-skull-0.002.json':'sphere-skull-0.008.json';
    fetch(import.meta.env.BASE_URL+'forward-assets/'+file,{signal:controller.signal})
      .then(async r=>{
        if(!r.ok)throw new Error('模型资源缺失：请先运行 scientific/forward/generate_sphere_model.py');
        const fixture=await r.json() as SphereFixture;
        validateSphereFixture(fixture);
        if(fixture.model_id!==modelId)throw new Error('Conductor matrix does not match selected model');
        setBaseData(fixture);
      }).catch(e=>{if(!controller.signal.aborted)setError(String(e));});
    return ()=>controller.abort();
  },[modelId]);
  const baseReadings=useMemo(()=>{
    if(!data)return null;
    const result=sphereElectrodePotentials(data,position,[
      direction[0]*moment,direction[1]*moment,direction[2]*moment,
    ],montage,referenceSpec,selectedLabels);
    if(secondary){
      const v=sphereElectrodePotentials(data,secondary.position,secondary.direction.map(x=>x*secondary.moment) as unknown as Vec3Mm,montage,referenceSpec,selectedLabels);
      result.voltageUv=result.voltageUv.map((x,i)=>x+v.voltageUv[i]);
    }
    return result;
  },[data,position,direction,moment,montage,selectedLabels,reference,secondary]);
  const readings=useMemo(()=>baseReadings?{...baseReadings,voltageUv:baseReadings.voltageUv.map(v=>v*factor)}:null,[baseReadings,factor]);
  const scalpBase=useMemo(()=>{
    if(!embedded||!data?.scalp_field_grid)return null;
    const result=scalpVertexPotentials(data,position,[direction[0]*moment,direction[1]*moment,direction[2]*moment],montage,referenceSpec,selectedLabels);
    if(secondary){const v=scalpVertexPotentials(data,secondary.position,secondary.direction.map(x=>x*secondary.moment) as unknown as Vec3Mm,montage,referenceSpec,selectedLabels);return result.map((x,i)=>x+v[i]);}
    return result;
  },[embedded,data,position,direction,moment,montage,selectedLabels,reference,secondary]);
  const scalpValues=useMemo(()=>scalpBase?.map(v=>v*factor)??null,[scalpBase,factor]);
  const voltageMap=useMemo(()=>new Map(readings?.sensors.map((s,i)=>[s.label,readings.voltageUv[i]])??[]),[readings]);
  const peaks=useMemo(()=>[...(readings?.sensors??[])].map(s=>({
    label:s.label,v:voltageMap.get(s.label)??0,
  })).sort((a,b)=>Math.abs(b.v)-Math.abs(a.v)),[readings,voltageMap]);
  useEffect(()=>{
    if(!data||!mount.current)return;
    const host=mount.current;
    const scene=new THREE.Scene();
    scene.background=new THREE.Color('#05080c');
    const camera=new THREE.PerspectiveCamera(42,1,1,1000);
    camera.up.set(0,0,1);
    camera.position.set(175,165,230);camera.lookAt(0,0,0);
    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    host.appendChild(renderer.domElement);
    const orbit=new OrbitControls(camera,renderer.domElement);
    orbit.enableDamping=true;orbit.enablePan=false;
    orbit.minDistance=120;orbit.maxDistance=500;
    const makeShell=(r:number,color:number,opacity:number)=>{
      const m=new THREE.Mesh(new THREE.SphereGeometry(r,38,28),
        new THREE.MeshPhongMaterial({color,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide}));
      scene.add(m);return m;
    };
    if(!embedded||!data.scalp_field_grid)makeShell(data.radius_mm,0x3771a2,0.12);
    makeShell(data.radius_mm*0.97,0x567b94,0.06);
    makeShell(data.radius_mm*0.92,0x479ba0,0.07);
    makeShell(data.brain_inner_radius_mm,0x23547d,0.08);
    let fieldGeometry:THREE.BufferGeometry|null=null;
    if(embedded&&data.scalp_field_grid){
      const grid=data.scalp_field_grid;
      fieldGeometry=new THREE.BufferGeometry();
      fieldGeometry.setAttribute('position',new THREE.Float32BufferAttribute(grid.positions_mm.flatMap(p=>[...p]),3));
      fieldGeometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(grid.positions_mm.length*3),3));
      fieldGeometry.setIndex(grid.triangles);
      scene.add(new THREE.Mesh(fieldGeometry,new THREE.MeshBasicMaterial({
        vertexColors:true,transparent:true,opacity:.58,depthWrite:false,side:THREE.DoubleSide,
      })));
    }
    const selectedRing=new THREE.Mesh(new THREE.SphereGeometry(4.8,12,8),
      new THREE.MeshBasicMaterial({color:0xffffff,wireframe:true,transparent:true,opacity:.85}));
    selectedRing.visible=false;scene.add(selectedRing);
    scene.add(new THREE.AmbientLight(0xffffff,1.4));
    const light=new THREE.DirectionalLight(0xffffff,2);
    light.position.set(190,120,230);scene.add(light);
    const dots=new Map(data.sensors.map(s=>{
      const dot=new THREE.Mesh(new THREE.SphereGeometry(2.1,9,9),
        new THREE.MeshBasicMaterial({color:0x6c96b3}));
      dot.position.set(...s.position_mm);scene.add(dot);return [s.label,dot] as const;
    }));
    const source=new THREE.Mesh(new THREE.SphereGeometry(7,20,20),
      new THREE.MeshBasicMaterial({color:0xffb340}));
    source.position.set(...position);scene.add(source);
    const arrow=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),
      source.position.clone(),33,0xffb340);scene.add(arrow);
    const secondSource=new THREE.Mesh(new THREE.SphereGeometry(6,16,16),new THREE.MeshBasicMaterial({color:0xc599ff}));
    secondSource.visible=false;scene.add(secondSource);
    const secondArrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),30,0xc599ff);secondArrow.visible=false;scene.add(secondArrow);
    const ray=new THREE.Raycaster(), xy=new THREE.Vector2(), point=new THREE.Vector3();
    const plane=new THREE.Plane();
    const canvas=renderer.domElement;canvas.style.touchAction='none';
    let dragging=false,rotating=false,movingElectrode:string|null=null,displayQ=moment;
    let pointerStart:{x:number;y:number}|null=null;
    const pick=(e:PointerEvent)=>{
      const rect=canvas.getBoundingClientRect();
      xy.set(2*(e.clientX-rect.left)/rect.width-1,1-2*(e.clientY-rect.top)/rect.height);
      ray.setFromCamera(xy,camera);
    };
    const down=(e:PointerEvent)=>{
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      pointerStart={x:e.clientX,y:e.clientY};
      pick(e);
      if(embedded&&editElectrodesRef.current){
        const hit=ray.intersectObjects([...dots.values()].filter(dot=>dot.visible))[0];
        if(hit){
          movingElectrode=[...dots.entries()].find(([,dot])=>dot===hit.object)?.[0]??null;
          if(movingElectrode){setSelectedElectrode(movingElectrode);orbit.enabled=false;canvas.setPointerCapture(e.pointerId);e.preventDefault();return;}
        }
      }
      const coneHit=embedded&&Math.abs(displayQ)>1e-9&&ray.intersectObject(arrow.cone).length>0;
      if(coneHit){
        rotating=true;orbit.enabled=false;
        plane.setFromNormalAndCoplanarPoint(camera.position.clone().sub(orbit.target).normalize(),arrow.cone.getWorldPosition(new THREE.Vector3()));
        canvas.setPointerCapture(e.pointerId);e.preventDefault();return;
      }
      if(ray.intersectObject(source).length===0)return;
      dragging=true;orbit.enabled=false;
      plane.setFromNormalAndCoplanarPoint(camera.position.clone().sub(orbit.target).normalize(),source.position);
      canvas.setPointerCapture(e.pointerId);e.preventDefault();
    };
    const move=(e:PointerEvent)=>{
      if(movingElectrode&&data.scalp_field_grid){
        pick(e);if(!ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(),data.radius_mm),point))return;
        let best=0,min=Infinity;data.scalp_field_grid.positions_mm.forEach((p,i)=>{const dist=point.distanceToSquared(new THREE.Vector3(...p));if(dist<min){min=dist;best=i;}});
        const label=movingElectrode;setElectrodeVertices(prev=>({...prev,[label]:best}));return;
      }
      if(!dragging&&!rotating)return;
      pick(e);if(!ray.ray.intersectPlane(plane,point))return;
      if(rotating){
        const vector=point.clone().sub(source.position).normalize().multiplyScalar(displayQ<0?-1:1);
        if(vector.lengthSq()>.99){setOrientation([vector.x,vector.y,vector.z]);setAxis('free');}
        return;
      }
      setPosition([
        THREE.MathUtils.clamp(point.x,-48,48),
        THREE.MathUtils.clamp(point.y,-48,48),
        THREE.MathUtils.clamp(point.z,-48,48),
      ]);
    };
    const up=(e:PointerEvent)=>{
      if(e.type==='pointerup'&&embedded&&!dragging&&!rotating&&!movingElectrode&&pointerStart&&Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)<6){
        pick(e);
        const hit=ray.intersectObjects([...dots.values()].filter(dot=>dot.visible))[0];
        if(hit){const label=[...dots.entries()].find(([,dot])=>dot===hit.object)?.[0];if(label)setSelectedElectrode(label);}
      }
      pointerStart=null;dragging=false;rotating=false;movingElectrode=null;orbit.enabled=true;
    };
    canvas.addEventListener('pointerdown',down);
    canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',up);
    canvas.addEventListener('pointercancel',up);
    const screenPoint=(object:THREE.Object3D)=>{
      const p=object.getWorldPosition(new THREE.Vector3()).project(camera),r=canvas.getBoundingClientRect();
      return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
    };
    const bridge={source:()=>screenPoint(source),arrow:()=>{
        const point=arrow.cone.localToWorld(new THREE.Vector3(0,-.5,0)).project(camera),r=canvas.getBoundingClientRect();
        return {x:r.left+(point.x+1)*r.width/2,y:r.top+(1-point.y)*r.height/2};
      },
      sensor:(label:string)=>{const dot=dots.get(label);return dot?screenPoint(dot):null;}};
    const owner=window as unknown as {__headPhysics?:typeof bridge};
    if(embedded)owner.__headPhysics=bridge;
    const resize=new ResizeObserver(()=>{
      const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
      camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);
    });resize.observe(host);
    sceneUpdate.current=(p,dir,voltage,q,scale,selected,fieldValues,sensorPositions,signalFactor)=>{
      const other=secondaryRef.current;secondSource.visible=!!other;secondArrow.visible=!!other&&Math.abs(other.moment*signalFactor)>1e-9;
      if(other){secondSource.position.set(...other.position);secondArrow.position.copy(secondSource.position);const sign=other.moment<0?-1:1;secondArrow.setDirection(new THREE.Vector3(...other.direction).multiplyScalar(sign));secondArrow.setLength(8+Math.min(42,Math.abs(other.moment*signalFactor)*1.2));}
      dots.forEach((dot,label)=>{const point=sensorPositions.get(label);if(point)dot.position.set(...point);});
      displayQ=q;
      source.position.set(...p);arrow.position.copy(source.position);
      const sign=q<0?-1:1;
      arrow.setDirection(new THREE.Vector3(dir[0]*sign,dir[1]*sign,dir[2]*sign));
      arrow.visible=Math.abs(q)>1e-9;
      arrow.setLength(8+Math.min(42,Math.abs(q)*1.2));
      const m=embedded?scale:Math.max(0.001,...[...voltage.values()].map(Math.abs));
      if(fieldGeometry&&fieldValues){
        const values=fieldValues;
        const colors=fieldGeometry.getAttribute('color') as THREE.BufferAttribute;
        values.forEach((v,j)=>{const c=potentialColor(v,scale);colors.setXYZ(j,c[0],c[1],c[2]);});
        colors.needsUpdate=true;
      }
      const chosen=dots.get(selected);
      selectedRing.visible=!!chosen?.visible;if(chosen)selectedRing.position.copy(chosen.position);
      dots.forEach((dot,label)=>{
        const v=voltage.get(label);
        dot.visible=v!==undefined;
        if(v!==undefined){
          if(embedded){const c=potentialColor(v,scale);(dot.material as THREE.MeshBasicMaterial).color.setRGB(...c);}
          else (dot.material as THREE.MeshBasicMaterial).color.set(Math.abs(v)<1e-9?0x6c8191:v>0?0xffb340:0x4fb6f2);
          dot.scale.setScalar(1+1.3*Math.min(Math.abs(v)/m,1));
        }
      });
    };
    let raf=0;
    const draw=()=>{raf=requestAnimationFrame(draw);orbit.update();renderer.render(scene,camera);};draw();
    return ()=>{
      cancelAnimationFrame(raf);resize.disconnect();sceneUpdate.current=null;
      if(embedded&&owner.__headPhysics===bridge)delete owner.__headPhysics;
      canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);
      canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);
      orbit.dispose();scene.traverse(obj=>{
        if(obj instanceof THREE.Mesh||obj instanceof THREE.Line){
          obj.geometry.dispose();const mat=obj.material;
          (Array.isArray(mat)?mat:[mat]).forEach((m:THREE.Material)=>m.dispose());
        }
      });renderer.dispose();canvas.remove();
    };
    // Scene lifecycle only on fixture load; all dynamical updates via sceneUpdate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[baseData]);
  useEffect(()=>sceneUpdate.current?.(position,direction,voltageMap,moment*factor,colorScale,selectedElectrode,scalpValues,new Map(data?.sensors.map(s=>[s.label,s.position_mm])??[]),factor),
    [position,direction,voltageMap,moment,colorScale,selectedElectrode,montage,reference,scalpValues,secondary,data,factor]);
  const vSelected=voltageMap.get(selectedElectrode);
  const max=Math.max(.001,...peaks.map(s=>Math.abs(s.v)));
  if (embedded) return <div className="manual-electric" data-testid="manual-electric">
    <section className="electric-model-view">
      <div className="model-instruction">{text('拖动源点移动 · 拖动箭头转向 · 点击电极查看 · 空白处旋转','Drag source to move · drag arrow to orient · click a sensor · drag empty space to orbit')}</div>
      <div ref={mount} className="electric-canvas" data-testid="physical-field"
        data-direction={direction.join(',')} data-color-scale={colorScale} data-time-ms={timeMs} data-waveform={waveform} data-model-id={data?.model_id??''} data-electrode-position={data?.sensors.find(s=>s.label===selectedElectrode)?.position_mm.join(',')??''}
        data-field-max={scalpValues?Math.max(...scalpValues.map(Math.abs)):''} role="img" aria-label={text('可拖动电流源的三维头部模型','3D head model with draggable current source')}/>
      <div className="electric-legend"><span className="legend-source"/>{text('橙色源点：电流源','Orange source: current dipole')}
       <span className="legend-positive"/>{text('正电位','Positive potential')}<span className="legend-negative"/>{text('负电位','Negative potential')}</div>
      <div className="physics-colorbar" aria-label={text('头皮电位色标','Scalp potential color scale')}>
        <span>−{colorScale} µV</span><span className="physics-color-gradient"/><span>+{colorScale} µV</span>
      </div>
      <div className="electric-results" aria-label={text('实际计算的电极读数','Computed electrode readings')}>
       <div><span>{text('所选测量点','Selected sensor')} · {selectedElectrode}</span>
        <output data-testid="selected-potential" data-voltage={vSelected??''}>{vSelected===undefined?'—':vSelected.toFixed(4)} <small>µV</small></output></div>
       <div><span>{text('幅度最大的测量点','Largest-magnitude sensor')} · {peaks[0]?.label??'—'}</span>
        <output data-testid="peak-potential" data-voltage={peaks[0]?.v??''}>{peaks[0]?.v.toFixed(4)??'—'} <small>µV</small></output></div>
      </div>
      <div className="physics-voltage-trace">
        <span>{waveform==='constant'?text('所选电极电位 · 源保持不变时','Selected sensor potential · source held constant'):text('所选电极的物理源脉冲响应','Selected sensor response to the defined source pulse')}</span>
        <svg viewBox="0 0 600 80" role="img" aria-label={waveform==='constant'?text('静态物理源的恒定电位','Constant potential from a static physical source'):text('给定源脉冲的电极电位','Sensor potential from the defined source pulse')}>
          <line x1="25" x2="575" y1="40" y2="40" stroke="#385167"/>
          <polyline data-testid="physical-static-trace" data-voltage={vSelected??''}
            points={Array.from({length:201},(_,i)=>{
              const base=baseReadings?.voltageUv[baseReadings.sensors.findIndex(s=>s.label===selectedElectrode)]??0;
              return (25+550*i/200)+','+(40-30*Math.max(-1,Math.min(1,base*sourceWaveformAt(waveform,i*10)/colorScale)));
            }).join(' ')} fill="none" stroke="#bde5fc" strokeWidth="2"/>
          <text x="25" y="76" fill="#9fb6c6" fontSize="12">0 s</text><text x="550" y="76" fill="#9fb6c6" fontSize="12">2 s</text>
        </svg>
      </div>
      <p className="plain-explanation">{text('改变源的位置、方向或强度，比较同一个测量点的读数。颜色和圆点大小使用固定微伏色标，白色圈标出当前测量电极。','Change the source position, orientation or strength, then compare the same sensor. Colors and dot sizes use a fixed µV scale. A white ring marks the selected sensor.')}</p>
    </section>
    <aside className="physics-controls">
      <div className="control-step"><span>1</span><h2>{text('移动电流源','Move the source')}</h2></div>
      <p className="plain-explanation">{text('直接拖动橙色源点；也可以用下面三个滑杆精确调整。','Drag the orange point, or use these sliders for precise positioning.')}</p>
      {([0,1,2] as const).map(i=><RangeControl key={i} disabled={!data} label={text(['左右位置','前后位置','上下位置'][i],['Left–right position','Front–back position','Vertical position'][i])}
        value={position[i]} min={-48} max={48} step={1} unit="mm" onChange={value=>setPosition(prev=>[i===0?value:prev[0],i===1?value:prev[1],i===2?value:prev[2]])}/>)}
      <div className="control-step"><span>2</span><h2>{text('调整方向与强度','Set direction and strength')}</h2></div>
      <ControlField label={text('电流方向','Current direction')} hint={text('箭头表示方向；改变方向会改变各测量点的电位。','The arrow shows direction. Changing it changes the measured potentials.')}>
        <Dropdown disabled={!data} aria-label={text('电流方向','Current direction')} value={axis} onChange={e=>{if(e.target.value==='free')setOrientation(direction);setAxis(e.target.value as 'X'|'Y'|'Z'|'free');}}>
          <option value="X">{text('左右方向','Left–right')}</option><option value="Y">{text('前后方向','Front–back')}</option><option value="Z">{text('上下方向','Up–down')}</option><option value="free">{text('自由方向','Free orientation')}</option>
        </Dropdown>
      </ControlField>
      <details className="physics-details"><summary>{text('精确调整方向','Precise orientation')}</summary>
        <RangeControl label={text('水平方向角','Azimuth')} value={Number(azimuth.toFixed(1))} min={-180} max={180} step={1} unit="°" onChange={a=>setAngles(a,elevation)}/>
        <RangeControl label={text('上下方向角','Elevation')} value={Number(elevation.toFixed(1))} min={-90} max={90} step={1} unit="°" onChange={e=>setAngles(azimuth,e)}/>
      </details>
      <button type="button" className="ui-button" onClick={()=>setMoment(q=>-q)}>{text('反转电流方向','Reverse current direction')}</button>
      <RangeControl disabled={!data} label={text('源强度','Source strength')} value={moment} min={-30} max={30} step={0.5} unit="nA·m" onChange={setMoment}/>
      <div className="control-step"><span>3</span><h2>{text('选择测量点','Choose a sensor')}</h2></div>
      <ControlField label={text('查看电极','Sensor to inspect')} hint={text('电极是放在头皮上的测量点。左侧读数随你的改动即时更新。','An electrode is a measurement point on the scalp. Readings update as you make changes.')}>
        <Dropdown aria-label={text('查看电极','Sensor to inspect')} value={selectedElectrode} onChange={e=>setSelectedElectrode(e.target.value)}>
          {(readings?.sensors??[]).map(s=><option key={s.label} value={s.label}>{s.label}</option>)}
        </Dropdown>
      </ControlField>
      <details className="physics-details"><summary>{text('更多设置与模型说明','More settings and model details')}</summary>
       <ControlField label={text('源的时间变化','Source time course')}>
        <Dropdown aria-label={text('源的时间变化','Source time course')} value={waveform} onChange={e=>{setWaveform(e.target.value as 'constant'|'pulse');setTimeMs(e.target.value==='pulse'?600:0);setPulsePlaying(false);}}>
         <option value="constant">{text('保持恒定','Constant')}</option><option value="pulse">{text('200 ms 半正弦脉冲','200 ms half-sine pulse')}</option>
        </Dropdown>
       </ControlField>
       {waveform==='pulse'&&<>
        <RangeControl label={text('物理源观察时刻','Physical source observation time')} unit="ms" value={Number(timeMs.toFixed(0))} min={0} max={2000} step={4} onChange={v=>{setPulsePlaying(false);setTimeMs(v);}}/>
        <button type="button" className="ui-button" onClick={()=>{setTimeMs(0);setPulsePlaying(true);}}>{text('播放这次源脉冲','Play this source pulse')}</button>
        <p>{text('源在 500–700 ms 按半正弦改变偶极矩；这是明确给定的电流输入，不是认知 ERP。记录直接计算每个采样时刻，播放帧率不改变数据。','Moment follows a half-sine over 500–700 ms: a defined current input, not a cognitive ERP. Each recording sample is calculated directly; playback frame rate does not change the data.')}</p>
       </>}
       <ControlField label={text('颅骨电导率','Skull conductivity')} hint={text('切换到对应 MNE 正向矩阵；不是只改显示数值。','Loads the corresponding MNE forward matrix.')}>
        <Dropdown aria-label={text('颅骨电导率','Skull conductivity')} value={modelId} onChange={e=>setModelId(e.target.value)}>
         <option value={SPHERE_MODEL_ID+'-skull-0.002'}>0.002 S/m</option><option value={SPHERE_MODEL_ID}>0.004 S/m</option><option value={SPHERE_MODEL_ID+'-skull-0.008'}>0.008 S/m</option>
        </Dropdown>
       </ControlField>
       <label className="plain-explanation"><input type="checkbox" checked={editElectrodes} onChange={e=>setEditElectrodes(e.target.checked)}/>{text('沿头皮拖动电极','Drag electrodes along the scalp')}</label>
       <p>{text('电极吸附到 482 个已计算的头皮点；位置与对应矩阵行一起更新，不对任意位置冒充精确求解。','Sensors snap to 482 solved scalp vertices; position and leadfield row update together. Arbitrary locations are not claimed as exact solves.')}</p>
       <ControlField label={text('第二个电流源','Second current source')}>
        <Dropdown aria-label={text('第二个电流源','Second current source')} value={secondary?'on':'off'} onChange={e=>setSecondary(e.target.value==='on'?{position:[16,0,16],direction:[1,0,0],moment:10}:undefined)}>
         <option value="off">{text('关闭','Off')}</option><option value="on">{text('添加第二个源','Add a second source')}</option>
        </Dropdown>
       </ControlField>
       {secondary&&<>
        {([0,1,2] as const).map(i=><RangeControl key={i} label={text(['第二源左右位置','第二源前后位置','第二源上下位置'][i],['Second source X','Second source Y','Second source Z'][i])} unit="mm" value={secondary.position[i]} min={-48} max={48} step={1}
         onChange={v=>setSecondary(p=>p?{...p,position:[i===0?v:p.position[0],i===1?v:p.position[1],i===2?v:p.position[2]]}:p)}/>)}
        <RangeControl label={text('第二源强度','Second source strength')} unit="nA·m" value={secondary.moment} min={-30} max={30} step={.5} onChange={v=>setSecondary(p=>p?{...p,moment:v}:p)}/>
        <p>{text('紫色源当前沿 X 轴；正负强度控制极性。总电位是两个源的线性叠加。','The purple source is oriented along X; signed strength controls polarity. Total voltage is the linear sum of both sources.')}</p>
       </>}
       <RangeControl label={text('电位色标范围','Potential color range')} value={colorScale} min={.1} max={10} step={.1} unit="µV" onChange={setColorScale}/>
       <p>{text('颜色使用固定微伏色标。增强源时颜色幅度会变化；超过色标范围的颜色会饱和，数字仍显示完整值。','Colors use a fixed µV scale. Source strength changes color amplitude. Colors saturate beyond the scale; numerical readings remain complete.')}</p>
       <ControlField label={text('电极布局','Electrode layout')}>
        <Dropdown aria-label={text('电极布局','Electrode layout')} value={montage} onChange={e=>{setMontage(e.target.value as MontageKey);setSelectedLabels(undefined);setReference('average');setSelectedElectrode('Cz');}}>
          <option value="10-20">10–20 · 19</option><option value="10-10">10–10 · 94</option><option value="10-05">10–05 · 343</option>
        </Dropdown>
       </ControlField>
       <details className="physics-details"><summary>{text('自由组合测量电极','Choose your electrodes')} · {activeLabels.length}/{availableLabels.length}</summary>
        <p>{text('取消勾选不需要的电极。至少保留 4 个；平均参考只计算所选电极。通道越少，空间信息和逆解约束越弱。','Uncheck sensors you do not need. Keep at least 4. Average reference uses only selected sensors. Fewer channels provide less spatial information and weaker inverse constraints.')}</p>
        <button type="button" className="ui-button" disabled={!data} onClick={()=>chooseLabels(undefined)}>{text('使用全部电极','Use all electrodes')}</button>
        <button type="button" className="ui-button" disabled={!data||reference==='electrode'} onClick={()=>chooseLabels(['F3','F4','C3','C4','P3','P4'])}>{text('简洁六电极','Simple six sensors')}</button>
        <div role="group" aria-label={text('选择记录电极','Recording electrodes')} style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(80px,1fr))',gap:6,maxHeight:200,overflowY:'auto'}}>
         {availableLabels.map(label=><label key={label}><input type="checkbox" aria-label={text('记录电极 ','Include electrode ')+label}
          checked={activeLabels.includes(label)} disabled={activeLabels.includes(label)&&(activeLabels.length<=4||(referenceSpec.mode==='electrode'&&referenceSpec.label===label))}
          onChange={e=>chooseLabels(e.target.checked?availableLabels.filter(x=>x===label||activeLabels.includes(x)):activeLabels.filter(x=>x!==label))}/>{label}</label>)}
        </div>
       </details>
       <ControlField label={text('参考方式','Voltage reference')}>
        <Dropdown aria-label={text('参考方式','Voltage reference')} value={reference} onChange={e=>setReference(e.target.value as 'average'|'infinity')}>
         {reference==='electrode'&&<option value="electrode">{text('电极参考','Electrode reference')} · {referenceSpec.mode==='electrode'?referenceSpec.label:''}</option>}
         <option value="average">{text('所有电极的平均值','Average over electrodes')}</option><option value="infinity">{text('理论无限远参考','Theoretical infinity reference')}</option>
        </Dropdown>
       </ControlField>
       <p>{text('四层球形导体依次表示脑组织、脑脊液、颅骨与头皮。MNE 计算的正向模型把源的位置、方向和强度转换为电极电位。坐标为毫米，源强度为纳安米，电位为微伏。','Four conducting layers represent brain, cerebrospinal fluid, skull and scalp. The MNE forward model converts source position, orientation and moment into sensor potentials. Position is in mm, moment in nA·m, and voltage in µV.')}</p>
       <p>{text('这是半径 95 mm 的球形教学模型，源限制在 ±48 mm 的已计算网格内；它不是个体 MRI，也没有与另一页的脑区网络做解剖配准。','This is a spherical teaching model with radius 95 mm and a precomputed source grid within ±48 mm. It is not individual MRI and is not anatomically registered to the separate region network.')}</p>
       <code>{data?.model_id??modelId}</code>
      </details>
      <button type="button" className="ui-button" onClick={()=>{setPosition([16,0,16]);setMoment(10);setAxis('X');setOrientation([1,0,0]);setColorScale(2);setWaveform('constant');setTimeMs(0);setPulsePlaying(false);setSecondary(undefined);setElectrodeVertices({});setEditElectrodes(false);setModelId(SPHERE_MODEL_ID);setMontage('10-20');setSelectedLabels(undefined);setReference('average');setSelectedElectrode('Cz');setLiveMode(false);}}>{text('恢复默认','Restore defaults')}</button>
      {!data&&!error&&<p role="status">{text('正在加载物理模型…','Loading the physical model…')}</p>}
      {error&&<div className="physics-error" role="alert"><p>{text('物理模型没有加载成功，请刷新重试。','The physical model could not load. Reload to retry.')}</p><details><summary>{text('技术信息','Technical details')}</summary>{error}</details></div>}
    </aside>
  </div>;
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal screen" role="dialog" aria-modal="true"
      aria-label="分层球形头EEG物理实验" onClick={e=>e.stopPropagation()}
      style={{width:'min(1190px,96vw)',maxWidth:'none',maxHeight:'86vh'}}>
      <div className="screen-title" style={{display:'flex',justifyContent:'space-between',alignItems:'center',right:0,pointerEvents:'auto'}}>
        FOUR-LAYER SPHERE · PHYSICS EEG
        <button type="button" className="chip chip-small" onClick={onClose}>关闭</button>
      </div>
      <div className="modal-body">
        {onOpenReal&&<button type="button" className="chip chip-small"
          onClick={onOpenReal} aria-label={text("打开真实模板 MRI BEM","Open anatomical template MRI BEM")}>
          {text("进阶：真实 MRI/BEM（自动加载模板）","Advanced: anatomical MRI/BEM (template loads automatically)")}
        </button>}
        <p className="panel-text" style={{color:'#ffb340'}}>经 MNE 计算的四层球形导体：脑组织、脑脊液、颅骨和头皮。是模型级 EEG 正向仿真，不是个体 MRI/BEM，亦未与 TVB 76区皮层配准。</p>
        <label className="panel-text">
          <input type="checkbox" checked={liveMode && !!liveSource} disabled={!liveSource}
            onChange={(e)=>setLiveMode(e.target.checked)} />{' '}
          直播源：用选中脑区的直播偶极子（位置取脑区中心，q 由 live E/I 经 PR5 假设链算）
        </label>
        {liveMode && liveSource ? (
          <p className="panel-text" style={{color:'#7dd3a8'}}>
            直播源：#{liveSource.regionId} {liveSource.regionLabel} · q = {liveSource.momentNAm.toFixed(3)} nA·m
            （live E/I 经 PR5 假设链，基线 = 选区切换时该脑区的 E/I；偶极矩矢量 = q × 下方所选方向，法向是假设）
            · 位置 = 脑区中心（TVB 坐标、未配准 HEAD，钳制进 ±48 mm 球网格）· 改选区、改 G 后电位跟着变。
          </p>
        ) : (
          <p className="panel-text" style={{color:'#ffb340'}}>
            独立演示：手动偶极子，未接主仿真（拖动源 / 改偶极矩只改本实验；想接直播先在主界面选一个脑区，再勾选“直播源”）。
          </p>
        )}
        {error&&<p role="alert" className="panel-text">{error}</p>}
        {!data&&!error&&<p className="panel-text">正在加载 MNE 正向模型…</p>}
        {data&&<p className="panel-text">模型 {SPHERE_MODEL_ID} · MNE {data.mne_version} · 电极头坐标方向径向投影到 95 mm 球面 · 源位置插值（已独立验证误差）</p>}
        <div className="lab-split">
          <div ref={mount} role="img" aria-label="MNE四层球形头模型与可拖动源"
            style={{width:'100%',height:425,border:'1px solid #133954'}}/>
          <div style={{minWidth:0}}>
            <div className="conn-title">可直接操作的物理参数</div>
            <label className="panel-text">电极布局
              <Dropdown aria-label="电极布局" value={montage}
                onChange={e=>{setMontage(e.target.value as MontageKey);setSelectedLabels(undefined);setReference('average');setSelectedElectrode('Cz');}}>
                <option value="10-20">10–20 基础 19 导</option>
                <option value="10-10">扩展 10–10 · 94 导</option>
                <option value="10-05">10–05 · 343 导</option>
              </Dropdown>
            </label>
            <label className="panel-text">源方向
              <Dropdown aria-label="球形头电流源方向" value={axis}
                onChange={e=>setAxis(e.target.value as 'X'|'Y'|'Z')}>
                <option value="X">X 左右</option><option value="Y">Y 前后</option><option value="Z">Z 上下</option>
              </Dropdown>
            </label>
            <p className="panel-text">偶极矩 {moment.toFixed(1)} nA·m{liveMode && liveSource ? '（直播值，滑杆已锁定）' : ''}</p>
            <input type="range" aria-label="球形头偶极矩" min="-30" max="30" step=".5"
              value={moment} disabled={liveMode && !!liveSource} onChange={e=>setMoment(Number(e.target.value))} style={{width:'100%'}}/>
            <label className="panel-text">EEG 参考
              <Dropdown aria-label="球形头参考方式" value={reference}
                onChange={e=>setReference(e.target.value as 'average'|'infinity')}>
                <option value="average">当前电极平均参考</option>
                <option value="infinity">无限远理论参考</option>
              </Dropdown>
            </label>
            <label className="panel-text">查看电极
              <Dropdown aria-label="选中电极" value={selectedElectrode}
                onChange={e=>setSelectedElectrode(e.target.value)}>
                {(readings?.sensors??[]).map(s=><option value={s.label} key={s.label}>{s.label}</option>)}
              </Dropdown>
            </label>
            <p className="panel-text">源位置 mm：{position.map(x=>x.toFixed(1)).join(', ')}</p>
            <p className="panel-text">当前电极电位：{vSelected===undefined?'—':vSelected.toFixed(4)+' µV'}</p>
            {peaks.length > 0 && (
              <p className="panel-text">最大电极：{peaks[0].label} {peaks[0].v.toFixed(4)} µV（{peaks.length} 导中幅值最大，尖峰时跟最大值走）</p>
            )}
            <button type="button" className="chip chip-small" onClick={()=>{
              setPosition([0,0,16]);setMoment(10);setAxis('X');setMontage('10-20');setSelectedLabels(undefined);setReference('average');setSelectedElectrode('Cz');
              setLiveMode(false);
            }}>重置球形实验（回到手动偶极子）</button>
            <div className="conn-title">电极信号（幅值前 19 位）</div>
            {peaks.slice(0,19).map(s=><div key={s.label}
              style={{display:'flex',gap:5,alignItems:'center',marginBottom:3}}>
              <span style={{width:34}}>{s.label}</span>
              <div style={{flex:1,background:'#152938',height:7,position:'relative'}}>
                <div style={{position:'absolute',left:'50%',width:1,height:7,background:'#b8c5cf'}}/>
                <div style={{
                  position:'absolute',left:(s.v<0?50-48*Math.abs(s.v)/max:50)+'%',
                  width:(48*Math.abs(s.v)/max)+'%',height:7,
                  background:s.v>=0?'#ffb340':'#4fb6f2',
                }}/>
              </div>
              <span className="mono" style={{minWidth:58,textAlign:'right'}}>{s.v.toFixed(3)}</span>
            </div>)}
          </div>
        </div>
        <p className="panel-text">限制：球形半径 95 mm，4 层电导率 0.33/1/0.004/0.33 S/m；源只允许在 ±48 mm 三维规则网格内，网格间三线性插值；电极取 MNE 标准布局的方向并投影到球面，不是原始头皮形状。无 MRI、MNI/Talairach、BEM/FEM、神经群体源校准；不用于临床推断。</p>
      </div>
    </div>
  </div>;
}
