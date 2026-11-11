import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  SPHERE_MODEL_ID, sphereElectrodePotentials, validateSphereFixture,
  type SphereFixture, type MontageKey,
} from '../lib/sphereForward';
import type { Vec3Mm } from '../lib/volumeConduction';

/**
 * MNE four-shell spherical volume-conduction demonstration.
 * Coordinates/electrode directions are registered to a common HEAD space,
 * NOT to the TVB demo cortex. This is deliberately independent from
 * BrainScene: none of its cortical vertices are claimed to be MNI.
 */
export default function HeadSphereLab({onClose,onOpenReal}:{onClose:()=>void;onOpenReal?:()=>void}) {
  const [data,setData]=useState<SphereFixture|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [position,setPosition]=useState<Vec3Mm>([0,0,16]);
  const [axis,setAxis]=useState<'X'|'Y'|'Z'>('X');
  const [moment,setMoment]=useState(10);
  const [montage,setMontage]=useState<MontageKey>('10-20');
  const [reference,setReference]=useState<'average'|'infinity'>('average');
  const [selectedElectrode,setSelectedElectrode]=useState('Cz');
  const mount=useRef<HTMLDivElement>(null);
  const sceneUpdate=useRef<((p:Vec3Mm,dir:Vec3Mm,voltages:Map<string,number>)=>void)|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    fetch(import.meta.env.BASE_URL+'forward-assets/sphere-model.json',{signal:controller.signal})
      .then(async r=>{
        if(!r.ok)throw new Error('模型资源缺失：请先运行 scientific/forward/generate_sphere_model.py');
        const fixture=await r.json() as SphereFixture;
        validateSphereFixture(fixture);
        setData(fixture);
      }).catch(e=>{if(!controller.signal.aborted)setError(String(e));});
    return ()=>controller.abort();
  },[]);
  const direction=useMemo<Vec3Mm>(()=>axis==='X'?[1,0,0]:axis==='Y'?[0,1,0]:[0,0,1],[axis]);
  const readings=useMemo(()=>{
    if(!data)return null;
    return sphereElectrodePotentials(data,position,[
      direction[0]*moment,direction[1]*moment,direction[2]*moment,
    ],montage,{mode:reference});
  },[data,position,direction,moment,montage,reference]);
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
    makeShell(data.radius_mm,0x3771a2,0.12);
    makeShell(data.radius_mm*0.97,0x567b94,0.06);
    makeShell(data.radius_mm*0.92,0x479ba0,0.07);
    makeShell(data.brain_inner_radius_mm,0x23547d,0.08);
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
    const ray=new THREE.Raycaster(), xy=new THREE.Vector2(), point=new THREE.Vector3();
    const plane=new THREE.Plane();
    const canvas=renderer.domElement;canvas.style.touchAction='none';
    let dragging=false;
    const pick=(e:PointerEvent)=>{
      const rect=canvas.getBoundingClientRect();
      xy.set(2*(e.clientX-rect.left)/rect.width-1,1-2*(e.clientY-rect.top)/rect.height);
      ray.setFromCamera(xy,camera);
    };
    const down=(e:PointerEvent)=>{
      pick(e);
      if(ray.intersectObject(source).length===0)return;
      dragging=true;orbit.enabled=false;
      plane.setFromNormalAndCoplanarPoint(camera.position.clone().sub(orbit.target).normalize(),source.position);
      canvas.setPointerCapture(e.pointerId);e.preventDefault();
    };
    const move=(e:PointerEvent)=>{
      if(!dragging)return;
      pick(e);if(!ray.ray.intersectPlane(plane,point))return;
      setPosition([
        THREE.MathUtils.clamp(point.x,-48,48),
        THREE.MathUtils.clamp(point.y,-48,48),
        THREE.MathUtils.clamp(point.z,-48,48),
      ]);
    };
    const up=()=>{dragging=false;orbit.enabled=true;};
    canvas.addEventListener('pointerdown',down);
    canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',up);
    canvas.addEventListener('pointercancel',up);
    const resize=new ResizeObserver(()=>{
      const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
      camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);
    });resize.observe(host);
    sceneUpdate.current=(p,dir,voltage)=>{
      source.position.set(...p);arrow.position.copy(source.position);
      arrow.setDirection(new THREE.Vector3(...dir));
      const m=Math.max(0.001,...[...voltage.values()].map(Math.abs));
      dots.forEach((dot,label)=>{
        const v=voltage.get(label);
        dot.visible=v!==undefined;
        if(v!==undefined){
          (dot.material as THREE.MeshBasicMaterial).color.set(v>=0?0xffb340:0x4fb6f2);
          dot.scale.setScalar(1+1.3*Math.abs(v)/m);
        }
      });
    };
    let raf=0;
    const draw=()=>{raf=requestAnimationFrame(draw);orbit.update();renderer.render(scene,camera);};draw();
    return ()=>{
      cancelAnimationFrame(raf);resize.disconnect();sceneUpdate.current=null;
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
  },[data]);
  useEffect(()=>sceneUpdate.current?.(position,direction,voltageMap),
    [position,direction,voltageMap]);
  const vSelected=voltageMap.get(selectedElectrode);
  const max=Math.max(.001,...peaks.map(s=>Math.abs(s.v)));
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal screen" role="dialog" aria-modal="true"
      aria-label="分层球形头EEG物理实验" onClick={e=>e.stopPropagation()}
      style={{width:'min(1190px,96vw)',maxWidth:'none',maxHeight:'94vh'}}>
      <div className="screen-title" style={{display:'flex',justifyContent:'space-between',alignItems:'center',right:0,pointerEvents:'auto'}}>
        FOUR-LAYER SPHERE · PHYSICS EEG
        <button type="button" className="chip chip-small" onClick={onClose}>关闭</button>
      </div>
      <div className="modal-body">
        {onOpenReal&&<button type="button" className="chip chip-small"
          onClick={onOpenReal} aria-label="打开本地真实 MRI BEM">
          进阶：真实 MRI/BEM（加载自行获取的模板）
        </button>}
        <p className="panel-text" style={{color:'#ffb340'}}>经 MNE 计算的四层球形导体：脑组织、脑脊液、颅骨和头皮。是模型级 EEG 正向仿真，不是个体 MRI/BEM，亦未与 TVB 76区皮层配准。</p>
        {error&&<p role="alert" className="panel-text">{error}</p>}
        {!data&&!error&&<p className="panel-text">正在加载 MNE 正向模型…</p>}
        {data&&<p className="panel-text">模型 {SPHERE_MODEL_ID} · MNE {data.mne_version} · 电极头坐标方向径向投影到 95 mm 球面 · 源位置插值（已独立验证误差）</p>}
        <div style={{display:'grid',gridTemplateColumns:'minmax(0, 1.5fr) minmax(230px, 1fr)',gap:12}}>
          <div ref={mount} role="img" aria-label="MNE四层球形头模型与可拖动源"
            style={{width:'100%',height:425,border:'1px solid #133954'}}/>
          <div style={{minWidth:0}}>
            <div className="conn-title">可直接操作的物理参数</div>
            <label className="panel-text">电极布局
              <select aria-label="电极布局" value={montage}
                onChange={e=>{setMontage(e.target.value as MontageKey);setSelectedElectrode('Cz');}}>
                <option value="10-20">10–20 基础 19 导</option>
                <option value="10-10">扩展 10–10 · 94 导</option>
                <option value="10-05">10–05 · 343 导</option>
              </select>
            </label>
            <label className="panel-text">源方向
              <select aria-label="球形头电流源方向" value={axis}
                onChange={e=>setAxis(e.target.value as 'X'|'Y'|'Z')}>
                <option value="X">X 左右</option><option value="Y">Y 前后</option><option value="Z">Z 上下</option>
              </select>
            </label>
            <p className="panel-text">偶极矩 {moment.toFixed(1)} nA·m</p>
            <input type="range" aria-label="球形头偶极矩" min="-30" max="30" step=".5"
              value={moment} onChange={e=>setMoment(Number(e.target.value))} style={{width:'100%'}}/>
            <label className="panel-text">EEG 参考
              <select aria-label="球形头参考方式" value={reference}
                onChange={e=>setReference(e.target.value as 'average'|'infinity')}>
                <option value="average">当前电极平均参考</option>
                <option value="infinity">无限远理论参考</option>
              </select>
            </label>
            <label className="panel-text">查看电极
              <select aria-label="选中电极" value={selectedElectrode}
                onChange={e=>setSelectedElectrode(e.target.value)}>
                {(readings?.sensors??[]).map(s=><option value={s.label} key={s.label}>{s.label}</option>)}
              </select>
            </label>
            <p className="panel-text">源位置 mm：{position.map(x=>x.toFixed(1)).join(', ')}</p>
            <p className="panel-text">当前电极电位：{vSelected===undefined?'—':vSelected.toFixed(4)+' µV'}</p>
            <button type="button" className="chip chip-small" onClick={()=>{
              setPosition([0,0,16]);setMoment(10);setAxis('X');setMontage('10-20');setReference('average');setSelectedElectrode('Cz');
            }}>重置球形实验</button>
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
