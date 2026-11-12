import Dropdown from './ui/Dropdown';
import { ControlField, RangeControl } from './ui/ControlField';
import { useI18n } from '../lib/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  SPHERE_MODEL_ID, sphereElectrodePotentials, validateSphereFixture,
  type SphereFixture, type MontageKey,
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
  const {locale}=useI18n();
  const text=(zh:string,en:string)=>locale==='zh-CN'?zh:en;
  const [data,setData]=useState<SphereFixture|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [position,setPosition]=useState<Vec3Mm>(embedded?[16,0,16]:[0,0,16]);
  const [axis,setAxis]=useState<'X'|'Y'|'Z'>('X');
  const [moment,setMoment]=useState(10);
  const [montage,setMontage]=useState<MontageKey>('10-20');
  const [reference,setReference]=useState<'average'|'infinity'>('average');
  const [selectedElectrode,setSelectedElectrode]=useState('Cz');
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
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
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
  if (embedded) return <div className="manual-electric" data-testid="manual-electric">
    <section className="electric-model-view">
      <div className="model-instruction">{text('拖动橙色源点 · 拖动空白处旋转 · 滚轮缩放','Drag the orange source · drag empty space to rotate · scroll to zoom')}</div>
      <div ref={mount} className="electric-canvas" role="img" aria-label={text('可拖动电流源的三维头部模型','3D head model with draggable current source')}/>
      <div className="electric-legend"><span className="legend-source"/>{text('橙色源点：电流源','Orange source: current dipole')}
       <span className="legend-positive"/>{text('正电位','Positive potential')}<span className="legend-negative"/>{text('负电位','Negative potential')}</div>
      <div className="electric-results" aria-label={text('实际计算的电极读数','Computed electrode readings')}>
       <div><span>{text('所选测量点','Selected sensor')} · {selectedElectrode}</span>
        <output data-testid="selected-potential" data-voltage={vSelected??''}>{vSelected===undefined?'—':vSelected.toFixed(4)} <small>µV</small></output></div>
       <div><span>{text('幅度最大的测量点','Largest-magnitude sensor')} · {peaks[0]?.label??'—'}</span>
        <output data-testid="peak-potential" data-voltage={peaks[0]?.v??''}>{peaks[0]?.v.toFixed(4)??'—'} <small>µV</small></output></div>
      </div>
      <p className="plain-explanation">{text('改变源的位置、方向或强度，比较同一个测量点的读数。圆点大小表示同一时刻不同电极的相对幅度。','Change the source position, orientation or strength, then compare the same sensor. Dot sizes show relative amplitudes across electrodes at the current moment.')}</p>
    </section>
    <aside className="physics-controls">
      <div className="control-step"><span>1</span><h2>{text('移动电流源','Move the source')}</h2></div>
      <p className="plain-explanation">{text('直接拖动橙色源点；也可以用下面三个滑杆精确调整。','Drag the orange point, or use these sliders for precise positioning.')}</p>
      {([0,1,2] as const).map(i=><RangeControl key={i} label={text(['左右位置','前后位置','上下位置'][i],['Left–right position','Front–back position','Vertical position'][i])}
        value={position[i]} min={-48} max={48} step={1} unit="mm" onChange={value=>setPosition(prev=>prev.map((v,k)=>k===i?value:v) as Vec3Mm)}/>)}
      <div className="control-step"><span>2</span><h2>{text('调整方向与强度','Set direction and strength')}</h2></div>
      <ControlField label={text('电流方向','Current direction')} hint={text('箭头表示方向；改变方向会改变各测量点的电位。','The arrow shows direction. Changing it changes the measured potentials.')}>
        <Dropdown aria-label={text('电流方向','Current direction')} value={axis} onChange={e=>setAxis(e.target.value as 'X'|'Y'|'Z')}>
          <option value="X">{text('左右方向','Left–right')}</option><option value="Y">{text('前后方向','Front–back')}</option><option value="Z">{text('上下方向','Up–down')}</option>
        </Dropdown>
      </ControlField>
      <RangeControl label={text('源强度','Source strength')} value={moment} min={0} max={30} step={0.5} unit="nA·m" onChange={setMoment}/>
      <div className="control-step"><span>3</span><h2>{text('选择测量点','Choose a sensor')}</h2></div>
      <ControlField label={text('查看电极','Sensor to inspect')} hint={text('电极是放在头皮上的测量点。左侧读数随你的改动即时更新。','An electrode is a measurement point on the scalp. Readings update as you make changes.')}>
        <Dropdown aria-label={text('查看电极','Sensor to inspect')} value={selectedElectrode} onChange={e=>setSelectedElectrode(e.target.value)}>
          {(readings?.sensors??[]).map(s=><option key={s.label} value={s.label}>{s.label}</option>)}
        </Dropdown>
      </ControlField>
      <details className="physics-details"><summary>{text('更多设置与模型说明','More settings and model details')}</summary>
       <ControlField label={text('电极布局','Electrode layout')}>
        <Dropdown aria-label={text('电极布局','Electrode layout')} value={montage} onChange={e=>{setMontage(e.target.value as MontageKey);setSelectedElectrode('Cz');}}>
          <option value="10-20">10–20 · 19</option><option value="10-10">10–10 · 94</option><option value="10-05">10–05 · 343</option>
        </Dropdown>
       </ControlField>
       <ControlField label={text('参考方式','Voltage reference')}>
        <Dropdown aria-label={text('参考方式','Voltage reference')} value={reference} onChange={e=>setReference(e.target.value as 'average'|'infinity')}>
         <option value="average">{text('所有电极的平均值','Average over electrodes')}</option><option value="infinity">{text('理论无限远参考','Theoretical infinity reference')}</option>
        </Dropdown>
       </ControlField>
       <p>{text('四层球形导体依次表示脑组织、脑脊液、颅骨与头皮。MNE 计算的正向模型把源的位置、方向和强度转换为电极电位。坐标为毫米，源强度为纳安米，电位为微伏。','Four conducting layers represent brain, cerebrospinal fluid, skull and scalp. The MNE forward model converts source position, orientation and moment into sensor potentials. Position is in mm, moment in nA·m, and voltage in µV.')}</p>
       <p>{text('这是半径 95 mm 的球形教学模型，源限制在 ±48 mm 的已计算网格内；它不是个体 MRI，也没有与另一页的脑区网络做解剖配准。','This is a spherical teaching model with radius 95 mm and a precomputed source grid within ±48 mm. It is not individual MRI and is not anatomically registered to the separate region network.')}</p>
       <code>{SPHERE_MODEL_ID}</code>
      </details>
      <button type="button" className="ui-button" onClick={()=>{setPosition([16,0,16]);setMoment(10);setAxis('X');setMontage('10-20');setReference('average');setSelectedElectrode('Cz');setLiveMode(false);}}>{text('恢复默认','Restore defaults')}</button>
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
          onClick={onOpenReal} aria-label="打开本地真实 MRI BEM">
          进阶：真实 MRI/BEM（加载自行获取的模板）
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
                onChange={e=>{setMontage(e.target.value as MontageKey);setSelectedElectrode('Cz');}}>
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
              setPosition([0,0,16]);setMoment(10);setAxis('X');setMontage('10-20');setReference('average');setSelectedElectrode('Cz');
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
