/**
 * MinimalScene — the one full-page 3D closed-loop scene (minimal 3D loop
 * design, 2026-11-19 user direction 17:11).
 *
 * Fig. 12.1's IDEA, not a copy: head with cap on the left, amplifier in
 * the middle, recording computer on the right, stimulus computer below,
 * stimulator on the amber dashed closed-loop return path. Triggers is a
 * separate blue event-marking line (stimulus computer -> amplifier), not
 * the return path. No heart/lung sensors, no simulated hand, no keyboard.
 *
 * Only two things in the scene are tappable: the brain (opens the
 * 64-channel view) and the recording computer (opens the enlarged
 * multi-channel waveform). Amplifier / stimulus computer / stimulator are
 * pure scenery and never intercept a tap.
 *
 * - Brain: the same TVB cortex mesh + activity colouring as PictorialHead
 *   (dark blue-grey -> amber -> bright amber), inside a translucent head
 *   shell, wearing a cap with electrode discs and cables.
 * - Recording-PC screen: a live CanvasTexture of the same 6–8 channel
 *   waveform the enlarged view shows (drawn via drawMultiChannelWaveform
 *   from the getWaveData callback, ~7 Hz — display only).
 * - Flow: while a protocol runs, amber particles travel the closed loop
 *   (brain -> cap -> amplifier -> recording PC -> stimulus PC ->
 *   stimulator -> brain); still when stopped. The latest trace hop also
 *   flashes its node with a wireframe glow that decays.
 * - Camera distance adapts to the container aspect so the whole loop is
 *   visible at 390 px portrait as well as 1920 px desktop. Touch:
 *   one finger rotates, two finger pinch zooms (OrbitControls).
 *
 * No focus management anywhere in this file: no .focus() call, no
 * auto-focus effect (PR #45 iron rule). Taps are pointerdown/up with a
 * 6 px move threshold so drags never fire a tap.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BrainData } from '../lib/brainData';
import type { SimClient } from '../lib/simClient';
import { selectBenchCapChannels } from '../lib/benchCap';
import { selectBenchElectrodes } from '../lib/benchElectrodes';
import { useSphereFixture } from '../lib/benchFixture';
import { drawMultiChannelWaveform, type MultiChannelSeries } from '../lib/benchWaveform';
import type { BenchTraceEvent, BenchTraceHop } from '../lib/benchTrace';
import { useI18n } from '../lib/i18n';

// Copied from PictorialHead (same mesh, same lights, same colouring) — the
// brain itself is unchanged, only the scene around it is new.
const BASE_COLOR = new THREE.Color('#2a4a66');
const AMBER_COLOR = new THREE.Color('#ffb340');
const HOT_COLOR = new THREE.Color('#fff8ec');
const E_BASELINE = 0.011;
const E_PEAK = 0.5;
const CLICK_MOVE_THRESHOLD_PX = 6;

const DISC_COLOR = 0xc8d2dc;
const DISC_RADIUS_MM = 2.2;
const DISC_HEIGHT_MM = 1.2;
const SELECT_RING_COLOR = 0xffb340;
const CABLE_COLOR = 0xff9a3c;
const CABLE_RADIUS_MM = 0.55;
const CAP_RADIUS_FACTOR = 1.02;
const HEAD_PROFILE_MAX_R = 1.04;
/** Cap radius in scene units after the head group is scaled. */
const HEAD_CAP_RADIUS = 140;

// Loop layout (scene units; head group is scaled so its cap radius is 140).
const HEAD_POS = new THREE.Vector3(-430, 40, 0);
const AMP_POS = new THREE.Vector3(0, 40, 0);
const REC_POS = new THREE.Vector3(430, 40, 0);
const STIM_PC_POS = new THREE.Vector3(30, -330, 0);
const STIMULATOR_POS = new THREE.Vector3(-260, -330, 0);

const HOP_NODE: Record<BenchTraceHop, string> = {
  brain: 'brain',
  amplifier: 'amplifier',
  'test-computer': 'recording',
  'experiment-computer': 'stimulus-pc',
  stimulator: 'stimulator',
};

export interface MinimalSceneProps {
  data: BrainData;
  sim: SimClient | null;
  selectedChannel: string;
  running: boolean;
  /** An overlay is open: throttle WebGL rendering (crash investigation —
   * on iPhone the memory + re-render pressure behind an open overlay is
   * one of the suspected tap-crash mechanisms). */
  overlayOpen: boolean;
  /** Latest trace events (oldest first); the scene flashes each new hop. */
  traceEvents: BenchTraceEvent[];
  /** Live 6–8 channel series for the recording-PC screen texture. */
  getWaveData: () => MultiChannelSeries[] | null;
  trialCount: number;
  onBrainTap: () => void;
  onDiscTap: (label: string) => void;
  onRecordingTap: () => void;
}

function makeLabelSprite(lines: string[], color = '#d7e5ef'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = lines.length > 1 ? 160 : 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText(lines[0], 256, lines.length > 1 ? 52 : 48);
    if (lines.length > 1) {
      ctx.font = '32px sans-serif';
      ctx.fillStyle = '#8fa8bd';
      ctx.fillText(lines[1], 256, 116);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(230, lines.length > 1 ? 72 : 43, 1);
  sprite.raycast = () => {};
  return sprite;
}

export default function MinimalScene(props: MinimalSceneProps) {
  const { data, sim, selectedChannel, running, overlayOpen, traceEvents, getWaveData, trialCount,
    onBrainTap, onDiscTap, onRecordingTap } = props;
  const { locale } = useI18n();
  const zh = locale === 'zh-CN';
  const containerRef = useRef<HTMLDivElement>(null);
  const { fixture } = useSphereFixture();

  const runningRef = useRef(running);
  runningRef.current = running;
  const overlayOpenRef = useRef(overlayOpen);
  overlayOpenRef.current = overlayOpen;
  const traceEventsRef = useRef(traceEvents);
  traceEventsRef.current = traceEvents;
  const getWaveDataRef = useRef(getWaveData);
  getWaveDataRef.current = getWaveData;
  const trialCountRef = useRef(trialCount);
  trialCountRef.current = trialCount;
  const selectedChannelRef = useRef(selectedChannel);
  selectedChannelRef.current = selectedChannel;
  const onBrainTapRef = useRef(onBrainTap);
  onBrainTapRef.current = onBrainTap;
  const onDiscTapRef = useRef(onDiscTap);
  onDiscTapRef.current = onDiscTap;
  const onRecordingTapRef = useRef(onRecordingTap);
  onRecordingTapRef.current = onRecordingTap;
  const dataRef = useRef(data);
  dataRef.current = data;
  const zhRef = useRef(zh);
  zhRef.current = zh;

  const latestERef = useRef<Float64Array | null>(null);
  const targetColorsRef = useRef<Float32Array | null>(null);
  const colorActiveRef = useRef(false);
  const tmpColor = useRef(new THREE.Color());

  const recomputeTargets = () => {
    const targets = targetColorsRef.current;
    if (!targets) return;
    const e = latestERef.current;
    const d = dataRef.current;
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

  // Cap electrodes: fixed default cap (10-10 · 64), sphere fixture only.
  const capSelection = useMemo(() => {
    if (!fixture) return null;
    try {
      return selectBenchCapChannels(fixture, '10-10-64');
    } catch {
      return null;
    }
  }, [fixture]);
  const benchElectrodes = useMemo(() => {
    if (!fixture || !capSelection) return null;
    return selectBenchElectrodes({ headModel: 'sphere', fixture, capSelection, bemModel: null });
  }, [fixture, capSelection]);
  const electrodesRef = useRef(benchElectrodes);
  electrodesRef.current = benchElectrodes;

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
      45, container.clientWidth / Math.max(container.clientHeight, 1), 0.1, 12000,
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 400;
    controls.maxDistance = 6000;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    const fitCamera = () => {
      const w = container.clientWidth;
      const h = Math.max(container.clientHeight, 1);
      const aspect = w / h;
      camera.aspect = aspect;
      // Loop content: x in [-580, 580], y in [-420, 280], centre (0, -70).
      const dist = Math.max(390 / Math.tan(Math.PI / 8), 625 / (Math.tan(Math.PI / 8) * aspect)) * 1.05;
      camera.position.set(0, -70, dist);
      controls.target.set(0, -70, 0);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    fitCamera();

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

    // ---------- head group (scaled so the cap radius is HEAD_CAP_RADIUS) ----------
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
    const headScale = HEAD_CAP_RADIUS / (HEAD_PROFILE_MAX_R * brainRadius * CAP_RADIUS_FACTOR);
    const headGroup = new THREE.Group();
    headGroup.position.copy(HEAD_POS);
    headGroup.scale.setScalar(headScale);
    scene.add(headGroup);

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
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08 }),
    );
    headGroup.add(mesh);
    const wire = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: 0x3487c4, wireframe: true, transparent: true, opacity: 0.12 }),
    );
    headGroup.add(wire);

    const R = brainRadius;
    const profile: Array<[number, number]> = [
      [0.0, -1.05], [0.45, -1.02], [0.68, -0.88], [0.88, -0.6],
      [1.0, -0.25], [HEAD_PROFILE_MAX_R, 0.1], [1.0, 0.45],
      [0.85, 0.75], [0.6, 0.95], [0.3, 1.06], [0.0, 1.1],
    ];
    const headGeo = new THREE.LatheGeometry(
      profile.map(([x, y]) => new THREE.Vector2(x * R, y * R)), 48,
    );
    const headShell = new THREE.Mesh(
      headGeo,
      new THREE.MeshPhysicalMaterial({
        color: 0xcfe4f5, transparent: true, opacity: 0.15,
        side: THREE.DoubleSide, depthWrite: false, roughness: 0.4,
      }),
    );
    headShell.raycast = () => {};
    headGroup.add(headShell);

    const capRadius = HEAD_PROFILE_MAX_R * R * CAP_RADIUS_FACTOR;
    const capGeo = new THREE.SphereGeometry(capRadius, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const capShell = new THREE.Mesh(
      capGeo,
      new THREE.MeshStandardMaterial({
        color: 0x41546a, roughness: 0.9, metalness: 0.05,
        transparent: true, opacity: 0.32, side: THREE.DoubleSide,
      }),
    );
    capShell.raycast = () => {};
    const capGroup = new THREE.Group();
    capGroup.add(capShell);
    headGroup.add(capGroup);
    const discGroup = new THREE.Group();
    capGroup.add(discGroup);
    const edgeTheta = Math.PI * 0.55;
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(capRadius * Math.sin(edgeTheta), 2.2, 12, 64),
      new THREE.MeshStandardMaterial({ color: 0x1c2836, roughness: 0.85 }),
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = capRadius * Math.cos(edgeTheta);
    capGroup.add(band);
    const cableGroup = new THREE.Group();
    headGroup.add(cableGroup);

    // ---------- amplifier ----------
    const ampGroup = new THREE.Group();
    ampGroup.position.copy(AMP_POS);
    scene.add(ampGroup);
    const ampBox = new THREE.Mesh(
      new THREE.BoxGeometry(250, 150, 80),
      new THREE.MeshStandardMaterial({ color: 0x1d4e89, roughness: 0.5, metalness: 0.25 }),
    );
    ampGroup.add(ampBox);
    const knobGeo = new THREE.CylinderGeometry(12, 12, 10, 20);
    const knobMat = new THREE.MeshStandardMaterial({ color: 0x9fc8ff, roughness: 0.35, metalness: 0.5 });
    for (const kx of [-70, 0, 70]) {
      const knob = new THREE.Mesh(knobGeo, knobMat);
      knob.rotation.x = Math.PI / 2;
      knob.position.set(kx, -20, 44);
      ampGroup.add(knob);
    }

    // ---------- recording computer (tappable) ----------
    const recGroup = new THREE.Group();
    recGroup.position.copy(REC_POS);
    scene.add(recGroup);
    const recFrame = new THREE.Mesh(
      new THREE.BoxGeometry(300, 210, 24),
      new THREE.MeshStandardMaterial({ color: 0x0d1824, roughness: 0.4, metalness: 0.3 }),
    );
    recFrame.userData.nodeId = 'recording';
    recGroup.add(recFrame);
    // Live multi-channel waveform texture on the screen.
    const screenCanvas = document.createElement('canvas');
    screenCanvas.width = 512;
    screenCanvas.height = 320;
    const screenCtx = screenCanvas.getContext('2d');
    if (screenCtx) {
      screenCtx.fillStyle = '#070e16';
      screenCtx.fillRect(0, 0, 512, 320);
    }
    const screenTex = new THREE.CanvasTexture(screenCanvas);
    const recScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(272, 182),
      new THREE.MeshBasicMaterial({ map: screenTex }),
    );
    recScreen.position.z = 13;
    recScreen.userData.nodeId = 'recording';
    recGroup.add(recScreen);
    const recStand = new THREE.Mesh(
      new THREE.BoxGeometry(30, 40, 20),
      new THREE.MeshStandardMaterial({ color: 0x0d1824, roughness: 0.5 }),
    );
    recStand.position.set(0, -125, 0);
    recGroup.add(recStand);
    const recBase = new THREE.Mesh(
      new THREE.BoxGeometry(140, 10, 60),
      new THREE.MeshStandardMaterial({ color: 0x0d1824, roughness: 0.5 }),
    );
    recBase.position.set(0, -150, 0);
    recGroup.add(recBase);

    // ---------- stimulus computer (scenery only) ----------
    const stimPcGroup = new THREE.Group();
    stimPcGroup.position.copy(STIM_PC_POS);
    scene.add(stimPcGroup);
    const stimPcFrame = new THREE.Mesh(
      new THREE.BoxGeometry(260, 180, 24),
      new THREE.MeshStandardMaterial({ color: 0x3b2d6b, roughness: 0.4, metalness: 0.3 }),
    );
    stimPcGroup.add(stimPcFrame);
    const stimScreenCanvas = document.createElement('canvas');
    stimScreenCanvas.width = 512;
    stimScreenCanvas.height = 320;
    const stimScreenTex = new THREE.CanvasTexture(stimScreenCanvas);
    const stimScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(232, 152),
      new THREE.MeshBasicMaterial({ map: stimScreenTex }),
    );
    stimScreen.position.z = 13;
    stimPcGroup.add(stimScreen);
    const stimPcStand = new THREE.Mesh(
      new THREE.BoxGeometry(26, 34, 18),
      new THREE.MeshStandardMaterial({ color: 0x3b2d6b, roughness: 0.5 }),
    );
    stimPcStand.position.set(0, -107, 0);
    stimPcGroup.add(stimPcStand);
    const stimPcBase = new THREE.Mesh(
      new THREE.BoxGeometry(120, 10, 54),
      new THREE.MeshStandardMaterial({ color: 0x3b2d6b, roughness: 0.5 }),
    );
    stimPcBase.position.set(0, -129, 0);
    stimPcGroup.add(stimPcBase);

    // ---------- stimulator (scenery only, on the return path) ----------
    const stimGroup = new THREE.Group();
    stimGroup.position.copy(STIMULATOR_POS);
    scene.add(stimGroup);
    const stimBox = new THREE.Mesh(
      new THREE.BoxGeometry(150, 100, 70),
      new THREE.MeshStandardMaterial({ color: 0x7a4d12, roughness: 0.5, metalness: 0.25 }),
    );
    stimGroup.add(stimBox);
    const boltShape = new THREE.Shape();
    boltShape.moveTo(12, 34);
    boltShape.lineTo(-10, -6);
    boltShape.lineTo(2, -6);
    boltShape.lineTo(-12, -34);
    boltShape.lineTo(10, 4);
    boltShape.lineTo(-2, 4);
    boltShape.closePath();
    const bolt = new THREE.Mesh(
      new THREE.ExtrudeGeometry(boltShape, { depth: 6, bevelEnabled: false }),
      new THREE.MeshBasicMaterial({ color: 0xffb340 }),
    );
    bolt.position.set(0, 0, 36);
    stimGroup.add(bolt);

    // ---------- labels ----------
    const t = (a: string, b: string): [string, string] => [a, b];
    const headLabel = makeLabelSprite(t('大脑', 'Brain'));
    headLabel.position.set(HEAD_POS.x, HEAD_POS.y + 235, 0);
    scene.add(headLabel);
    const ampLabel = makeLabelSprite(t('放大器', 'Amplifier'));
    ampLabel.position.set(AMP_POS.x, AMP_POS.y + 150, 0);
    scene.add(ampLabel);
    const recLabel = makeLabelSprite(t('记录电脑', 'Recording PC'));
    recLabel.position.set(REC_POS.x, REC_POS.y + 180, 0);
    scene.add(recLabel);
    const stimPcLabel = makeLabelSprite(t('刺激电脑', 'Stimulus PC'));
    stimPcLabel.position.set(STIM_PC_POS.x, STIM_PC_POS.y + 165, 0);
    scene.add(stimPcLabel);
    const stimLabel = makeLabelSprite(t('刺激器', 'Stimulator'));
    stimLabel.position.set(STIMULATOR_POS.x, STIMULATOR_POS.y + 125, 0);
    scene.add(stimLabel);
    const eegLabel = makeLabelSprite(['EEG electrodes'], '#ff9a3c');
    eegLabel.scale.set(190, 36, 1);
    eegLabel.position.set(-215, 95, 0);
    scene.add(eegLabel);
    const usbLabel = makeLabelSprite(['USB'], '#ff9a3c');
    usbLabel.scale.set(90, 36, 1);
    usbLabel.position.set(215, 95, 0);
    scene.add(usbLabel);
    const trigLabel = makeLabelSprite(['triggers'], '#4fb6f2');
    trigLabel.scale.set(130, 36, 1);
    trigLabel.position.set(150, -95, 0);
    scene.add(trigLabel);
    const returnLabel = makeLabelSprite(t('闭环回程', 'closed-loop return'), '#ffb340');
    returnLabel.scale.set(190, 36, 1);
    returnLabel.position.set(300, -240, 0);
    scene.add(returnLabel);

    // ---------- loop lines ----------
    const forwardCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-290, 40, 0),
      new THREE.Vector3(-125, 40, 0),
      new THREE.Vector3(125, 40, 0),
      new THREE.Vector3(280, 40, 0),
    ]);
    const forwardTube = new THREE.Mesh(
      new THREE.TubeGeometry(forwardCurve, 32, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0x6fb3e8 }),
    );
    scene.add(forwardTube);
    const returnCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(430, -70, 0),
      new THREE.Vector3(430, -200, 0),
      new THREE.Vector3(160, -330, 0),
      new THREE.Vector3(-185, -330, 0),
      new THREE.Vector3(-335, -330, 0),
      new THREE.Vector3(-430, -140, 0),
      new THREE.Vector3(-430, -100, 0),
    ]);
    const returnLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(returnCurve.getPoints(80)),
      new THREE.LineDashedMaterial({ color: 0xffb340, dashSize: 16, gapSize: 12 }),
    );
    returnLine.computeLineDistances();
    scene.add(returnLine);
    // Triggers: event-marking line, stimulus PC -> amplifier (not the return).
    const trigGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(30, -240, 0),
      new THREE.Vector3(0, -35, 0),
    ]);
    const trigLine = new THREE.Line(
      trigGeo, new THREE.LineBasicMaterial({ color: 0x4fb6f2 }),
    );
    scene.add(trigLine);

    // ---------- flow particles on the closed loop ----------
    const loopCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-290, 40, 0),
      new THREE.Vector3(-125, 40, 0),
      new THREE.Vector3(125, 40, 0),
      new THREE.Vector3(280, 40, 0),
      new THREE.Vector3(430, -70, 0),
      new THREE.Vector3(430, -200, 0),
      new THREE.Vector3(160, -330, 0),
      new THREE.Vector3(-185, -330, 0),
      new THREE.Vector3(-335, -330, 0),
      new THREE.Vector3(-430, -140, 0),
      new THREE.Vector3(-430, -100, 0),
      new THREE.Vector3(-430, -40, 0),
    ], true);
    const PARTICLE_COUNT = 14;
    const particleGeo = new THREE.SphereGeometry(7, 12, 12);
    const particleMat = new THREE.MeshBasicMaterial({ color: 0xffb340 });
    const particles: THREE.Mesh[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p = new THREE.Mesh(particleGeo, particleMat);
      p.visible = false;
      scene.add(p);
      particles.push(p);
    }

    // ---------- node glow flashes (wireframe, decay in the tick) ----------
    const glowMat = (color: number) => new THREE.MeshBasicMaterial({
      color, wireframe: true, transparent: true, opacity: 0,
    });
    const glows: Record<string, THREE.Mesh> = {};
    const addGlow = (id: string, meshObj: THREE.Mesh) => {
      meshObj.raycast = () => {};
      scene.add(meshObj);
      glows[id] = meshObj;
    };
    const brainGlow = new THREE.Mesh(
      new THREE.SphereGeometry(HEAD_CAP_RADIUS * 1.18, 16, 12), glowMat(0x4fb6f2));
    brainGlow.position.copy(HEAD_POS);
    addGlow('brain', brainGlow);
    const ampGlow = new THREE.Mesh(
      new THREE.BoxGeometry(270, 170, 100), glowMat(0x4fb6f2));
    ampGlow.position.copy(AMP_POS);
    addGlow('amplifier', ampGlow);
    const recGlow = new THREE.Mesh(
      new THREE.BoxGeometry(320, 230, 44), glowMat(0x2fd47a));
    recGlow.position.copy(REC_POS);
    addGlow('recording', recGlow);
    const stimPcGlow = new THREE.Mesh(
      new THREE.BoxGeometry(280, 200, 44), glowMat(0xffb829));
    stimPcGlow.position.copy(STIM_PC_POS);
    addGlow('stimulus-pc', stimPcGlow);
    const stimGlow = new THREE.Mesh(
      new THREE.BoxGeometry(170, 120, 90), glowMat(0xffb340));
    stimGlow.position.copy(STIMULATOR_POS);
    addGlow('stimulator', stimGlow);

    // ---------- electrode discs + cables (rebuild on fixture/selection) ----------
    const rebuildElectrodes = () => {
      const disposeGroup = (group: THREE.Group) => {
        while (group.children.length > 0) {
          const child = group.children.pop()!;
          if (child instanceof THREE.Mesh) {
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
      disposeGroup(discGroup);
      disposeGroup(cableGroup);
      const set = electrodesRef.current;
      if (!set || set.electrodes.length === 0) return;
      const capR = capRadius;
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
        discGroup.add(disc);
      }
      const dirs = set.electrodes;
      const byLabel = new Map(dirs.map((dd) => [dd.label, dd]));
      const selDir = byLabel.get(selected) ?? dirs.find((dd) => dd.label === 'Cz') ?? dirs[0];
      if (!selDir) return;
      const selVec = new THREE.Vector3(...selDir.direction);
      const neighbours = [...dirs]
        .filter((dd) => dd.label !== selDir.label && dd.direction[2] > -0.2)
        .map((dd) => ({ dd, dot: selVec.dot(new THREE.Vector3(...dd.direction)) }))
        .sort((a, b) => b.dot - a.dot)
        .slice(0, 8)
        .map((x) => x.dd);
      const cableLabels = new Set([selDir.label, 'Cz', ...neighbours.map((dd) => dd.label)]);
      const bundle = new THREE.Vector3(capR + 36, capR * 0.15, 0);
      const cableMat = new THREE.MeshBasicMaterial({ color: CABLE_COLOR });
      for (const dd of dirs) {
        if (!cableLabels.has(dd.label)) continue;
        if (dd.direction[2] <= -0.2) continue;
        const dir = new THREE.Vector3(...dd.direction);
        const start = dir.clone().multiplyScalar(capR + DISC_HEIGHT_MM);
        const mid = start.clone().add(dir.clone().multiplyScalar(50))
          .add(new THREE.Vector3(0, 8, 0));
        const curve = new THREE.QuadraticBezierCurve3(start, mid, bundle);
        const tube = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 20, CABLE_RADIUS_MM, 6),
          cableMat,
        );
        cableGroup.add(tube);
      }
    };
    rebuildElectrodes();
    rebuildDiscsRef.current = rebuildElectrodes;

    // ---------- picking ----------
    const raycaster = new THREE.Raycaster();
    const pick = (clientX: number, clientY: number): 'brain' | 'recording' | string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const discHits = raycaster.intersectObjects([discGroup], true);
      for (const h of discHits) {
        const label = (h.object.userData.electrodeLabel
          ?? h.object.parent?.userData.electrodeLabel) as string | undefined;
        if (label) return label;
      }
      const recHits = raycaster.intersectObjects([recGroup], true);
      if (recHits.length > 0) return 'recording';
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length > 0) return 'brain';
      return null;
    };
    let downX = 0;
    let downY = 0;
    const onPointerDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > CLICK_MOVE_THRESHOLD_PX) return;
      const hit = pick(e.clientX, e.clientY);
      if (hit === null) return;
      if (hit === 'brain') onBrainTapRef.current();
      else if (hit === 'recording') onRecordingTapRef.current();
      else onDiscTapRef.current(hit);
    };
    const onDoubleClick = () => { fitCamera(); };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('dblclick', onDoubleClick);

    const resizeObserver = new ResizeObserver(() => { fitCamera(); });
    resizeObserver.observe(container);

    // ---------- stimulus-PC screen text ----------
    const drawStimScreen = () => {
      const ctx = stimScreenCanvas.getContext('2d');
      if (!ctx) return;
      const zhNow = zhRef.current;
      ctx.fillStyle = '#17102a';
      ctx.fillRect(0, 0, 512, 320);
      ctx.fillStyle = '#c9b8ff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 64px sans-serif';
      ctx.fillText('oddball', 256, 130);
      ctx.font = '40px sans-serif';
      ctx.fillStyle = '#8fa8bd';
      ctx.fillText(zhNow ? '稀有刺激' : 'Oddball task', 256, 200);
      ctx.font = '36px monospace';
      ctx.fillStyle = '#ffb340';
      ctx.fillText(`trials ${trialCountRef.current}`, 256, 268);
      stimScreenTex.needsUpdate = true;
    };
    drawStimScreen();
    let lastTrialCount = trialCountRef.current;
    let lastWaveDraw = 0;
    let lastRender = 0;
    let lastSeenSeq = -1;
    let particleOffset = 0;
    let lastTime = performance.now();

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      // Crash investigation: while an overlay is open or the tab is
      // backgrounded, render at most ~2 fps (and skip the screen-texture
      // redraw — the screen sits behind the overlay anyway). The scene
      // keeps its state; only the raster work is throttled.
      const throttled = overlayOpenRef.current || document.hidden;
      if (throttled && now - lastRender < 500) return;
      lastRender = now;
      controls.update();
      // Trace hops -> node glow flashes.
      const events = traceEventsRef.current;
      for (const ev of events) {
        if (ev.seq <= lastSeenSeq) continue;
        lastSeenSeq = ev.seq;
        const glow = glows[HOP_NODE[ev.hop]];
        if (glow) (glow.material as THREE.MeshBasicMaterial).opacity = 0.85;
      }
      for (const g of Object.values(glows)) {
        const m = g.material as THREE.MeshBasicMaterial;
        if (m.opacity > 0) m.opacity = Math.max(0, m.opacity - dt * 1.1);
      }
      // Particles flow only while running; parked (hidden) when stopped.
      const runningNow = runningRef.current;
      if (runningNow) {
        particleOffset = (particleOffset + dt * 0.055) % 1;
        const tmpV = new THREE.Vector3();
        particles.forEach((p, i) => {
          const u = (i / PARTICLE_COUNT + particleOffset) % 1;
          loopCurve.getPointAt(u, tmpV);
          p.position.copy(tmpV);
          p.visible = true;
        });
      } else {
        for (const p of particles) p.visible = false;
      }
      // Recording-PC screen waveform, ~7 Hz — skipped while throttled.
      if (!throttled && now - lastWaveDraw >= 150) {
        lastWaveDraw = now;
        const wd = getWaveDataRef.current();
        if (wd && wd.length > 0) {
          drawMultiChannelWaveform(screenCanvas, wd);
          screenTex.needsUpdate = true;
        }
        if (trialCountRef.current !== lastTrialCount) {
          lastTrialCount = trialCountRef.current;
          drawStimScreen();
        }
      }
      if (colorActiveRef.current) {
        const targets = targetColorsRef.current;
        if (targets) {
          let changed = false;
          for (let i = 0; i < colors.length; i++) {
            const dd = targets[i] - colors[i];
            if (Math.abs(dd) > 0.0005) { colors[i] += dd * 0.35; changed = true; }
            else if (dd !== 0) { colors[i] = targets[i]; changed = true; }
          }
          if (changed) colorAttr.needsUpdate = true;
          else colorActiveRef.current = false;
        }
      }
      renderer.render(scene, camera);
    };
    tick();

    const sceneApi = {
      renderer, scene, camera, controls, mesh, geometry, colors, colorAttr,
      headGroup, discGroup, recGroup, raycaster, loopCurve, fitCamera,
    };

    (window as unknown as { __minimalLoop?: unknown }).__minimalLoop = {
      getDiscCount: () => discGroup.children.filter((c) =>
        c instanceof THREE.Mesh && (c as THREE.Mesh).userData.isDisc).length,
      getCameraPosition: () => [camera.position.x, camera.position.y, camera.position.z],
      getParticleCount: () => particles.filter((p) => p.visible).length,
      getTrialCount: () => trialCountRef.current,
      projectNode: (id: string) => {
        const pos = id === 'brain' ? HEAD_POS : id === 'recording' ? REC_POS
          : id === 'amplifier' ? AMP_POS : id === 'stimulus-pc' ? STIM_PC_POS
          : id === 'stimulator' ? STIMULATOR_POS : null;
        if (!pos) return null;
        const v = pos.clone().project(camera);
        if (v.z > 1) return null;
        const w = renderer.domElement.clientWidth;
        const h = renderer.domElement.clientHeight;
        return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
      },
      projectDisc: (label: string) => {
        const disc = discGroup.children.find((c) =>
          c instanceof THREE.Mesh && (c as THREE.Mesh).userData.isDisc
          && (c as THREE.Mesh).userData.electrodeLabel === label);
        if (!disc) return null;
        const v = new THREE.Vector3();
        (disc as THREE.Mesh).getWorldPosition(v);
        v.project(camera);
        if (v.z > 1) return null;
        const w = renderer.domElement.clientWidth;
        const h = renderer.domElement.clientHeight;
        return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
      },
    };
    void sceneApi;

    return () => {
      cancelAnimationFrame(raf);
      rebuildDiscsRef.current = null;
      delete (window as unknown as { __minimalLoop?: unknown }).__minimalLoop;
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      controls.dispose();
      geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      (wire.material as THREE.Material).dispose();
      headGeo.dispose();
      (headShell.material as THREE.Material).dispose();
      capGeo.dispose();
      (capShell.material as THREE.Material).dispose();
      screenTex.dispose();
      stimScreenTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
    // data only arrives once; later state flows through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild discs when the fixture/selection or the selected channel
  // changes (the amber ring follows the selected channel). The scene
  // effect owns the disc groups and publishes its rebuild function here.
  const rebuildDiscsRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    rebuildDiscsRef.current?.();
  }, [benchElectrodes, selectedChannel]);

  return (
    <div className="minimal-scene" data-testid="minimal-scene">
      <div className="minimal-scene-canvas" ref={containerRef} />
    </div>
  );
}
