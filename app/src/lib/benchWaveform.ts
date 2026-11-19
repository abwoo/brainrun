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
