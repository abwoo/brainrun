import {useEffect,useMemo,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {
  validateFsaverageBEM, findNearestValidatedSource,
  templateSourcePotentials, type HeadMesh, type LocalFsaverageBEM,
} from '../lib/fsaverageBEM';
import type {Vec3Mm} from '../lib/volumeConduction';

/**
 * Human-template BEM 3D demo. The user must supply licensed local fsaverage
 * derivative data themselves. The app NEVER auto-downloads/redistributes
 * FreeSurfer assets. Clicking/dragging a visible cortical source selects the
 * nearest precomputed MNE-valid point; no artificial BEM spatial interpolation.
 */
export default function LocalBEMLab({onClose}:{onClose:()=>void}) {
  const [data,setData]=useState<LocalFsaverageBEM|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [sourceIndex,setSourceIndex]=useState(0);
  const [moment,setMoment]=useState(10);
  const [axis,setAxis]=useState<'X'|'Y'|'Z'>('X');
  const [reference,setReference]=useState<'average'|'infinity'>('average');
  const [selectedSensor,setSelectedSensor]=useState('Cz');
  const mount=useRef<HTMLDivElement>(null);
  const display=useRef<((idx:number,dir:Vec3Mm,v:number[])=>void)|null>(null);
  const direction=useMemo<Vec3Mm>(()=>axis==='X'?[1,0,0]:axis==='Y'?[0,1,0]:[0,0,1],[axis]);
  const volts=useMemo(()=>data?templateSourcePotentials(data,sourceIndex,
    [direction[0]*moment,direction[1]*moment,direction[2]*moment],{mode:reference}):[],[
      data,sourceIndex,direction,moment,reference,
    ]);
  const max=Math.max(.001,...volts.map(Math.abs));
  const current=data?.electrodes.findIndex(x=>x.label===selectedSensor)??-1;
  const currentV=current>=0?volts[current]:null;

  const load=async(file?:File)=>{
    if(!file)return;
    try{
      const parsed=JSON.parse(await file.text()) as LocalFsaverageBEM;
      validateFsaverageBEM(parsed);
      setData(parsed);setSourceIndex(0);setSelectedSensor(
        parsed.electrodes.some(e=>e.label==='Cz')?'Cz':parsed.electrodes[0].label
      );setError(null);
    }catch(e){setError('无效 MRI/BEM 模型：'+String(e));setData(null);}
  };

  useEffect(()=>{
    if(!data||!mount.current)return;
    const host=mount.current;
    const scene=new THREE.Scene();scene.background=new THREE.Color('#05080c');
    const camera=new THREE.PerspectiveCamera(40,1,1,1000);
    camera.up.set(0,0,1);
    camera.position.set(225,190,260);camera.lookAt(0,0,20);
    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    host.appendChild(renderer.domElement);
    const orbit=new OrbitControls(camera,renderer.domElement);
    orbit.target.set(0,0,20);orbit.enableDamping=true;
    orbit.enablePan=false;orbit.minDistance=130;orbit.maxDistance=650;
    scene.add(new THREE.AmbientLight(0xb6d7eb,1.5));
    const light=new THREE.DirectionalLight(0xffffff,2.2);
    light.position.set(150,250,300);scene.add(light);

    const createMesh=(m:HeadMesh,color:number,opacity:number)=>{
      const vertices=new Float32Array(m.vertices_head_mm.flat());
      const indices=new Uint32Array(m.triangles.flat());
      const geom=new THREE.BufferGeometry();
      geom.setAttribute('position',new THREE.BufferAttribute(vertices,3));
      geom.setIndex(new THREE.BufferAttribute(indices,1));
      geom.computeVertexNormals();
      const obj=new THREE.Mesh(geom,new THREE.MeshPhongMaterial({
        color,transparent:opacity<1,opacity,depthWrite:opacity>=1,
        side:THREE.DoubleSide,shininess:15,
      }));
      scene.add(obj);return obj;
    };
    createMesh(data.meshes.scalp,0x3f6b81,0.13);
    createMesh(data.meshes.skull,0x5a617e,0.12);
    createMesh(data.meshes.brain,0x234f78,0.08);
    const cortex={
      lh:createMesh(data.meshes.cortex.lh,0x256285,0.78),
      rh:createMesh(data.meshes.cortex.rh,0x256285,0.78),
    };
    const markers=data.source_positions.map((p,i)=>{
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(3.5,14,12),
        new THREE.MeshBasicMaterial({color:0x74b3d9}));
      mesh.position.set(...p.head_mm);mesh.userData.sourceIndex=i;
      scene.add(mesh);return mesh;
    });
    const sensors=data.electrodes.map(p=>{
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(3.5,12,10),
        new THREE.MeshBasicMaterial({color:0x93bfd8}));
      mesh.position.set(...p.head_mm);scene.add(mesh);return mesh;
    });
    const source=new THREE.Mesh(new THREE.SphereGeometry(5.3,18,18),
      new THREE.MeshBasicMaterial({color:0xffb340}));
    scene.add(source);
    const arrow=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),
      new THREE.Vector3(),29,0xffb340);
    scene.add(arrow);
    const canvas=renderer.domElement;canvas.style.touchAction='none';
    const ray=new THREE.Raycaster(),xy=new THREE.Vector2();
    let selecting=false;
    const pick=(e:PointerEvent)=>{
      const rect=canvas.getBoundingClientRect();
      xy.set(2*(e.clientX-rect.left)/rect.width-1,
        1-2*(e.clientY-rect.top)/rect.height);
      ray.setFromCamera(xy,camera);
      const hits=ray.intersectObjects([...markers,cortex.lh,cortex.rh]);
      if(!hits.length)return false;
      const h=hits[0];
      if(h.object.userData.sourceIndex!==undefined){
        setSourceIndex(h.object.userData.sourceIndex as number);
      }else{
        const hemi=h.object===cortex.lh?'lh':'rh';
        const found=findNearestValidatedSource(data,
          [h.point.x,h.point.y,h.point.z],hemi);
        setSourceIndex(found.index);
      }
      return true;
    };
    const down=(e:PointerEvent)=>{
      if(!pick(e))return;
      selecting=true;orbit.enabled=false;
      canvas.setPointerCapture(e.pointerId);e.preventDefault();
    };
    const move=(e:PointerEvent)=>{if(selecting)pick(e);};
    const up=()=>{selecting=false;orbit.enabled=true;};
    canvas.addEventListener('pointerdown',down);
    canvas.addEventListener('pointermove',move);
    canvas.addEventListener('pointerup',up);
    canvas.addEventListener('pointercancel',up);
    const resize=new ResizeObserver(()=>{
      const w=Math.max(host.clientWidth,1),h=Math.max(host.clientHeight,1);
      camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);
    });resize.observe(host);
    display.current=(idx,dir,values)=>{
      const selected=data.source_positions[idx];
      source.position.set(...selected.head_mm);arrow.position.copy(source.position);
      arrow.setDirection(new THREE.Vector3(...dir));
      markers.forEach((mesh,i)=>{
        const active=i===idx;mesh.scale.setScalar(active?2.2:1);
        (mesh.material as THREE.MeshBasicMaterial).color.set(active?0xffb340:0x74b3d9);
      });
      sensors.forEach((mesh,i)=>{
        const v=values[i];
        (mesh.material as THREE.MeshBasicMaterial).color.set(v>=0?0xffb340:0x4fb6f2);
        mesh.scale.setScalar(1+Math.min(1.3,Math.abs(v)/Math.max(.001,...values.map(Math.abs))));
      });
    };
    let frame=0;
    const draw=()=>{frame=requestAnimationFrame(draw);orbit.update();renderer.render(scene,camera);};
    draw();
    return ()=>{
      cancelAnimationFrame(frame);resize.disconnect();display.current=null;
      canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);
      canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);
      orbit.dispose();
      scene.traverse(obj=>{
        if(obj instanceof THREE.Mesh||obj instanceof THREE.Line){
          obj.geometry.dispose();
          const mat=obj.material;
          (Array.isArray(mat)?mat:[mat]).forEach((m:THREE.Material)=>m.dispose());
        }
      });
      renderer.dispose();canvas.remove();
    };
  },[data]);

  useEffect(()=>display.current?.(sourceIndex,direction,volts),
    [sourceIndex,direction,volts]);

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal screen" role="dialog" aria-modal="true"
      aria-label="真实模板 MRI BEM 实验" onClick={e=>e.stopPropagation()}
      style={{width:'min(1180px,96vw)',maxWidth:'none',maxHeight:'94vh'}}>
      <div className="screen-title" style={{display:'flex',justifyContent:'space-between',
        alignItems:'center',right:0,pointerEvents:'auto'}}>
        FSAVERAGE · MRI/BEM PHYSICS
        <button type="button" className="chip chip-small" onClick={onClose}>关闭</button>
      </div>
      <div className="modal-body">
        <p className="panel-text" style={{color:'#ffb340'}}>
          真实人类平均解剖模板 · 三层 BEM 电位计算；不是个体化 MRI、不是临床预测。
          本模式仅载入用户自行获取并生成的本地模型文件，软件不分发 FreeSurfer 模板数据。
        </p>
        <label className="panel-text">加载本地 fsaverage BEM 模型 JSON
          <input type="file" accept=".json,application/json" aria-label="导入本地 BEM 模型"
            onChange={e=>void load(e.target.files?.[0])}/>
        </label>
        {error&&<p role="alert" className="panel-text">{error}</p>}
        {!data&&<p className="panel-text">
          首次使用可在本地运行 scientific/forward/generate_fsaverage_bem.py。
          模型必须带有 MRI↔HEAD 坐标、原始皮层源、aparc 标注、BEM lead-field 和真实头部几何。
        </p>}
        {data&&<>
          <p className="panel-text">模板 {data.subject} · {data.source_positions.length} 个可选物理源 ·
            {data.electrodes.length} 个 EEG 电极 · 拖动源时吸附至最近已求解的皮层点，不做未经验证的插值</p>
          <div style={{display:'grid',gridTemplateColumns:'minmax(0,1.5fr) minmax(240px,1fr)',gap:12}}>
            <div ref={mount} role="img" aria-label="真实模板头皮、颅骨、皮层与可选BEM电流源"
              style={{height:460,width:'100%',border:'1px solid #133954'}}/>
            <div>
              <div className="conn-title">解剖与电流源</div>
              <label className="panel-text">选择已验证皮层点
                <select value={sourceIndex} aria-label="皮层源位置"
                  onChange={e=>setSourceIndex(Number(e.target.value))}>
                  {data.source_positions.map((p,i)=>
                    <option key={i} value={i}>{i+1} · {p.region} · {p.hemisphere}</option>)}
                </select>
              </label>
              <label className="panel-text">电流偶极子方向
                <select aria-label="MRI BEM源方向" value={axis}
                  onChange={e=>setAxis(e.target.value as 'X'|'Y'|'Z')}>
                  <option value="X">X · 左右</option>
                  <option value="Y">Y · 前后</option>
                  <option value="Z">Z · 上下</option>
                </select>
              </label>
              <p className="panel-text">偶极矩：{moment.toFixed(1)} nA·m</p>
              <input type="range" aria-label="MRI BEM源强度" min="-30" max="30" step=".5"
                value={moment} onChange={e=>setMoment(Number(e.target.value))}
                style={{width:'100%'}}/>
              <label className="panel-text">EEG参考
                <select aria-label="MRI BEM参考" value={reference}
                  onChange={e=>setReference(e.target.value as 'average'|'infinity')}>
                  <option value="average">电极平均参考</option>
                  <option value="infinity">理论无限远参考</option>
                </select>
              </label>
              <label className="panel-text">观察电极
                <select aria-label="MRI BEM电极" value={selectedSensor}
                  onChange={e=>setSelectedSensor(e.target.value)}>
                  {data.electrodes.map(e=>
                    <option key={e.label} value={e.label}>{e.label}</option>)}
                </select>
              </label>
              <p className="panel-text">电位：{currentV===null?'—':currentV.toFixed(4)+' µV'}</p>
              <button type="button" className="chip chip-small" onClick={()=>{
                setMoment(10);setAxis('X');setSourceIndex(0);
                setReference('average');setSelectedSensor(
                  data.electrodes.some(e=>e.label==='Cz')?'Cz':data.electrodes[0].label
                );
              }}>重置模板实验</button>
              <div className="conn-title">所选源的全部电极电位</div>
              {data.electrodes.map((e,i)=><div key={e.label}
                style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                <span style={{width:35}}>{e.label}</span>
                <div style={{height:7,background:'#152938',flex:1,position:'relative'}}>
                  <div style={{position:'absolute',left:'50%',width:1,height:7,background:'#afbdca'}}/>
                  <div style={{
                    position:'absolute',left:(volts[i]<0?50-48*Math.abs(volts[i])/max:50)+'%',
                    width:(48*Math.abs(volts[i])/max)+'%',height:7,
                    background:volts[i]>=0?'#ffb340':'#4fb6f2',
                  }}/>
                </div>
                <span className="mono" style={{minWidth:60,textAlign:'right'}}>{volts[i].toFixed(3)}</span>
              </div>)}
            </div>
          </div>
          <p className="panel-text">方法：MNE make_forward_dipole + fsaverage MRI 三层 BEM；
            HEAD RAS 毫米，nA·m→µV。模型源只能选已预计算节点，不进行空间插值。
            现未建立 Wilson–Cowan E/I 到电流源的校准，亦未提供经验证的 Talairach 转换。
          </p>
        </>}
      </div>
    </div>
  </div>;
}
