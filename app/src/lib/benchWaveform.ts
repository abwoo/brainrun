/**
 * Shared waveform drawing for the bench (pictorial bench).
 *
 * One draw function for both the test-computer drill-down's full canvas
 * (ClosedLoopBench) and the recording-PC screen thumbnail in the picture
 * (PictorialLoop): dark background, grid lines, the series as a light-blue
 * trace auto-scaled to its peak, peak label. Display only — never the
 * recorded µV (gain/band-pass are applied by the caller before passing
 * the series in).
 */
export function drawWaveform(
  canvas: HTMLCanvasElement,
  series: readonly number[],
  opts?: { peakLabel?: boolean; stroke?: string },
): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 160;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#070e16';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1c3041';
  ctx.lineWidth = 1;
  for (let gy = 1; gy < 4; gy++) {
    ctx.beginPath();
    ctx.moveTo(0, (h * gy) / 4);
    ctx.lineTo(w, (h * gy) / 4);
    ctx.stroke();
  }
  if (series.length === 0) return;
  const peak = Math.max(1, ...series.map((v) => Math.abs(v)));
  ctx.strokeStyle = opts?.stroke ?? '#8bd3ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  series.forEach((v, j) => {
    const x = (j / Math.max(1, series.length - 1)) * w;
    const y = h / 2 - (v / peak) * (h / 2 - 8);
    if (j === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  if (opts?.peakLabel !== false) {
    ctx.fillStyle = '#9db5c8';
    ctx.font = '11px monospace';
    ctx.fillText(`±${peak.toFixed(1)} µV`, 6, 14);
  }
}

/**
 * Multi-channel waveform (minimal 3D loop): 6–8 channels stacked in one
 * canvas, each in its own lane with its label on the left. Same dark
 * background / light-blue trace as drawWaveform; each lane is auto-scaled
 * to its own peak (display only, never the recorded µV).
 *
 * Works for both a displayed canvas (clientWidth > 0: sized to the
 * element, like drawWaveform) and an offscreen canvas used as a
 * CanvasTexture (clientWidth is 0: uses the canvas's own width/height).
 */
export interface MultiChannelSeries {
  label: string;
  series: readonly number[];
}

export function drawMultiChannelWaveform(
  canvas: HTMLCanvasElement,
  channels: readonly MultiChannelSeries[],
  opts?: { stroke?: string; labelColor?: string },
): void {
  const displayed = canvas.clientWidth > 0 && canvas.clientHeight > 0;
  const dpr = displayed ? (window.devicePixelRatio || 1) : 1;
  const w = displayed ? canvas.clientWidth : (canvas.width || 600);
  const h = displayed ? canvas.clientHeight : (canvas.height || 320);
  if (displayed) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#070e16';
  ctx.fillRect(0, 0, w, h);
  if (channels.length === 0) return;
  const laneH = h / channels.length;
  const labelW = 44;
  channels.forEach((ch, i) => {
    const y0 = i * laneH;
    const midY = y0 + laneH / 2;
    ctx.strokeStyle = '#1c3041';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y0 + laneH);
    ctx.lineTo(w, y0 + laneH);
    ctx.stroke();
    ctx.fillStyle = opts?.labelColor ?? '#9db5c8';
    ctx.font = '11px monospace';
    ctx.fillText(ch.label, 4, midY + 4);
    if (ch.series.length === 0) return;
    const peak = Math.max(1e-6, ...ch.series.map((v) => Math.abs(v)));
    ctx.strokeStyle = opts?.stroke ?? '#8bd3ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ch.series.forEach((v, j) => {
      const x = labelW + (j / Math.max(1, ch.series.length - 1)) * (w - labelW - 6);
      const y = midY - (v / peak) * (laneH / 2 - 4);
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}
