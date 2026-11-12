import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
 DEFAULT_CONDUCTIVITY_S_M, MODEL_LIMITATION, demoSphereSensors,
 sensorPotentialsMicrovolts, type Vec3Mm,
} from '../lib/volumeConduction';

/** Educational unbounded homogeneous conductor; NOT a head BEM or a TVB neural source. */
export default function DipoleLab({ onClose, liveSource }: { onClose: () => void;
  /**
   * PR8-LINK 直播源（App 传）：选中脑区的 TVB 中心 + 由直播 E/I 经 PR5
   * q 链算出的偶极矩（基线 = 选区切换时该脑区的 E/I）。不传时只有手动
   * 偶极子一路（独立演示）。
   */
  liveSource?: { positionMm: Vec3Mm; momentNAm: number; regionLabel: string; regionId: number } | null;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const display = useRef<((p: Vec3Mm, dir: Vec3Mm, volts: number[]) => void) | null>(null);
  const [position, setPosition] = useState<Vec3Mm>([0, 0, 0]);
  const [axis, setAxis] = useState<'X'|'Y'|'Z'>('X');
  const [moment, setMoment] = useState(10);
  const [conductivity, setConductivity] = useState(DEFAULT_CONDUCTIVITY_S_M);
  const [reference, setReference] = useState<'average'|'infinity'>('average');
  // PR8-LINK：直播模式（默认开，只要传了 liveSource）；开着时位置与偶极矩
  // 跟随直播源。位置按长度钳制到 55 mm（与原拖动钳制一致；TVB 中心最长
  // 约 79 mm，未配准 HEAD，属演示映射）。
  const [liveMode, setLiveMode] = useState(liveSource != null);
  useEffect(() => {
    if (!liveMode || !liveSource) return;
    const p = liveSource.positionMm;
    const len = Math.hypot(p[0], p[1], p[2]);
    const k = len > 55 ? 55 / len : 1;
    const next: Vec3Mm = [p[0] * k, p[1] * k, p[2] * k];
    // 值没变时返回旧引用，免得每帧（liveSource 约 15 Hz 换身份）都重算电位与重绘 3D。
    setPosition((prev) => (prev[0] === next[0] && prev[1] === next[1] && prev[2] === next[2] ? prev : next));
    const q = liveSource.momentNAm;
    setMoment((prev) => (prev === q ? prev : q));
  }, [liveMode, liveSource]);
  const sensors = useMemo(() => demoSphereSensors(90), []);
  const dir = useMemo<Vec3Mm>(() => axis === 'X' ? [1,0,0] : axis === 'Y' ? [0,1,0] : [0,0,1], [axis]);
  const voltage = useMemo(() => sensorPotentialsMicrovolts([{
    positionMm: position,
    momentNAm: [dir[0]*moment, dir[1]*moment, dir[2]*moment],
  }], sensors, { mode: reference }, conductivity), [position, dir, moment, sensors, reference, conductivity]);
  const maxAbs = Math.max(0.001, ...voltage.map(Math.abs));
  // PR8-LAYOUT（参考项）：幅值最大的示意电极，只读展示，供尖峰时跟最大值走；
  // 不改任何电位计算。默认偶极方向仍为 X 轴，Cz 读数小是深部源增益本身小。
  const maxSensor = useMemo(() => {
    let bi = 0;
    voltage.forEach((v, i) => { if (Math.abs(v) > Math.abs(voltage[bi])) bi = i; });
    return { label: sensors[bi]?.label ?? '—', v: voltage[bi] ?? 0 };
  }, [voltage, sensors]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05080c');
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 1000);
    camera.up.set(0,0,1);
    camera.position.set(165,165,215);
    camera.lookAt(0,0,0);
    const renderer = new THREE.WebGLRenderer({ antialias:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    host.appendChild(renderer.domElement);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true; orbit.enablePan = false;
    orbit.minDistance = 125; orbit.maxDistance = 450;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(90,40,30),
      new THREE.MeshPhongMaterial({color:0x174567,transparent:true,opacity:0.13,depthWrite:false,side:THREE.DoubleSide}));
    scene.add(shell);
    scene.add(new THREE.AmbientLight(0xffffff,1.2));
    const light = new THREE.DirectionalLight(0xffffff,2);
    light.position.set(150,100,240);scene.add(light);
    const sensorDots = sensors.map(s=>{
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(3,12,12),
        new THREE.MeshBasicMaterial({color:0x6c9dbb}));
      mesh.position.set(...s.positionMm);scene.add(mesh);return mesh;
    });
    const source = new THREE.Mesh(new THREE.SphereGeometry(7,20,20),
      new THREE.MeshBasicMaterial({color:0xffb340}));
    scene.add(source);
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(),36,0xffb340);
    scene.add(arrow);
    const ray=new THREE.Raycaster(), xy=new THREE.Vector2(), point=new THREE.Vector3(), plane=new THREE.Plane();
    let dragging=false;
    const pick=(e:PointerEvent)=>{
      const rect=renderer.domElement.getBoundingClientRect();
      xy.set(2*(e.clientX-rect.left)/rect.width-1,1-2*(e.clientY-rect.top)/rect.height);
      ray.setFromCamera(xy,camera);
    };
    const down=(e:PointerEvent)=>{
      pick(e);
      if(ray.intersectObject(source).length===0)return;
      dragging=true;orbit.enabled=false;
      plane.setFromNormalAndCoplanarPoint(camera.position.clone().sub(orbit.target).normalize(),source.position);
      renderer.domElement.setPointerCapture(e.pointerId);e.preventDefault();
    };
    const move=(e:PointerEvent)=>{
      if(!dragging)return;
      pick(e);
      if(!ray.ray.intersectPlane(plane,point))return;
      if(point.length()>55)point.normalize().multiplyScalar(55);
      setPosition([point.x,point.y,point.z]);
    };
    const up=()=>{dragging=false;orbit.enabled=true;};
    const canvas=renderer.domElement;canvas.style.touchAction='none';
    canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
    const resize=new ResizeObserver(()=>{
      const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
      camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);
    });resize.observe(host);
    display.current=(p,d,v)=>{
      source.position.set(...p);arrow.position.copy(source.position);
      arrow.setDirection(new THREE.Vector3(...d));
      sensorDots.forEach((dot,i)=>{
        (dot.material as THREE.MeshBasicMaterial).color.set(v[i]>=0?0xffb340:0x4fb6f2);
        dot.scale.setScalar(1+Math.min(1.3,Math.abs(v[i])*0.2));
      });
    };
    let frame=0;
    const tick=()=>{frame=requestAnimationFrame(tick);orbit.update();renderer.render(scene,camera);};tick();
    return ()=>{
      cancelAnimationFrame(frame);display.current=null;resize.disconnect();
      canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);
      canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);
      orbit.dispose();scene.traverse(obj=>{
        if(obj instanceof THREE.Mesh||obj instanceof THREE.Line){
          obj.geometry.dispose();
          const mat=obj.material;
          (Array.isArray(mat)?mat:[mat]).forEach((m:THREE.Material)=>m.dispose());
        }
      });
      renderer.dispose();canvas.remove();
    };
  },[sensors]);
  useEffect(()=>display.current?.(position,dir,voltage),[position,dir,voltage]);

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal screen" role="dialog" aria-modal="true" aria-label="电流偶极子物理实验"
      onClick={e=>e.stopPropagation()} style={{width:'min(1120px,96vw)',maxWidth:'none',maxHeight:'86vh'}}>
      <div className="screen-title" style={{display:'flex',justifyContent:'space-between',right:0,pointerEvents:'auto'}}>
        PR5 · DIPOLE PHYSICS LAB
        <button className="chip chip-small" type="button" onClick={onClose}>关闭</button>
      </div>
      <div className="modal-body">
        <p className="panel-text" style={{color:'#ffb340'}}>{MODEL_LIMITATION}</p>
        <label className="panel-text">
          <input type="checkbox" checked={liveMode && !!liveSource} disabled={!liveSource}
            onChange={(e)=>setLiveMode(e.target.checked)} />{' '}
          直播源：用选中脑区的直播偶极子（位置取脑区中心，q 由 live E/I 经 PR5 假设链算）
        </label>
        {liveMode && liveSource ? (
          <p className="panel-text" style={{color:'#7dd3a8'}}>
            直播源：#{liveSource.regionId} {liveSource.regionLabel} · q = {liveSource.momentNAm.toFixed(3)} nA·m
            （live E/I 经 PR5 假设链，基线 = 选区切换时该脑区的 E/I；偶极矩矢量 = q × 下方所选方向，法向是假设）
            · 位置 = 脑区中心（TVB 坐标、未配准 HEAD，长度钳制到 55 mm）· 改选区、改 G 后电位跟着变。
          </p>
        ) : (
          <p className="panel-text" style={{color:'#ffb340'}}>
            独立演示：手动偶极子，未接主仿真（拖动源 / 改偶极矩只改本实验；想接直播先在主界面选一个脑区，再勾选“直播源”）。
          </p>
        )}
        <p className="panel-text">拖动橙色电流源，旋转场景，修改偶极矩及方向。12个示意传感器电位由解析公式实时计算。</p>
        <div className="lab-split">
          <div ref={mount} role="img" aria-label="交互式三维电流源与模拟传感器"
            style={{height:420,width:'100%',border:'1px solid #133954'}}/>
          <div style={{minWidth:0}}>
            <div className="conn-title">电流源控制</div>
            <label className="panel-text">方向
              <select aria-label="电流源方向" value={axis} onChange={e=>setAxis(e.target.value as 'X'|'Y'|'Z')}>
                <option value="X">X 左右</option><option value="Y">Y 前后</option><option value="Z">Z 上下</option>
              </select>
            </label>
            <p className="panel-text">偶极矩 {moment.toFixed(1)} nA·m{liveMode && liveSource ? '（直播值，滑杆已锁定）' : ''}</p>
            <input aria-label="偶极矩强度" type="range" min="-30" max="30" step="0.5"
              value={moment} disabled={liveMode && !!liveSource} onChange={e=>setMoment(Number(e.target.value))} style={{width:'100%'}}/>
            <p className="panel-text">电导率 {conductivity.toFixed(2)} S/m</p>
            <input aria-label="导电率" type="range" min="0.10" max="1.00" step="0.01"
              value={conductivity} onChange={e=>setConductivity(Number(e.target.value))} style={{width:'100%'}}/>
            <label className="panel-text">参考方式
              <select aria-label="参考方式" value={reference}
                onChange={e=>setReference(e.target.value as 'average'|'infinity')}>
                <option value="average">平均参考</option><option value="infinity">无限远理论参考</option>
              </select>
            </label>
            <p className="panel-text">位置 (mm)：{position.map(x=>x.toFixed(1)).join(', ')}</p>
            <button className="chip chip-small" type="button" onClick={()=>{
              setPosition([0,0,0]);setMoment(10);setAxis('X');
              setConductivity(DEFAULT_CONDUCTIVITY_S_M);setReference('average');
              setLiveMode(false);
            }}>重置实验（回到手动偶极子）</button>
            <div className="conn-title">示意电极电位 · µV</div>
            <p className="panel-text">最大电极：{maxSensor.label} {maxSensor.v.toFixed(3)} µV（12 导中幅值最大，尖峰时跟最大值走）</p>
            {sensors.map((s,i)=><div key={s.label} style={{display:'flex',alignItems:'center',gap:5}}>
              <span style={{width:28}}>{s.label}</span>
              <div style={{flex:1,background:'#122637',height:8,position:'relative'}}>
                <div style={{position:'absolute',left:'50%',height:8,width:1,background:'#9cabb8'}}/>
                <div style={{
                  position:'absolute',left:(voltage[i]<0?50-48*Math.abs(voltage[i])/maxAbs:50)+'%',
                  width:(48*Math.abs(voltage[i])/maxAbs)+'%',height:8,
                  background:voltage[i]>=0?'#ffb340':'#4fb6f2',
                }}/>
              </div>
              <span className="mono" style={{width:58,textAlign:'right'}}>{voltage[i].toFixed(3)}</span>
            </div>)}
          </div>
        </div>
        <p className="panel-text">V=p·(r−r₀)/(4πσ|r−r₀|³) · RAS mm · nA·m · µV。S01–S12 不是标准 EEG montage，透明球面不是颅骨/头皮导电边界，亦未将 TVB E/I 映射为电流源。</p>
      </div>
    </div>
  </div>;
}
