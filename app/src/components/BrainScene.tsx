/**
 * BrainScene — 真实皮层网格的 Three.js 渲染与拾取（Phase 3，Phase 4 打磨）。
 *
 * Phase 4：光照提亮（环境光 0.85 + 半球光 0.6 + 主光 1.9 + 蓝 rim 0.7
 * + 前下补光 0.45），底色 #1d3247 → #2a4a66，线框 0.07 → 0.12，
 * 活动色改为热色阶（底色 → 琥珀 → 亮琥珀，全由快照 E 决定）；
 * 默认视角改为右前上方微俯视；双击/RESET 改为 600 ms 平滑飞行；
 * 触摸单指旋转、双指缩放/平移；颜色插值静止后跳过整轮扫描。
 * - 网格来自 TVB cortex_16384（16384 顶点 / 32760 三角面），顶点坐标按原始值
 *   使用，仅做整体平移居中以适配相机，禁止逐顶点修改。
 * - 拾取：射线 → 三角面顶点 → regionMap → 脑区 id。点击与拖拽用指针位移
 *   阈值区分，旋转时绝不误触选中。
 * - 活动着色：每脑区顶点颜色只读仿真快照里的 E（暗蓝灰 → 琥珀），
 *   画面每帧向快照目标色插值（只平滑，不改模型结果）。
 *   悬停/选中在活动色基础上混入蓝色；刺激位置给一个短暂的琥珀色
 *   扩散环作为交互确认标记（不是神经活动本身）。
 * - 点击 = 脉冲刺激；静止按住 300 ms = 持续输入，松开即停。
 *   按住判定分三层（见 HOLD_DELAY_MS 下方的说明）：原始指针更新
 *   一动就取消待定的按住；计时器到时直接启动按住；启动之后若
 *   第一个被处理的 pointermove 用事件时间戳证明拖动在按住启动
 *   之前就已开始，就立即撤回这次按住（停输入、删标记）。按压
 *   时长与拖动起点一律以指针事件时间戳（e.timeStamp，与
 *   performance.now() 同源）为准，不以处理时的墙钟为准。
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BrainData } from '../lib/brainData';
import { topConnections } from '../lib/brainData';
import type { ResponseGroups, SimClient } from '../lib/simClient';
import { DELTA_FULL } from '../lib/simClient';

const BASE_COLOR = new THREE.Color('#2a4a66'); // Phase 4：提亮后的皮层底色（仍为暗蓝灰系）
const AMBER_COLOR = new THREE.Color('#ffb340'); // 活动：CHIMERA 琥珀
const HOT_COLOR = new THREE.Color('#fff8ec'); // 热色阶高端：高活动核心（仍只由 E 决定）
// PR2：ΔE 发散色阶的负向端（活动降低为蓝，与升高的琥珀区分）。
const NEG_COLOR = new THREE.Color('#2f7fd0');
const HOVER_COLOR = new THREE.Color('#4fb6f2'); // CHIMERA 结构蓝
const SELECTED_COLOR = new THREE.Color('#a8d8fa'); // 选中：更亮的同系蓝
const CLICK_MOVE_THRESHOLD_PX = 6;
const HOLD_DELAY_MS = 300; // 静止按住超过此时长即视为持续输入。
// B2 教训（两轮实测）：按住判定曾经只凭一个墙钟 setTimeout(300 ms) +
// 处理时的 moved 标志。主线程卡顿时（本机软件渲染单帧常以秒计），
// 指针事件按帧投递、每帧只来一个，而计时器是任务、跑在帧的输入投递
// 之前：一次 600 ms 拖动的第一个 move 事件时间只比按下晚 110 ms，
// 却在约 900 ms 后才被处理；计时器触发时 moved 仍是 false，拖动
// 就被当成按住，持续输入直接把全网锁在高活动态。Round 1 复测证实，
// 在计时器与启动之间再插一个任务轮次（setTimeout 0 二次确认）也
// 无济于事——二次确认同样是任务，同样跑在下一帧的输入投递之前；
// 而且它把真正的按住启动推迟到评估任务之后，反而让 B3 在卡顿下
// 丢掉按住（P 读数为 0）。
// 修法（三层，缺一不可）：
// 1）第一道防线是 pointerrawupdate：原始指针更新不经过合并、
//    不按帧投递，实测处理延迟 < 1 ms（同一输入的 pointermove 要
//    等下一帧，约 1 s 后才到）。任何原始更新只要位移超阈值就立刻
//    视为拖动、取消待定的按住计时器——拖动一动，按住就不会启动。
//    不支持该事件的浏览器（Safari）自然走不到这层，靠下面两层兜底。
// 2）计时器到时直接启动按住，不再插二次确认——启动任务在 300 ms
//    时入队，保证真正的按住在松开前一定启动、一定被读到（B3）。
// 3）兜底是时间戳撤回（retractHold）：启动之后，第一个被处理的
//    pointermove 若用事件时间戳证明拖动在按住启动之前就已开始，
//    立即撤回这次按住（停输入、删标记）。真正的“按住后拖动”不
//    受影响：那时移动事件的时间戳晚于按住启动，按住照常保留到松开。
// 拖动一旦位移超阈值，待定的计时器随即取消；指针抬起/取消/离开
// 同样取消。一次真正的静止按住仍在 300 ms 后正常触发。
const E_BASELINE = 0.011; // 演示预设基线 E（Phase 2 实测）
const E_PEAK = 0.5; // 脉冲峰值附近 E（Phase 2 实测 ΔE≈0.48）

// Phase 4：默认改为微俯视的三维视角（右前上方），脑回的深度层次
// 比正顶视更易读；距离与正顶视相当，仍以大脑为视觉中心。
const DEFAULT_CAMERA_POS = new THREE.Vector3(75, 95, 245);
const FLY_DURATION_MS = 600; // 双击/RESET 恢复视角的平滑飞行时长

interface BrainSceneProps {
  data: BrainData;
  autoRotate: boolean;
  showConnections: boolean;
  selectedId: number | null;
  resetSignal: number;
  onSelect: (regionId: number | null) => void;
  /** 仿真客户端（null = 仿真未就绪，只渲染结构）。 */
  sim: SimClient | null;
  onPulse: (node: number) => void;
  onHoldStart: (node: number) => void;
  onHoldEnd: (node: number) => void;
  /** 按住被证实为误判时的撤回（停输入、删标记），见 HOLD_DELAY_MS 说明。 */
  onHoldRetract: (node: number) => void;
  /** PR2：着色视图。'absolute' 按 E 着色；'delta' 按 ΔE = E − 刺激前基线着色。 */
  colorMode: 'absolute' | 'delta';
  /** PR2：最近一次刺激的基线 E（null = 从未刺激，ΔE 视图显示接近零）。 */
  baselineE: Float64Array | null;
  /** PR2：回放中当前时刻的录制快照 E（null = 直播快照）。只读录制数据，不重算。 */
  replayE: Float64Array | null;
  /** PR2：三类响应标记的脑区 id（null = 无响应数据，不画标记）。 */
  responseGroups: ResponseGroups | null;
}

export default function BrainScene({
  data,
  autoRotate,
  showConnections,
  selectedId,
  resetSignal,
  onSelect,
  sim,
  onPulse,
  onHoldStart,
  onHoldEnd,
  onHoldRetract,
  colorMode,
  baselineE,
  replayE,
  responseGroups,
}: BrainSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);

  // 由 Three.js 侧持有的可变对象（不触发 React 渲染）
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh;
    geometry: THREE.BufferGeometry;
    colors: Float32Array;
    colorAttr: THREE.BufferAttribute;
    connGroup: THREE.Group;
    markerGroup: THREE.Group;
    /** PR2：持久响应标记组（输入环 / 局部实心标记 / 网络小点）。
     *  与 450 ms 即消失的确认环不同：本组标记随响应数据存在，
     *  RESET 或下一次刺激时由 effect 重建/清除。 */
    respGroup: THREE.Group;
    selMarker: THREE.Mesh;
    centerOffset: THREE.Vector3;
    raycaster: THREE.Raycaster;
  } | null>(null);
  const hoverRef = useRef<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onPulseRef = useRef(onPulse);
  onPulseRef.current = onPulse;
  const onHoldStartRef = useRef(onHoldStart);
  onHoldStartRef.current = onHoldStart;
  const onHoldEndRef = useRef(onHoldEnd);
  onHoldEndRef.current = onHoldEnd;
  const onHoldRetractRef = useRef(onHoldRetract);
  onHoldRetractRef.current = onHoldRetract;
  const simRef = useRef(sim);
  simRef.current = sim;

  /** 最新快照的 E（快照到达即更新；渲染循环向它插值）。 */
  const latestERef = useRef<Float64Array | null>(null);
  /** PR2：视图与基线、回放快照的 ref（渲染循环与 recomputeTargets 只读 ref，
   *  与 latestE 同一做法，避免每帧触发 React 渲染）。 */
  const colorModeRef = useRef<'absolute' | 'delta'>(colorMode);
  colorModeRef.current = colorMode;
  const baselineERef = useRef<Float64Array | null>(baselineE);
  baselineERef.current = baselineE;
  const replayERef = useRef<Float64Array | null>(replayE);
  replayERef.current = replayE;
  /** 目标顶点色（由快照 + 悬停/选中算出）。 */
  const targetColorsRef = useRef<Float32Array | null>(null);
  /** 颜色仍在向目标插值时为 true；静止后渲染循环跳过整轮插值，
   * 避免每帧无意义地扫 16384×3 个浮点数。 */
  const colorActiveRef = useRef(true);
  /** 平滑恢复视角的飞行状态（null = 不在飞行）。 */
  const flyRef = useRef<{
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
    startMs: number;
    prevAutoRotate: boolean;
  } | null>(null);
  /** 飞行途中的缓动进度采样（每帧一个，只读调试用，供测试确认
   * 飞行是渐进的；上限 16 个，不累积）。 */
  const flySamplesRef = useRef<number[]>([]);

  const tmpColor = useRef(new THREE.Color());

  const recomputeTargets = () => {
    const s = sceneRef.current;
    const targets = targetColorsRef.current;
    if (!s || !targets) return;
    // 回放时读录下来的快照 E；否则读直播快照。都不重算。
    const e = replayERef.current ?? latestERef.current;
    const base = baselineERef.current;
    const deltaMode = colorModeRef.current === 'delta';
    const h = hoverRef.current;
    const sel = selectedRef.current;
    const c = tmpColor.current;
    for (let i = 0; i < data.regionMap.length; i++) {
      const r = data.regionMap[i];
      if (e) {
        if (deltaMode) {
          // PR2：ΔE 发散色阶。ΔE = E − 刺激前基线；升高琥珀、降低蓝色，
          // 0 为底色。平方根压缩、±DELTA_FULL（0.1）满格：远端 0.01–0.05
          // 的变化仍可见（0.01 约占 32% 色深），被刺激脑区约 0.48 满格。
          // 无基线（从未刺激）时全为底色，即“接近零”，不编造。
          if (base) {
            const d = e[r] - base[r];
            const sgn = Math.sign(d) * Math.sqrt(Math.min(Math.abs(d) / DELTA_FULL, 1));
            if (sgn >= 0) {
              if (sgn <= 0.55) {
                c.copy(BASE_COLOR).lerp(AMBER_COLOR, Math.pow(sgn / 0.55, 0.8));
              } else {
                c.copy(AMBER_COLOR).lerp(HOT_COLOR, Math.pow((sgn - 0.55) / 0.45, 0.7));
              }
            } else {
              c.copy(BASE_COLOR).lerp(NEG_COLOR, Math.pow(-sgn, 0.8));
            }
          } else {
            c.copy(BASE_COLOR);
          }
        } else {
          // 热色阶（CHIMERA heat）：底色 → 琥珀 → 亮琥珀，只由快照 E 决定。
          const intensity = Math.min(1, Math.max(0, (e[r] - E_BASELINE) / (E_PEAK - E_BASELINE)));
          if (intensity <= 0.55) {
            c.copy(BASE_COLOR).lerp(AMBER_COLOR, Math.pow(intensity / 0.55, 0.8));
          } else {
            c.copy(AMBER_COLOR).lerp(HOT_COLOR, Math.pow((intensity - 0.55) / 0.45, 0.7));
          }
        }
      } else {
        c.copy(BASE_COLOR);
      }
      if (r === sel) c.lerp(SELECTED_COLOR, 0.45);
      else if (r === h) c.lerp(HOVER_COLOR, 0.55);
      targets[i * 3] = c.r;
      targets[i * 3 + 1] = c.g;
      targets[i * 3 + 2] = c.b;
    }
    colorActiveRef.current = true;
  };

  // 平滑恢复默认视角：600 ms 缓动飞行，不是瞬跳。
  // 飞行期间暂时关闭 OrbitControls 与自动旋转，结束后恢复。
  // 关键：起飞前把拖拽残留的旋转/平移动量直接清零（OrbitControls
  // 没有公开接口，只能清它的内部 _sphericalDelta / _panOffset；
  // three 版本钉在 package.json 的 0.187.0，字段名已核对源码）。
  // 注意不能用“无阻尼 update() 一次消耗掉”的做法：它会把残留动量
  // 一次性全施加到相机上，实测曾让相机瞬间再跳 150 mm，违背平滑本意。
  const flyToDefault = () => {
    const s = sceneRef.current;
    if (!s) return;
    const prevAutoRotate = s.controls.autoRotate;
    s.controls.autoRotate = false;
    s.controls.enabled = false;
    const priv = s.controls as unknown as {
      _sphericalDelta?: { set: (x: number, y: number, z: number) => void };
      _panOffset?: { set: (x: number, y: number, z: number) => void };
    };
    priv._sphericalDelta?.set(0, 0, 0);
    priv._panOffset?.set(0, 0, 0);
    flySamplesRef.current = [];
    flyRef.current = {
      startPos: s.camera.position.clone(),
      endPos: DEFAULT_CAMERA_POS.clone(),
      startTarget: s.controls.target.clone(),
      endTarget: new THREE.Vector3(0, 0, 0),
      startMs: performance.now(),
      prevAutoRotate,
    };
  };
  const cancelFly = () => {
    const s = sceneRef.current;
    if (!s) return;
    if (flyRef.current) {
      s.controls.autoRotate = flyRef.current.prevAutoRotate;
      s.controls.enabled = true;
      flyRef.current = null;
    }
  };

  // 订阅仿真快照：只更新目标色，不直接改画面。
  useEffect(() => {
    if (!sim) return;
    const unsub = sim.subscribe((snap) => {
      latestERef.current = snap.e;
      recomputeTargets();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim]);

  // 悬停/选中变化时重算目标色（活动色不变，只改混合）。
  useEffect(() => {
    recomputeTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverId, selectedId, data]);

  // PR2：视图 / 基线 / 回放快照变化时重算目标色（回放 E 由 prop 传入，
  // 快照订阅仍在跑：回放中 recomputeTargets 会优先读 replayE）。
  useEffect(() => {
    recomputeTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, baselineE, replayE]);

  // PR2：持久响应标记——输入环（琥珀空心环）/ 局部响应（琥珀实心球）/
  // 网络响应（蓝色小球）。三者颜色与形状都不同；只在有响应数据时
  // 出现，RESET 或下一次刺激时重建。标记位置只取脑区中心坐标，
  // 不参与任何神经计算。
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const { respGroup, centerOffset } = s;
    while (respGroup.children.length > 0) {
      const child = respGroup.children.pop()!;
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    if (!responseGroups) return;
    const centre = (id: number): THREE.Vector3 => {
      const c = data.regions[id].centre;
      return new THREE.Vector3(c[0], c[1], c[2]).sub(centerOffset);
    };
    if (responseGroups.input !== null) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(4.2, 5.4, 40),
        new THREE.MeshBasicMaterial({
          color: 0xffb340,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
        }),
      );
      ring.position.copy(centre(responseGroups.input));
      ring.userData.isInputRing = true;
      ring.userData.respKind = 'input';
      respGroup.add(ring);
    }
    const localGeo = new THREE.SphereGeometry(2.6, 12, 12);
    const localMat = new THREE.MeshBasicMaterial({ color: 0xffc861 });
    for (const id of responseGroups.local) {
      const dot = new THREE.Mesh(localGeo, localMat);
      dot.position.copy(centre(id));
      dot.userData.respKind = 'local';
      respGroup.add(dot);
    }
    const netGeo = new THREE.SphereGeometry(1.6, 12, 12);
    const netMat = new THREE.MeshBasicMaterial({ color: 0x4fb6f2 });
    for (const id of responseGroups.network) {
      const dot = new THREE.Mesh(netGeo, netMat);
      dot.position.copy(centre(id));
      dot.userData.respKind = 'network';
      respGroup.add(dot);
    }
  }, [responseGroups, data]);

  selectedRef.current = selectedId;

  // 选中脑区中心的小标记（选区指示，不是活动）。
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    if (selectedId === null) {
      s.selMarker.visible = false;
      return;
    }
    const c = data.regions[selectedId].centre;
    s.selMarker.position.set(c[0], c[1], c[2]).sub(s.centerOffset);
    s.selMarker.visible = true;
  }, [selectedId, data]);

  // 连接线：选中脑区的前 5 条主要连接弧线
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const { connGroup, centerOffset } = s;
    while (connGroup.children.length > 0) {
      const child = connGroup.children.pop()!;
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    if (!showConnections || selectedId === null) return;
    const centre = (id: number): THREE.Vector3 => {
      const c = data.regions[id].centre;
      return new THREE.Vector3(c[0], c[1], c[2]).sub(centerOffset);
    };
    const from = centre(selectedId);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x4fb6f2,
      transparent: true,
      opacity: 0.9,
    });
    const dotGeo = new THREE.SphereGeometry(1.6, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0x4fb6f2 });
    for (const conn of topConnections(data, selectedId, 5)) {
      const to = centre(conn.target.id);
      const mid = from.clone().add(to).multiplyScalar(0.5);
      // 控制点沿“离脑中心向外”方向抬升，形成贴合脑表的弧线
      const lift = mid.clone().normalize().multiplyScalar(45);
      const ctrl = mid.clone().add(lift);
      const curve = new THREE.QuadraticBezierCurve3(from, ctrl, to);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
      connGroup.add(new THREE.Line(geo, lineMat));
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.position.copy(to);
      connGroup.add(dot);
    }
  }, [selectedId, showConnections, data]);

  // 相机自动旋转开关
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.controls.autoRotate = autoRotate;
  }, [autoRotate]);

  // RESET 信号：平滑恢复默认视角并由父组件清除选中
  useEffect(() => {
    if (resetSignal === 0 || !sceneRef.current) return;
    flyToDefault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  // 场景初始化（挂载一次；StrictMode 重挂载时清理函数会完整释放）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x05080c, 1);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      2000,
    );
    camera.position.copy(DEFAULT_CAMERA_POS);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotateSpeed = 0.8;
    controls.minDistance = 120;
    controls.maxDistance = 600;
    // 触摸：单指旋转、双指缩放/平移（OrbitControls 默认即此，显式写清）。
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    // Phase 4 光照（提亮，仍为冷色仪器光）：环境光 0.85 + 半球光 0.6
    // 让脑回在静止时也清晰可读；主光 1.9 塑形，蓝 rim 0.7 勾边，
    // 前下补光 0.45 提亮下半球。背景仍为 #05080C，不加泛光。
    scene.add(new THREE.AmbientLight(0xbcd8ff, 0.85));
    scene.add(new THREE.HemisphereLight(0x9fc8ff, 0x0a1626, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(80, 120, 160);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4fb6f2, 0.7);
    rim.position.set(-100, -60, -80);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0xdfeaff, 0.45);
    fill.position.set(0, -100, 180);
    scene.add(fill);

    // 几何：原始顶点整体居中（只做平移，不改相对位置）
    const positions = new Float32Array(data.vertices);
    const box = new THREE.Box3();
    const tmp = new THREE.Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      tmp.set(positions[i], positions[i + 1], positions[i + 2]);
      box.expandByPoint(tmp);
    }
    const centerOffset = box.getCenter(new THREE.Vector3());
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] -= centerOffset.x;
      positions[i + 1] -= centerOffset.y;
      positions[i + 2] -= centerOffset.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.triangles, 1));
    geometry.computeVertexNormals();

    const colors = new Float32Array(16384 * 3);
    for (let i = 0; i < 16384; i++) {
      colors[i * 3] = BASE_COLOR.r;
      colors[i * 3 + 1] = BASE_COLOR.g;
      colors[i * 3 + 2] = BASE_COLOR.b;
    }
    const colorAttr = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute('color', colorAttr);
    targetColorsRef.current = new Float32Array(colors);

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.42, // Phase 4：略降粗糙度，曲面高光更易读
        metalness: 0.08,
      }),
    );
    scene.add(mesh);
    // 淡线框叠加：表现脑回边缘的仪器线条感（Phase 4：0.07 → 0.12，
    // 配合提亮后的底色，边缘更清晰，仍克制）。
    const wire = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x3487c4,
        wireframe: true,
        transparent: true,
        opacity: 0.12,
      }),
    );
    scene.add(wire);

    const connGroup = new THREE.Group();
    scene.add(connGroup);

    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    // PR2：持久响应标记组（见上方的 rebuild effect）。
    const respGroup = new THREE.Group();
    scene.add(respGroup);

    const selMarker = new THREE.Mesh(
      new THREE.SphereGeometry(2.2, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xa8d8fa }),
    );
    selMarker.visible = false;
    scene.add(selMarker);

    const raycaster = new THREE.Raycaster();
    sceneRef.current = {
      renderer,
      scene,
      camera,
      controls,
      mesh,
      geometry,
      colors,
      colorAttr,
      connGroup,
      markerGroup,
      respGroup,
      selMarker,
      centerOffset,
      raycaster,
    };

    const pickRegion = (clientX: number, clientY: number): number | null => {
      const s = sceneRef.current;
      if (!s) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      s.raycaster.setFromCamera(ndc, s.camera);
      const hits = s.raycaster.intersectObject(s.mesh, false);
      if (hits.length === 0 || !hits[0].face) return null;
      const vertexIndex = hits[0].face.a;
      return data.regionMap[vertexIndex];
    };

    const moveTooltip = (clientX: number, clientY: number) => {
      const tip = tooltipRef.current;
      const rect = container.getBoundingClientRect();
      if (!tip) return;
      tip.style.left = `${clientX - rect.left + 14}px`;
      tip.style.top = `${clientY - rect.top + 10}px`;
    };

    /** 在脑区中心放一个短暂扩散环：交互确认标记，450 ms 后消失。 */
    const spawnMarker = (regionId: number) => {
      const s = sceneRef.current;
      if (!s) return;
      const c = data.regions[regionId].centre;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.5, 3.5, 40),
        new THREE.MeshBasicMaterial({
          color: 0xffb340,
          transparent: true,
          opacity: 0.95,
          side: THREE.DoubleSide,
        }),
      );
      ring.position.set(c[0], c[1], c[2]).sub(s.centerOffset);
      ring.userData.born = performance.now();
      s.markerGroup.add(ring);
    };

    let downX = 0;
    let downY = 0;
    /** pointerdown 事件的 e.timeStamp（与 performance.now() 同源）：
     *  按压时长以事件时间算，不以处理时的墙钟时间算。 */
    let downTime = 0;
    let downRegion: number | null = null;
    let moved = false;
    let holding = false;
    /** 按住启动时的 performance.now()：撤回判定以它为准（见 HOLD_DELAY_MS 说明）。 */
    let holdStartPerf: number | null = null;
    /** 指针当前是否按下（down 到 up/cancel/leave 之间为 true）。 */
    let pointerDown = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;

    const clearHoldTimer = () => {
      if (holdTimer !== null) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };
    const endHold = () => {
      clearHoldTimer();
      if (holding && downRegion !== null) {
        onHoldEndRef.current(downRegion);
      }
      holding = false;
      holdStartPerf = null;
    };
    /** 启动按住：只在计时器到时调用（见 HOLD_DELAY_MS 说明）。 */
    const startHold = () => {
      if (downRegion === null) return;
      // PR1 小修：引擎未就绪时不画确认标记、不发持续输入。之前这里会
      // 先画圆环再由 App 侧丢掉刺激，造成“点了却没反应”的假反馈。
      if (!simRef.current?.isReady()) return;
      holding = true;
      holdStartPerf = performance.now();
      spawnMarker(downRegion);
      onHoldStartRef.current(downRegion);
    };
    /** 撤回一次被证实为误判的按住：停输入、删标记（见 HOLD_DELAY_MS 说明）。 */
    const retractHold = () => {
      if (!holding || downRegion === null) return;
      const node = downRegion;
      holding = false;
      holdStartPerf = null;
      onHoldRetractRef.current(node);
    };
    /** 指针位置变化的统一处理（pointermove 与 pointerrawupdate 共用）：
     *  位移超阈值即视为拖动，取消待定的按住；若按住已启动且该位置的
     *  事件时间早于按住启动，则按住是误判，立即撤回。只做标志与
     *  计时器操作，不做拾取——原始更新频率很高，必须保持廉价。 */
    const notePointerPosition = (clientX: number, clientY: number, timeStamp: number) => {
      if (Math.hypot(clientX - downX, clientY - downY) > CLICK_MOVE_THRESHOLD_PX) {
        moved = true;
        clearHoldTimer();
        if (holding && holdStartPerf !== null && timeStamp < holdStartPerf) {
          retractHold();
        }
      }
    };
    /** 原始指针更新：不合并、不按帧投递，拖动一动就到（见 HOLD_DELAY_MS
     *  说明）。只在按下期间处理；按下前到达的更新对应的是旧的按下点，
     *  不予理会（onPointerDown 会重置 moved）。 */
    const onPointerRawUpdate = (e: PointerEvent) => {
      if (!pointerDown) return;
      notePointerPosition(e.clientX, e.clientY, e.timeStamp);
    };

    const onPointerMove = (e: PointerEvent) => {
      // 候选事件：主事件 + 被合并的中间事件。Chromium 会把一帧内的
      // 多个 move 合并成一个投递，只看主事件会漏掉“拖动其实早就开始”
      // 的证据；合并事件自带各自的位置与时间戳，一并检查。
      const candidates: PointerEvent[] = [e];
      try {
        if (typeof e.getCoalescedEvents === 'function') {
          candidates.push(...e.getCoalescedEvents());
        }
      } catch {
        // 不支持合并事件的浏览器：只看主事件。
      }
      for (const ev of candidates) {
        notePointerPosition(ev.clientX, ev.clientY, ev.timeStamp);
      }
      const id = pickRegion(e.clientX, e.clientY);
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        setHoverId(id);
      }
      const tip = tooltipRef.current;
      if (tip) {
        if (id !== null) {
          tip.style.display = 'block';
          tip.textContent = `${data.regions[id].label} — 点击刺激 · 按住持续输入`;
          moveTooltip(e.clientX, e.clientY);
        } else {
          tip.style.display = 'none';
        }
      }
      if (id !== null) renderer.domElement.style.cursor = 'pointer';
      else renderer.domElement.style.cursor = 'grab';
    };
    const onPointerDown = (e: PointerEvent) => {
      cancelFly(); // 用户接手操作，立即停止视角飞行
      downX = e.clientX;
      downY = e.clientY;
      downTime = e.timeStamp;
      pointerDown = true;
      moved = false;
      holding = false;
      holdStartPerf = null;
      downRegion = pickRegion(e.clientX, e.clientY);
      if (downRegion !== null) {
        onSelectRef.current(downRegion);
        clearHoldTimer();
        // 计时器到时直接启动按住（见 HOLD_DELAY_MS 说明）：启动任务
        // 在 300 ms 时入队，真正的按住不会被卡顿推迟到松开之后。
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (
            pointerDown &&
            !moved &&
            downRegion !== null &&
            performance.now() - downTime >= HOLD_DELAY_MS
          ) {
            startHold();
          }
        }, HOLD_DELAY_MS);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      pointerDown = false;
      const wasHolding = holding;
      endHold();
      if (moved) return; // 拖拽旋转，不触发刺激
      const id = downRegion ?? pickRegion(e.clientX, e.clientY);
      if (id === null) return;
      if (wasHolding) return; // 按住已在松开时结束，不再补发脉冲
      // 注意：这里刻意不按“按压时长 >= 300 ms 就补持续输入”处理——
      // 持续输入必须在按住期间施加，松开后补发已无意义；一次脉冲是
      // 唯一诚实的反馈。长按的启动若被卡顿丢掉，脉冲即为全部反馈，
      // 不制造虚假的持续输入与锁定。
      // PR1 小修：引擎未就绪时不画确认标记、不发脉冲（同 startHold）。
      if (!simRef.current?.isReady()) return;
      spawnMarker(id);
      onPulseRef.current(id);
    };
    const onPointerCancel = () => {
      pointerDown = false;
      endHold();
    };
    const onPointerLeave = () => {
      pointerDown = false;
      endHold();
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        setHoverId(null);
      }
      const tip = tooltipRef.current;
      if (tip) tip.style.display = 'none';
    };
    const onDoubleClick = (e: MouseEvent) => {
      const id = pickRegion(e.clientX, e.clientY);
      if (id !== null) return; // 双击脑区不恢复视角
      flyToDefault(); // 平滑飞行回默认视角，不是瞬跳
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    // pointerrawupdate 不在 TS 的标准事件名重载里，需显式断言；
    // 不支持该事件的浏览器上 addEventListener 只是注册一个永远
    // 不触发的监听器，无副作用。
    renderer.domElement.addEventListener(
      'pointerrawupdate',
      onPointerRawUpdate as EventListener,
    );
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('dblclick', onDoubleClick);

    const resizeObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = Math.max(container.clientHeight, 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    let raf = 0;
    const easeInOutCubic = (k: number) =>
      k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = sceneRef.current;
      if (!s) return;
      // 视角飞行：缓动插值相机位置与目标点，到位后恢复控制。
      // 飞行期间不调 controls.update()（它会把残留动量再叠加上来），
      // 直接 camera.lookAt；落点由插值本身保证精确。
      const fly = flyRef.current;
      if (fly) {
        const k = Math.min(
          1,
          (performance.now() - fly.startMs) / FLY_DURATION_MS,
        );
        const e = easeInOutCubic(k);
        // 记录本帧的缓动进度（只读，供测试确认飞行经过中间位置）。
        flySamplesRef.current.push(e);
        if (flySamplesRef.current.length > 16) flySamplesRef.current.shift();
        s.camera.position.lerpVectors(fly.startPos, fly.endPos, e);
        s.controls.target.lerpVectors(fly.startTarget, fly.endTarget, e);
        s.camera.lookAt(s.controls.target);
        if (k >= 1) {
          s.controls.autoRotate = fly.prevAutoRotate;
          s.controls.enabled = true;
          flyRef.current = null;
        }
      } else {
        controls.update();
      }
      // 颜色插值：只平滑，不改模型结果；静止后整轮跳过，省每帧开销。
      if (colorActiveRef.current) {
        const targets = targetColorsRef.current;
        if (targets) {
          const { colors, colorAttr } = s;
          let changed = false;
          for (let i = 0; i < colors.length; i++) {
            const d = targets[i] - colors[i];
            if (Math.abs(d) > 0.0005) {
              colors[i] += d * 0.35;
              changed = true;
            } else if (d !== 0) {
              colors[i] = targets[i];
              changed = true;
            }
          }
          if (changed) colorAttr.needsUpdate = true;
          else colorActiveRef.current = false;
        }
      }
      // 刺激标记：扩散 + 淡出，450 ms 后回收。
      const now = performance.now();
      for (let i = s.markerGroup.children.length - 1; i >= 0; i--) {
        const m = s.markerGroup.children[i] as THREE.Mesh;
        const age = now - (m.userData.born as number);
        if (age > 450) {
          s.markerGroup.remove(m);
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        } else {
          const k = age / 450;
          m.scale.setScalar(1 + k * 3);
          (m.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k);
          m.lookAt(camera.position);
        }
      }
      // PR2：持久响应标记里的输入环始终朝向相机（不扩散、不淡出、
      // 不参与 450 ms 回收；随响应数据存在，RESET 时由 effect 清除）。
      for (const child of s.respGroup.children) {
        if ((child as THREE.Mesh).userData.isInputRing) {
          (child as THREE.Mesh).lookAt(camera.position);
        }
      }
      // （controls.update() 已在上面的飞行分支里按需调用：
      // 飞行时跳过、平时调用；这里不再重复调用，避免残留动量叠加。）
      renderer.render(scene, camera);
    };
    // 只读相机调试桥（供 Playwright 视觉测试读取相机位置，不改任何状态；
    // 与 Phase 3 的 window.__brainSim 同一做法）。
    (window as unknown as { __brainScene?: unknown }).__brainScene = {
      getCameraPosition: () => {
        const sc = sceneRef.current;
        return sc ? [sc.camera.position.x, sc.camera.position.y, sc.camera.position.z] : null;
      },
      getCameraTarget: () => {
        const sc = sceneRef.current;
        return sc ? [sc.controls.target.x, sc.controls.target.y, sc.controls.target.z] : null;
      },
      getDefaultCameraPosition: () => [DEFAULT_CAMERA_POS.x, DEFAULT_CAMERA_POS.y, DEFAULT_CAMERA_POS.z],
      /** 最近一次飞行的缓动进度采样（0→1）；空数组 = 尚未飞过。 */
      getFlySamples: () => [...flySamplesRef.current],
      /** PR2：持久响应标记的数量（按三类分），供测试确认三类标记同时存在。 */
      getResponseMarkers: () => {
        const sc = sceneRef.current;
        if (!sc) return null;
        const counts = { input: 0, local: 0, network: 0 };
        for (const child of sc.respGroup.children) {
          const kind = (child as THREE.Mesh).userData.respKind as string | undefined;
          if (kind === 'input' || kind === 'local' || kind === 'network') counts[kind]++;
        }
        return counts;
      },
      /** PR2：三类标记各自的真实几何与颜色（从场景里的网格直接读），
       *  供测试确认三类标记在形状与颜色上互不相同。 */
      getResponseMarkerDetails: () => {
        const sc = sceneRef.current;
        if (!sc) return null;
        const details: Record<string, { count: number; geometry: string | null; radius: number | null; color: string | null }> = {};
        for (const child of sc.respGroup.children) {
          const mesh = child as THREE.Mesh;
          const kind = mesh.userData.respKind as string | undefined;
          if (kind !== 'input' && kind !== 'local' && kind !== 'network') continue;
          const mat = mesh.material as THREE.MeshBasicMaterial;
          const geo = mesh.geometry as THREE.RingGeometry | THREE.SphereGeometry;
          const entry = details[kind] ?? { count: 0, geometry: null, radius: null, color: null };
          entry.count += 1;
          entry.geometry = geo.type;
          entry.radius = (geo.parameters as { radius?: number }).radius ?? null;
          entry.color = mat.color ? `#${mat.color.getHexString()}` : null;
          details[kind] = entry;
        }
        return details;
      },
      /** PR2：当前着色输入的只读快照（视图、回放 E、基线、lAMYG #40 的 ΔE），
       *  供测试确认 ΔE 着色读的是哪份数据。 */
      getColorDebug: () => {
        const e = replayERef.current ?? latestERef.current;
        const base = baselineERef.current;
        return {
          colorMode: colorModeRef.current,
          hasReplayE: replayERef.current !== null,
          hasBaseline: base !== null,
          e40: e ? e[40] : null,
          base40: base ? base[40] : null,
          delta40: e && base ? e[40] - base[40] : null,
        };
      },
      /** PR2：某脑区顶点当前实际显示色的平均值（插值后的画面颜色，
       *  不是目标色），供测试直接确认着色结果。 */
      getRegionDisplayColor: (node: number) => {
        const sc = sceneRef.current;
        if (!sc) return null;
        const { colors } = sc;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.regionMap.length; i++) {
          if (data.regionMap[i] === node) {
            r += colors[i * 3];
            g += colors[i * 3 + 1];
            b += colors[i * 3 + 2];
            n++;
          }
        }
        return n > 0 ? [r / n, g / n, b / n] : null;
      },
    };

    tick();

    return () => {
      cancelAnimationFrame(raf);
      endHold();
      delete (window as unknown as { __brainScene?: unknown }).__brainScene;
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener(
        'pointerrawupdate',
        onPointerRawUpdate as EventListener,
      );
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      controls.dispose();
      geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      (wire.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
    // data 只在加载完成后传入一次；后续状态变化由上面的 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="brain-scene" ref={containerRef}>
      <div className="brain-tooltip" ref={tooltipRef} style={{ display: 'none' }} />
      <div className="brain-hint">
        {hoverId !== null
          ? `${data.regions[hoverId].label} · #${hoverId}`
          : '将鼠标移到大脑上查看脑区'}
      </div>
    </div>
  );
}
