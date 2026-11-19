/**
 * PictorialHead — the head node of the pictorial closed-loop bench
 * (design §2). A small self-contained Three.js scene: the TVB cortex
 * mesh (same data, same activity colouring as BrainScene) inside a
 * translucent head shell, wearing a cap with electrode DISCS (not green
 * spheres) and cables.
 *
 * Self-contained on purpose: App.tsx passes this component as the bench
 * `networkView`, and it reads everything it needs itself (cap preset from
 * the benchSettings store, head model from the headModelSelection store,
 * sphere fixture via useSphereFixture) — no cloneElement electrode
 * injection from ClosedLoopBench.
 *
 * - Brain: TVB cortex_16384, vertices centred, absolute-E heat colouring
 *   (dark blue-grey -> amber -> bright amber, BrainScene's absolute mode),
 *   hover/select blue mix. Click selects a region and opens the brain
 *   drill-down; drag rotates, wheel zooms. Clicking never stimulates here (bench main flow is the
 *   experiment computer; manual stimulation lives in the brain drill-down).
 * - Head shell: LatheGeometry forehead->crown->occiput->neck profile,
 *   MeshPhysicalMaterial, opacity ~0.18, DoubleSide, depthWrite false.
 *   Raycast disabled — it never intercepts a click. Shape only, no
 *   anatomical claim.
 * - Cap: a second shell at 1.02x the head-shell radius, upper hemisphere
 *   only (thetaLength ~0.55 PI, crown to just above the ears), dark fabric
 *   + an elastic band ring. The cap shell DOES take part in picking:
 *   clicking it (or a disc) opens the cap drill-down.
 * - Electrodes: small cylinders (radius 2.2 mm, height 1.2 mm), face
 *   normal along the electrode direction, sitting on the cap surface.
 *   Positions come from selectBenchElectrodes (unchanged): sphere takes
 *   the fixture sensors, template BEM takes its own electrodes. Neutral
 *   light-grey metal; the selected waveform channel gets an amber ring.
 * - Cables: thin tubes from disc to a bundle pointing at the amplifier
 *   (head-node right edge). Only the selected channel + Cz + the 8
 *   nearest neighbours get cables (256 tubes would be unreadable);
 *   the channel TABLE in the cap drill-down carries full channel choice.
 * - Honest label (under the canvas): electrode positions are a
 *   head-model direction sketch, not anatomically registered; cap and
 *   head shell are schematic models.
 *
 * Debug bridge (tests): window.__pictorialHead.getElectrodeDiscs() —
 * { label, geometry: 'CylinderGeometry', color, position, selected } —
 * so the pinning test can tell cap discs apart from the old green
 * spheres (SphereGeometry, 0x2fd47a).
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BrainData } from '../lib/brainData';
import type { SimClient } from '../lib/simClient';
import { useI18n } from '../lib/i18n';
import {
  getBenchSettings, subscribeBenchSettings,
} from '../lib/benchSettings';
import {
  getHeadModelSelection, subscribeHeadModelSelection,
} from '../lib/headModelSelection';
import { selectBenchCapChannels } from '../lib/benchCap';
import { selectBenchElectrodes } from '../lib/benchElectrodes';
import { getTemplateModel } from '../lib/fsaverageBEM';
import { useSphereFixture } from '../lib/benchFixture';

// Copied from BrainScene (same mesh, same lights, same colouring) — the
// brain itself is unchanged, only the shell around it is new.
const BASE_COLOR = new THREE.Color('#2a4a66');
const AMBER_COLOR = new THREE.Color('#ffb340');
const HOT_COLOR = new THREE.Color('#fff8ec');
const HOVER_COLOR = new THREE.Color('#4fb6f2');
const SELECTED_COLOR = new THREE.Color('#a8d8fa');
const E_BASELINE = 0.011;
const E_PEAK = 0.5;
// Pictorial head framing: BrainScene's (75, 95, 245) puts the camera
// ~273 mm from the origin, but the head shell spans ~294 mm — the shell
// overflows the frame and reads as a ball (R1 screenshot, 2026-11-19).
// Pull back to ~365 mm so the whole head + neck fits with a margin.
const DEFAULT_CAMERA_POS = new THREE.Vector3(95, 120, 330);
const CLICK_MOVE_THRESHOLD_PX = 6;

const DISC_COLOR = 0xc8d2dc;
const DISC_RADIUS_MM = 2.2;
const DISC_HEIGHT_MM = 1.2;
const SELECT_RING_COLOR = 0xffb340;
const CABLE_COLOR = 0xff9a3c;
const CABLE_RADIUS_MM = 0.55;
/** Cap shell radius = head-shell radius x 1.02 (design §2.2). */
const CAP_RADIUS_FACTOR = 1.02;
/** Head-shell profile max radius, in units of the brain bounding radius. */
const HEAD_PROFILE_MAX_R = 1.04;

export interface PictorialHeadProps {
  data: BrainData;
  sim: SimClient | null;
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Waveform channel: its disc gets the amber ring. */
  selectedChannel: string;
  /** Clicking the cap shell or a disc opens the cap drill-down. Optional:
   * when omitted (App creates this element as `networkView` and does not
   * own drill-down state), the click dispatches a window
   * 'pictorial-open-cap' CustomEvent that ClosedLoopBench listens for.
   * Either way no cloneElement is involved. */
  onCapOpen?: () => void;
  /** Clicking the brain selects the region AND opens the brain
   * drill-down ("点人头 / 脑", design §6.1). Same optional/event
   * pattern as onCapOpen: 'pictorial-open-brain'. */
  onBrainOpen?: () => void;
}

export default function PictorialHead(props: PictorialHeadProps) {
  const { data, sim, selectedId, onSelect, selectedChannel, onCapOpen, onBrainOpen } = props;
  const { locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);

  // ---------- cap electrodes: same sources as the old green dots ----------
  const headModel = useSyncExternalStore(subscribeHeadModelSelection, getHeadModelSelection);
  const { fixture, fixtureError } = useSphereFixture();
  const settings = useSyncExternalStore(subscribeBenchSettings, getBenchSettings);
  const capPreset = settings.capPreset;
  const capSelection = useMemo(() => {
    if (!fixture) return null;
    try {
      return selectBenchCapChannels(fixture, capPreset);
    } catch {
      return null;
    }
  }, [fixture, capPreset]);
  const bemModel = headModel === 'bem' ? getTemplateModel() : null;
  const benchElectrodes = useMemo(() => selectBenchElectrodes({
    headModel, fixture, capSelection, bemModel,
  }), [headModel, fixture, capSelection, bemModel]);
  const electrodeCount = benchElectrodes?.electrodes.length ?? 0;

  // ---------- Three.js scene ----------
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh;
    geometry: THREE.BufferGeometry;
    colors: Float32Array;
    colorAttr: THREE.BufferAttribute;
    capGroup: THREE.Group;
    discGroup: THREE.Group;
    /** The elastic band: solid, so it counts as "cap" for picking. */
    band: THREE.Mesh;
    cableGroup: THREE.Group;
    brainRadius: number;
    capRadius: number;
    raycaster: THREE.Raycaster;
  } | null>(null);
  const latestERef = useRef<Float64Array | null>(null);
  const targetColorsRef = useRef<Float32Array | null>(null);
  const colorActiveRef = useRef(false);
  const hoverRef = useRef<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const tmpColor = useRef(new THREE.Color());
  const electrodesRef = useRef(benchElectrodes);
  electrodesRef.current = benchElectrodes;
  const selectedChannelRef = useRef(selectedChannel);
  selectedChannelRef.current = selectedChannel;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onCapOpenRef = useRef(onCapOpen);
  onCapOpenRef.current = onCapOpen;
  const openCap = () => {
    if (onCapOpenRef.current) onCapOpenRef.current();
    else window.dispatchEvent(new CustomEvent('pictorial-open-cap'));
  };
  const onBrainOpenRef = useRef(onBrainOpen);
  onBrainOpenRef.current = onBrainOpen;
  const openBrain = () => {
    if (onBrainOpenRef.current) onBrainOpenRef.current();
    else window.dispatchEvent(new CustomEvent('pictorial-open-brain'));
  };
  const dataRef = useRef(data);
  dataRef.current = data;

  const recomputeTargets = () => {
    const targets = targetColorsRef.current;
    if (!targets) return;
    const e = latestERef.current;
    const d = dataRef.current;
    const h = hoverRef.current;
    const sel = selectedRef.current;
    const c = tmpColor.current;
    for (let i = 0; i < d.regionMap.length; i++) {
      const r = d.regionMap[i];
      if (e) {
        const intensity = Math.min(1, Math.max(0, (e[r] - E_BASELINE) / (E_PEAK - E_BASELINE)));
        if (intensity <= 0.55) {
          c.copy(BASE_COLOR).lerp(AMBER_COLOR, Math.pow(intensity / 0.55, 0.8));
        } else {
          c.copy(AMBER_COLOR).lerp(HOT_COLOR, Math.pow((intensity - 0.55) / 0.45, 0.7));
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

  // Subscribe to simulation snapshots: only update target colours.
  useEffect(() => {
    if (!sim) return;
    const unsub = sim.subscribe((snap) => {
      latestERef.current = snap.e;
      recomputeTargets();
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim]);

  useEffect(() => {
    hoverRef.current = hoverId;
    recomputeTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverId]);
  useEffect(() => {
    selectedRef.current = selectedId;
    recomputeTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ---------- electrode discs + cables ----------
  // Discs live in their own subgroup: rebuild must never touch the cap
  // shell or the band (they are siblings, not disc children).
  const rebuildElectrodes = () => {
    const s = sceneRef.current;
    if (!s) return;
    const disposeGroup = (group: THREE.Group) => {
      while (group.children.length > 0) {
        const child = group.children.pop()!;
        if (child instanceof THREE.Mesh) {
          // A disc may carry its amber ring as a child mesh: dispose it too.
          for (const sub of [...child.children]) {
            if (sub instanceof THREE.Mesh) {
              sub.geometry.dispose();
              (sub.material as THREE.Material).dispose();
            }
          }
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      }
    };
    disposeGroup(s.discGroup);
    disposeGroup(s.cableGroup);
    const set = electrodesRef.current;
    if (!set || set.electrodes.length === 0) return;
    const capR = s.capRadius;
    const up = new THREE.Vector3(0, 1, 0);
    const discGeo = new THREE.CylinderGeometry(DISC_RADIUS_MM, DISC_RADIUS_MM, DISC_HEIGHT_MM, 20);
    const discMat = new THREE.MeshStandardMaterial({
      color: DISC_COLOR, metalness: 0.55, roughness: 0.35,
    });
    const ringGeo = new THREE.TorusGeometry(DISC_RADIUS_MM + 0.7, 0.4, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: SELECT_RING_COLOR });
    const selected = selectedChannelRef.current;
    for (const e of set.electrodes) {
      const dir = new THREE.Vector3(e.direction[0], e.direction[1], e.direction[2]);
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.position.copy(dir).multiplyScalar(capR + DISC_HEIGHT_MM / 2);
      disc.quaternion.setFromUnitVectors(up, dir);
      disc.userData.electrodeLabel = e.label;
      disc.userData.isDisc = true;
      if (e.label === selected) {
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = DISC_HEIGHT_MM / 2 + 0.2;
        ring.userData.isDisc = true;
        ring.userData.electrodeLabel = e.label;
        disc.add(ring);
      }
      s.discGroup.add(disc);
    }
    // Cables: selected channel + Cz + the 8 nearest neighbours by angle.
    // 256 tubes would be unreadable; the channel table in the cap
    // drill-down carries full channel choice.
    const dirs = set.electrodes;
    const byLabel = new Map(dirs.map((d) => [d.label, d]));
    const selDir = byLabel.get(selected) ?? dirs.find((d) => d.label === 'Cz') ?? dirs[0];
    if (!selDir) return;
    const selVec = new THREE.Vector3(...selDir.direction);
    // Nearest neighbours by angle — but only the camera-facing ones get
    // cables: a back-side disc's cable would cut straight through the
    // head volume. (Camera sits at +Z; keep directions with z > -0.2.)
    const neighbours = [...dirs]
      .filter((d) => d.label !== selDir.label && d.direction[2] > -0.2)
      .map((d) => ({
        d,
        dot: selVec.dot(new THREE.Vector3(...d.direction)),
      }))
      .sort((a, b) => b.dot - a.dot)
      .slice(0, 8)
      .map((x) => x.d);
    const cableLabels = new Set([selDir.label, 'Cz', ...neighbours.map((d) => d.label)]);
    const bundle = new THREE.Vector3(capR + 36, capR * 0.15, 0);
    const cableMat = new THREE.MeshBasicMaterial({ color: CABLE_COLOR });
    for (const d of dirs) {
      if (!cableLabels.has(d.label)) continue;
      if (d.direction[2] <= -0.2) continue;
      const dir = new THREE.Vector3(...d.direction);
      const start = dir.clone().multiplyScalar(capR + DISC_HEIGHT_MM);
      // Lift the curve off the cap surface at the start (outward along
      // the disc normal) so it drapes over the head, not through it:
      // the control point sits just outside the disc, and the curve
      // only then sweeps right to the bundle.
      const mid = start.clone().add(dir.clone().multiplyScalar(50))
        .add(new THREE.Vector3(0, 8, 0));
      const curve = new THREE.QuadraticBezierCurve3(start, mid, bundle);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 20, CABLE_RADIUS_MM, 6),
        cableMat,
      );
      s.cableGroup.add(tube);
    }
  };
  useEffect(() => {
    rebuildElectrodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [benchElectrodes, selectedChannel]);

  // ---------- scene init (once) ----------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const d = dataRef.current;

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
    controls.minDistance = 160;
    controls.maxDistance = 700;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    // BrainScene Phase 4 lights (unchanged).
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

    // Brain mesh: raw vertices, centred only (BrainScene's geometry code).
    const positions = new Float32Array(d.vertices);
    const box = new THREE.Box3();
    const tmp = new THREE.Vector3();
    for (let i = 0; i < positions.length; i += 3) {
      tmp.set(positions[i], positions[i + 1], positions[i + 2]);
      box.expandByPoint(tmp);
    }
    const centerOffset = box.getCenter(new THREE.Vector3());
    const brainRadius = box.getBoundingSphere(new THREE.Sphere()).radius;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] -= centerOffset.x;
      positions[i + 1] -= centerOffset.y;
      positions[i + 2] -= centerOffset.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(d.triangles, 1));
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
        vertexColors: true, roughness: 0.42, metalness: 0.08,
      }),
    );
    scene.add(mesh);
    const wire = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x3487c4, wireframe: true, transparent: true, opacity: 0.12,
      }),
    );
    scene.add(wire);

    // Head shell: LatheGeometry forehead -> crown -> occiput -> neck.
    // A lathe, not a scaled sphere, so the first look is a head, not a
    // ball. Profile in units of the brain bounding radius R.
    const R = brainRadius;
    const profile: Array<[number, number]> = [
      [0.0, -1.05], [0.45, -1.02], [0.68, -0.88], [0.88, -0.6],
      [1.0, -0.25], [HEAD_PROFILE_MAX_R, 0.1], [1.0, 0.45],
      [0.85, 0.75], [0.6, 0.95], [0.3, 1.06], [0.0, 1.1],
    ];
    const headGeo = new THREE.LatheGeometry(
      profile.map(([x, y]) => new THREE.Vector2(x * R, y * R)),
      48,
    );
    const headShell = new THREE.Mesh(
      headGeo,
      new THREE.MeshPhysicalMaterial({
        color: 0xcfe4f5, transparent: true, opacity: 0.15,
        side: THREE.DoubleSide, depthWrite: false, roughness: 0.4,
      }),
    );
    // The shell never intercepts a click: picking only ever sees the
    // brain mesh and the cap group.
    headShell.raycast = () => {};
    scene.add(headShell);

    // Cap shell: radius = head-shell radius x 1.02, upper hemisphere
    // only (crown to just above the ears). DEVIATION from design §2.2
    // (which says ~0.95 opaque): the R1 screenshot (2026-11-19) proved
    // a near-opaque cap hides the brain entirely — a dark ball — and
    // the product's core is seeing the brain change. 0.45 keeps the cap
    // readable (dark fabric + band + discs + cables) while the brain
    // shows through.
    const capRadius = HEAD_PROFILE_MAX_R * R * CAP_RADIUS_FACTOR;
    const capGeo = new THREE.SphereGeometry(capRadius, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const capShell = new THREE.Mesh(
      capGeo,
      new THREE.MeshStandardMaterial({
        color: 0x41546a, roughness: 0.9, metalness: 0.05,
        transparent: true, opacity: 0.45, side: THREE.DoubleSide,
      }),
    );
    // The cap veil is translucent: clicking "through" it at the brain is
    // a brain click, not a cap click (R2). Only the solid parts — discs
    // and band — count as cap for picking, so the veil never intercepts.
    capShell.raycast = () => {};
    const capGroup = new THREE.Group();
    capGroup.add(capShell);
    scene.add(capGroup);
    const discGroup = new THREE.Group();
    capGroup.add(discGroup);
    // Elastic band ring at the cap edge.
    const edgeTheta = Math.PI * 0.55;
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(capRadius * Math.sin(edgeTheta), 2.2, 12, 64),
      new THREE.MeshStandardMaterial({ color: 0x1c2836, roughness: 0.85 }),
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = capRadius * Math.cos(edgeTheta);
    capGroup.add(band);

    const cableGroup = new THREE.Group();
    scene.add(cableGroup);

    const raycaster = new THREE.Raycaster();
    sceneRef.current = {
      renderer, scene, camera, controls, mesh, geometry, colors, colorAttr,
      capGroup, discGroup, band, cableGroup, brainRadius, capRadius, raycaster,
    };
    rebuildElectrodes();

    const pick = (clientX: number, clientY: number): 'cap' | number | null => {
      const s = sceneRef.current;
      if (!s) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      s.raycaster.setFromCamera(ndc, s.camera);
      // Cap first — but only the SOLID cap parts (discs + band). The
      // translucent cap veil and head shell never intercept (raycast off).
      const capHits = s.raycaster.intersectObjects([s.discGroup, s.band], true);
      if (capHits.length > 0) return 'cap';
      const hits = s.raycaster.intersectObject(s.mesh, false);
      if (hits.length === 0 || !hits[0].face) return null;
      return dataRef.current.regionMap[hits[0].face.a];
    };

    let downX = 0;
    let downY = 0;
    const onPointerDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_MOVE_THRESHOLD_PX) return;
      const hit = pick(e.clientX, e.clientY);
      if (hit === 'cap') openCap();
      else if (typeof hit === 'number') {
        onSelectRef.current(hit);
        openBrain();
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return;
      const s = sceneRef.current;
      if (!s) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      s.raycaster.setFromCamera(ndc, s.camera);
      const hits = s.raycaster.intersectObject(s.mesh, false);
      const region = hits.length > 0 && hits[0].face
        ? dataRef.current.regionMap[hits[0].face.a]
        : null;
      if (region !== hoverRef.current) setHoverId(region);
    };
    const onDoubleClick = () => {
      const s = sceneRef.current;
      if (!s) return;
      s.camera.position.copy(DEFAULT_CAMERA_POS);
      s.controls.target.set(0, 0, 0);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
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
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = sceneRef.current;
      if (!s) return;
      controls.update();
      if (colorActiveRef.current) {
        const targets = targetColorsRef.current;
        if (targets) {
          const { colors: cols, colorAttr: attr } = s;
          let changed = false;
          for (let i = 0; i < cols.length; i++) {
            const dd = targets[i] - cols[i];
            if (Math.abs(dd) > 0.0005) { cols[i] += dd * 0.35; changed = true; }
            else if (dd !== 0) { cols[i] = targets[i]; changed = true; }
          }
          if (changed) attr.needsUpdate = true;
          else colorActiveRef.current = false;
        }
      }
      renderer.render(scene, camera);
    };
    tick();

    (window as unknown as { __pictorialHead?: unknown }).__pictorialHead = {
      getElectrodeDiscs: () => {
        const sc = sceneRef.current;
        if (!sc) return null;
        const out: Array<{
          label: string; geometry: string; color: string | null;
          position: number[]; selected: boolean;
        }> = [];
        for (const child of sc.discGroup.children) {
          if (!(child instanceof THREE.Mesh)) continue;
          const meshChild = child as THREE.Mesh;
          if (!meshChild.userData.isDisc) continue;
          const mat = meshChild.material as THREE.MeshStandardMaterial;
          out.push({
            label: meshChild.userData.electrodeLabel as string,
            geometry: meshChild.geometry.type,
            color: mat.color ? `#${mat.color.getHexString()}` : null,
            position: [meshChild.position.x, meshChild.position.y, meshChild.position.z],
            selected: (meshChild.userData.electrodeLabel as string) === selectedChannelRef.current,
          });
        }
        return out;
      },
      getCapRadius: () => sceneRef.current?.capRadius ?? null,
      getDiscCount: () => {
        const sc = sceneRef.current;
        if (!sc) return null;
        return sc.discGroup.children.filter((c) =>
          c instanceof THREE.Mesh && (c as THREE.Mesh).userData.isDisc).length;
      },
      getCameraPosition: () => {
        const sc = sceneRef.current;
        if (!sc) return null;
        return [sc.camera.position.x, sc.camera.position.y, sc.camera.position.z];
      },
      /** Project one disc to canvas CSS pixels (for tests: click a real
       *  disc to open the cap drill-down). Null when the disc is behind
       *  the camera or the scene is not ready. */
      projectDisc: (label: string) => {
        const sc = sceneRef.current;
        if (!sc) return null;
        const disc = sc.discGroup.children.find((c) =>
          c instanceof THREE.Mesh && (c as THREE.Mesh).userData.isDisc
          && (c as THREE.Mesh).userData.electrodeLabel === label);
        if (!disc) return null;
        const v = new THREE.Vector3();
        (disc as THREE.Mesh).getWorldPosition(v);
        v.project(sc.camera);
        if (v.z > 1) return null;
        const w = sc.renderer.domElement.clientWidth;
        const h = sc.renderer.domElement.clientHeight;
        return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
      },
    };

    return () => {
      cancelAnimationFrame(raf);
      delete (window as unknown as { __pictorialHead?: unknown }).__pictorialHead;
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      controls.dispose();
      geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      (wire.material as THREE.Material).dispose();
      headGeo.dispose();
      (headShell.material as THREE.Material).dispose();
      capGeo.dispose();
      (capShell.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
    // data only arrives once; later state flows through refs/effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capNote = locale === 'zh-CN'
    ? (benchElectrodes
      ? `圆片为${benchElectrodes.source === 'bem' ? '模板 BEM 自带电极' : '所选帽预设的电极'}（${electrodeCount} 个）；电极位置为头模型方向示意，未与演示网络解剖配准；帽与头壳为示意模型。`
      : headModel === 'bem'
        ? '模板 BEM 模型未加载，电极未显示（需先在物理模型页加载模板模型文件）。'
        : '脑电帽电极尚未加载。')
    : (benchElectrodes
      ? `Discs are the ${benchElectrodes.source === 'bem' ? 'template BEM electrodes' : 'selected cap preset electrodes'} (${electrodeCount}); electrode positions are a head-model direction sketch, not anatomically registered to the demo network. Cap and head shell are schematic models.`
      : headModel === 'bem'
        ? 'Template BEM model not loaded; electrodes not shown (load the template model on the physical model page first).'
        : 'Cap electrodes not loaded yet.');

  return (
    <div className="pict-head" data-testid="pictorial-head">
      <div className="pict-head-canvas" ref={containerRef} />
      <p className="pict-head-note">{capNote}{fixtureError ? ` ${fixtureError}` : ''}</p>
    </div>
  );
}
