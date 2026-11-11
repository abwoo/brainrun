"""PR-07 — 多导 EEG 生成的 Python 对照实现（B1）。

与 ``app/src/lib/eegRecording.ts`` 逐函数对应：同一输入、同一约定
（见 TS 文件头注释）。TS 测试用本模块生成的 fixture
（``tests/pr6/fixtures/eeg-recording-reference.json``）做数值对照。

量纲：时间 ms、频率 Hz、电位 µV、偶极矩 nA·m、噪声 RMS µV。
采样率只支持 250 Hz（柱模型步长与 4 ms 网格对齐的要求）。

对照分工：
- RNG / 噪声 / 参考变换 / 三线性插值投影：与 TS 同公式实现，
  同种子同参数下逐值对照（容差 1e-9 相对；mulberry32 与 Box-Muller
  在 IEEE-754 双精度下逐位相同，见测试硬编码的前 5 个均匀数）。
- 柱模型 q(t)：TS 用 RK4（WC dt=1 ms、JR dt=0.5 ms），本模块用
  SciPy DOP853 分段积分（事件边界处分段，恒定驱动），两者是独立
  的积分器；对照容差为 1e-6 nA·m（绝对）+ 1e-6（相对）——PR5 已
  证实该量级的 RK4/DOP853 差异（JR q 误差 < 3e-8 nA·m），容差
  不是为通过而放宽，仍比任何物理效应（µV 级）小 6 个量级以上。
  柱模型本身的独立验证见 PR5（WC 与 JR 各自的 DOP853 对照）。

噪声/伪迹（白、粉红、工频、漂移）各自由独立逻辑生成、独立标注，
绝不是神经源活动；``generate_noise`` 返回的成分与总和只含噪声。
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import fsolve, root

from scientific.forward import jansen_rit_reference as _jr
from scientific.forward import local_column_scipy_reference as _wc

SFREQ_HZ = 250.0
DEFAULT_DURATION_MS = 10000
DEFAULT_EVENT_INTERVAL_MS = 1000
DEFAULT_DRIVE_DURATION_MS = 100
DEFAULT_WC_DRIVE = 1.0
DEFAULT_JR_DRIVE_PER_S = 120.0
DEFAULT_JR_BASELINE_PER_S = 90.0
DEFAULT_SEED = 1
DEFAULT_SOURCE_POSITION_MM = (0.0, 0.0, 16.0)
DEFAULT_SOURCE_NORMAL = (0.0, 0.0, 1.0)
DEFAULT_SECOND_SOURCE_POSITION_MM = (16.0, -16.0, 16.0)
DEFAULT_SECOND_SOURCE_NORMAL = (0.0, 0.0, 1.0)
DEFAULT_NOISE = {
    "whiteRmsUv": 2.0,
    "pinkRmsUv": 1.0,
    "line50HzRmsUv": 0.5,
    "driftRmsUv": 0.5,
}
NOISE_LABELS = {
    "white": "白噪声（伪迹，非神经源）",
    "pink": "1/f 粉红噪声（伪迹，非神经源）",
    "line50": "50 Hz 工频干扰（伪迹，非神经源）",
    "drift": "慢漂移（伪迹，非神经源）",
}
# 成分顺序固定（白 → 粉红 → 工频 → 漂移），与 TS 相同。
_NOISE_ORDER = ("white", "pink", "line50", "drift")


# ── 确定性 RNG ───────────────────────────────────────────────────────

def mulberry32(seed: int):
    """mulberry32：与 TS ``mulberry32`` 逐位同构的 32 位整数 RNG。

    全部运算按 32 位无符号取模；``>>>`` 逻辑右移对应无符号 ``>>``，
    ``Math.imul`` 对应 32 位取模乘法。输出 [0, 1) 的均匀数。
    """
    a = seed & 0xFFFFFFFF

    def nxt() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((a ^ (a >> 15)) * (1 | a)) & 0xFFFFFFFF
        t = ((t + (((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF)) ^ t) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return nxt


def gaussian(rng) -> float:
    """标准正态高斯（Box–Muller，无缓存）：每次调用恰好消耗 2 个均匀数。

    与 TS ``gaussian`` 同款守卫：u1 下限 1e-12 防 log(0)。
    """
    u1 = max(rng(), 1e-12)
    u2 = rng()
    return math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)


# ── 噪声 ─────────────────────────────────────────────────────────────

def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.asarray(x, dtype=float) ** 2)))


def _normalize_to_rms(trace: np.ndarray, target: float) -> np.ndarray:
    trace = np.asarray(trace, dtype=float)
    if target == 0.0:
        return np.zeros_like(trace)
    actual = _rms(trace)
    if actual == 0.0:
        raise ValueError("zero trace cannot be scaled to nonzero RMS")
    return trace * (target / actual)


def generate_noise(params, n_channels: int, n_samples: int,
                   sfreq_hz: float, seed: int) -> dict:
    """噪声生成（µV），与 TS ``generateNoise`` 同公式、同顺序、同归一化。

    返回 ``{"components": {kind: {"label", "data"}}, "total": array}``，
    data/total 均为 shape (n_channels, n_samples) 的 µV 数组。
    每成分每通道归一化到目标 RMS；总 RMS ≈ sqrt(Σ RMS²)。
    """
    for k, v in params.items():
        if not math.isfinite(v) or v < 0:
            raise ValueError(f"{k} must be a finite non-negative RMS (µV), got {v}")
    if n_channels < 1 or n_samples < 1 or sfreq_hz <= 0:
        raise ValueError("bad shape/sfreq")
    rng = mulberry32(seed)
    comps: dict[str, np.ndarray] = {}
    total = np.zeros((n_channels, n_samples))

    white = float(params.get("whiteRmsUv", 0.0))
    if white > 0:
        data = np.array([[gaussian(rng) for _ in range(n_samples)]
                         for _ in range(n_channels)])
        data = np.array([_normalize_to_rms(row, white) for row in data])
    else:
        data = np.zeros((n_channels, n_samples))
    comps["white"] = data
    total += data

    pink = float(params.get("pinkRmsUv", 0.0))
    if pink > 0:
        rows_out = []
        for _ in range(n_channels):
            rows = [0.0] * 16
            raw = np.empty(n_samples)
            counter = 0
            for j in range(n_samples):
                counter += 1
                k = 0
                while ((counter >> k) & 1) == 0:
                    k += 1
                rows[k] = gaussian(rng)
                raw[j] = sum(rows)
            rows_out.append(_normalize_to_rms(raw, pink))
        data = np.array(rows_out)
    else:
        data = np.zeros((n_channels, n_samples))
    comps["pink"] = data
    total += data

    line = float(params.get("line50HzRmsUv", 0.0))
    if line > 0:
        t = np.arange(n_samples) / sfreq_hz
        rows_out = []
        for _ in range(n_channels):
            phase = rng() * 2.0 * math.pi
            raw = math.sqrt(2.0) * line * np.sin(2.0 * math.pi * 50.0 * t + phase)
            rows_out.append(_normalize_to_rms(raw, line))
        data = np.array(rows_out)
    else:
        data = np.zeros((n_channels, n_samples))
    comps["line50"] = data
    total += data

    drift = float(params.get("driftRmsUv", 0.0))
    if drift > 0:
        freqs = (0.1, 0.23, 0.41)
        t = np.arange(n_samples) / sfreq_hz
        rows_out = []
        for _ in range(n_channels):
            phases = [rng() * 2.0 * math.pi for _ in freqs]
            raw = sum(np.sin(2.0 * math.pi * f * t + p)
                      for f, p in zip(freqs, phases))
            rows_out.append(_normalize_to_rms(np.asarray(raw), drift))
        data = np.array(rows_out)
    else:
        data = np.zeros((n_channels, n_samples))
    comps["drift"] = data
    total += data

    return {
        "components": {k: {"label": NOISE_LABELS[k], "data": comps[k]}
                       for k in _NOISE_ORDER},
        "total": total,
    }


# ── 参考变换 ─────────────────────────────────────────────────────────

def apply_reference(data_uv, reference) -> np.ndarray:
    """参考变换（线性；返回新数组）。

    reference 为 ("average", None) / ("infinity", None) /
    ("electrode", label)。electrode 减指定通道（该通道变全零）。
    """
    data = np.asarray(data_uv, dtype=float)
    if data.ndim != 2 or data.shape[0] == 0:
        raise ValueError("apply_reference: need a non-empty 2D array")
    if not np.all(np.isfinite(data)):
        raise ValueError("apply_reference: non-finite value")
    mode = reference[0]
    if mode == "infinity":
        return data.copy()
    if mode == "average":
        return data - data.mean(axis=0, keepdims=True)
    if mode == "electrode":
        labels = reference[2]
        idx = list(labels).index(reference[1]) if reference[1] in labels else -1
        if idx < 0:
            raise ValueError(f"reference electrode {reference[1]} not in montage")
        return data - data[idx : idx + 1, :]
    raise ValueError(f"unknown reference mode {mode}")


# ── 导联与正向投影 ───────────────────────────────────────────────────

def channels_for_montage(fixture: dict, montage: str) -> list[dict]:
    labels = fixture["montages"][montage]
    by_label = {s["label"]: s for s in fixture["sensors"]}
    return [{"label": lab, "positionMm": list(by_label[lab]["position_mm"])}
            for lab in labels]


def interpolate_gain(fixture: dict, position_mm) -> np.ndarray:
    """三线性插值增益：与 TS ``interpolateSphereGain`` 同公式。

    返回 shape (n_sensors, 3) 的增益，µV/(nA·m)。
    """
    axis = np.asarray(fixture["source_grid_axis_mm"], dtype=float)
    n = len(axis)
    gains = np.asarray(fixture["gain_uv_per_nAm"], dtype=float)

    def index_weight(x: float):
        if not math.isfinite(x) or x < axis[0] or x > axis[-1]:
            raise ValueError("source position outside the validated lead-field grid")
        for i in range(n - 1):
            if x <= axis[i + 1]:
                return i, (x - axis[i]) / (axis[i + 1] - axis[i])
        return n - 2, 1.0

    ix, wx = index_weight(position_mm[0])
    iy, wy = index_weight(position_mm[1])
    iz, wz = index_weight(position_mm[2])
    out = np.zeros((len(fixture["sensors"]), 3))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                grid_idx = ((ix + dx) * n + (iy + dy)) * n + (iz + dz)
                w = (wx if dx else 1 - wx) * (wy if dy else 1 - wy) * (wz if dz else 1 - wz)
                out += w * gains[:, grid_idx * 3 : grid_idx * 3 + 3]
    return out


def project_moments(fixture: dict, position_mm, normal, moments_nAm,
                    montage: str) -> np.ndarray:
    """单源偶极矩序列 → 多导无限远参考电压（µV），shape (n_ch, n_t)。

    每通道系数 c = gain · normal，V[t] = c · q[t]（纯线性）。
    """
    normal = np.asarray(normal, dtype=float)
    if normal.shape != (3,) or abs(np.linalg.norm(normal) - 1.0) > 1e-3:
        raise ValueError("normal must be a finite unit 3-vector")
    q = np.asarray(moments_nAm, dtype=float)
    if not np.all(np.isfinite(q)):
        raise ValueError("non-finite moment")
    gains = interpolate_gain(fixture, position_mm)
    by_label = {s["label"]: i for i, s in enumerate(fixture["sensors"])}
    coeff = np.array([gains[by_label[lab]] @ normal
                      for lab in fixture["montages"][montage]])
    return coeff[:, None] * q[None, :]


# ── 柱模型 q(t)（SciPy DOP853，分段积分） ───────────────────────────

def _event_windows(duration_ms, event_interval_ms, drive_duration_ms):
    """事件表：首个在 event_interval_ms，每 interval 一次；末个驱动窗
    须在记录内（留 500 ms 尾）。与 TS ``runExperiment`` 同规则。"""
    events = []
    t = event_interval_ms
    while t + drive_duration_ms <= duration_ms - 500:
        events.append(t)
        t += event_interval_ms
    if not events:
        raise ValueError("duration too short for one event")
    return events


def _integrate_segments(rates, y0, duration_ms, boundaries, grid_ms):
    """按边界分段 DOP853 积分；在 4 ms 网格上采样（含 t=0）。

    rates(t, y, stim) 为分段恒定驱动的导数；boundaries 为
    [(t_start, t_stop, stim)] 的有序分段表（覆盖 [0, duration]）。
    """
    grid = np.asarray(grid_ms, dtype=float)
    out = np.empty((len(grid), len(y0)))
    out[0] = y0
    state = np.asarray(y0, dtype=float)
    for start, stop, stim in boundaries:
        mask = (grid > start) & (grid <= stop)
        teval = grid[mask]
        if len(teval):
            res = solve_ivp(lambda t, y: rates(t, y, stim), (start, stop), state,
                            method="DOP853", rtol=1e-10, atol=1e-12,
                            t_eval=teval)
            if not res.success:
                raise RuntimeError(res.message)
            out[mask] = res.y.T
            state = res.y[:, -1]
        else:
            res = solve_ivp(lambda t, y: rates(t, y, stim), (start, stop), state,
                            method="DOP853", rtol=1e-10, atol=1e-12)
            if not res.success:
                raise RuntimeError(res.message)
            state = res.y[:, -1]
    return out


def _wc_moments(duration_ms, event_times, drive_duration_ms, wc_drive):
    baseline = root(lambda s: _wc.rates(0, s, 0), [0.1, 0.1], tol=1e-12).x
    assert np.max(np.abs(_wc.rates(0, baseline, 0))) < 1e-11
    bounds = sorted({0.0, float(duration_ms)}
                    | {float(t) for t in event_times}
                    | {float(t) + drive_duration_ms for t in event_times})
    boundaries = []
    for a, b in zip(bounds[:-1], bounds[1:]):
        stim = wc_drive if any(t <= a < t + drive_duration_ms for t in event_times) else 0.0
        boundaries.append((a, b, stim))
    grid = np.arange(0, duration_ms + 1, 4, dtype=float)
    traj = _integrate_segments(_wc.rates, baseline, duration_ms, boundaries, grid)
    q = np.array([_wc.dipole_nam(e, i, baseline[0], baseline[1])
                  for e, i in traj])
    return grid, q


def _jr_moments(duration_ms, event_times, drive_duration_ms, jr_drive_per_s,
                jr_baseline_per_s):
    base3 = _jr.algebraic_fixed_point(jr_baseline_per_s, [0.01, 1.0, 0.5])
    baseline = np.array([base3[0], base3[1], base3[2], 0.0, 0.0, 0.0])
    assert np.max(np.abs(_jr.rates_ms(0.0, baseline, jr_baseline_per_s))) < 1e-11

    def rates(t, y, added):
        return _jr.rates_ms(t, y, jr_baseline_per_s + added)

    bounds = sorted({0.0, float(duration_ms)}
                    | {float(t) for t in event_times}
                    | {float(t) + drive_duration_ms for t in event_times})
    boundaries = []
    for a, b in zip(bounds[:-1], bounds[1:]):
        added = jr_drive_per_s if any(t <= a < t + drive_duration_ms
                                      for t in event_times) else 0.0
        boundaries.append((a, b, added))
    grid = np.arange(0, duration_ms + 1, 4, dtype=float)
    traj = _integrate_segments(rates, baseline, duration_ms, boundaries, grid)
    q = np.array([_jr.dipole_nam(y0, baseline[0]) for y0 in traj[:, 0]])
    return grid, q


def run_experiment(fixture, duration_ms=DEFAULT_DURATION_MS, montage="10-20",
                   reference=("average", None), source_model="wc",
                   noise=None, seed=DEFAULT_SEED,
                   event_interval_ms=DEFAULT_EVENT_INTERVAL_MS,
                   drive_duration_ms=DEFAULT_DRIVE_DURATION_MS,
                   wc_drive=DEFAULT_WC_DRIVE, jr_drive_per_s=DEFAULT_JR_DRIVE_PER_S,
                   jr_baseline_per_s=DEFAULT_JR_BASELINE_PER_S,
                   source_position_mm=DEFAULT_SOURCE_POSITION_MM,
                   source_normal=DEFAULT_SOURCE_NORMAL,
                   second_source_position_mm=DEFAULT_SECOND_SOURCE_POSITION_MM,
                   second_source_normal=DEFAULT_SECOND_SOURCE_NORMAL) -> dict:
    """运行一次多导 EEG 实验（Python 对照；DOP853 柱模型 + 同款 EEG 层）。

    reference 为 ("average", None) / ("infinity", None) /
    ("electrode", label, labels)。返回 times_ms、channels、data_uv
    （已参考）、raw_uv（无限远参考）、events、q 序列等。
    """
    if duration_ms <= 0 or duration_ms % 4 != 0:
        raise ValueError("duration_ms must be a positive multiple of 4")
    event_times = _event_windows(duration_ms, event_interval_ms, drive_duration_ms)
    events = [{"id": i, "type": "pulse", "tMs": float(t),
               "condition": "standard" if i % 2 == 0 else "oddball",
               "drive": jr_drive_per_s if source_model == "jr" else wc_drive,
               "driveUnit": "jr" if source_model == "jr" else "wc"}
              for i, t in enumerate(event_times)]
    channels = channels_for_montage(fixture, montage)
    labels = [c["label"] for c in channels]
    raw = np.zeros((len(channels), duration_ms // 4 + 1))
    q_series: dict[str, np.ndarray] = {}
    if source_model in ("wc", "both"):
        grid, q = _wc_moments(duration_ms, event_times, drive_duration_ms, wc_drive)
        q_series["wc"] = q
        raw += project_moments(fixture, source_position_mm, source_normal, q, montage)
    if source_model in ("jr", "both"):
        grid, q = _jr_moments(duration_ms, event_times, drive_duration_ms,
                              jr_drive_per_s, jr_baseline_per_s)
        q_series["jr"] = q
        pos = second_source_position_mm if source_model == "both" else source_position_mm
        nrm = second_source_normal if source_model == "both" else source_normal
        raw += project_moments(fixture, pos, nrm, q, montage)
    if noise:
        gen = generate_noise(noise, len(channels), raw.shape[1], SFREQ_HZ, seed)
        raw = raw + gen["total"]
    ref = (reference[0], reference[1], labels) if reference[0] == "electrode" \
        else (reference[0], None)
    data = apply_reference(raw, ref)
    return {
        "times_ms": np.arange(0, duration_ms + 1, 4, dtype=float).tolist(),
        "channels": labels,
        "data_uv": data,
        "raw_uv": raw,
        "events": events,
        "q_series": {k: v.tolist() for k, v in q_series.items()},
        "reference": {"mode": reference[0],
                      **({"label": reference[1]} if reference[0] == "electrode" else {})},
        "montage": montage,
        "seed": seed,
        "noise": noise,
    }


# ── Fixture 生成（供 TS 测试读） ──────────────────────────────────────

LABELS_10_20 = ("Fp1 Fp2 F7 F3 Fz F4 F8 T7 C3 Cz C4 T8 "
                "P7 P3 Pz P4 P8 O1 O2").split()
LABELS_EXTRA = ["FC1", "FC2", "CP1", "CP2", "POz", "Oz"]


def make_synthetic_fixture(seed: int = 42) -> dict:
    """确定性合成小 fixture（满足 TS ``validateSphereFixture``）：

    25 个传感器在 95 mm 球面上；源网格轴 [-48, 48] mm；增益为
    seed=42 的标准正态随机数（µV/(nA·m)）。只用于方法学对照，
    不是真实头模型。
    """
    rng = np.random.default_rng(seed)
    labels = LABELS_10_20 + LABELS_EXTRA
    sensors = []
    for lab in labels:
        u = rng.uniform(-1.0, 1.0)
        th = rng.uniform(0.0, 2.0 * math.pi)
        r = math.sqrt(1.0 - u * u)
        sensors.append({
            "label": lab,
            "position_mm": [95.0 * r * math.cos(th), 95.0 * r * math.sin(th), 95.0 * u],
            "original_head_mm": [0.0, 0.0, 95.0],
        })
    return {
        "model_id": "mne-four-layer-sphere-ras-v1",
        "coordinate_frame": "head-RAS-sphere-centered",
        "mne_version": "1.11.0",
        "radius_mm": 95.0,
        "brain_inner_radius_mm": 85.5,
        "source_grid_axis_mm": [-48.0, 48.0],
        "conductivities_S_m": [0.33, 1.0, 0.004, 0.33],
        "montages": {"10-20": LABELS_10_20, "10-10": labels, "10-05": labels},
        "sensors": sensors,
        "gain_uv_per_nAm": rng.standard_normal((len(labels), 24)).tolist(),
    }


def generate_fixture() -> dict:
    """生成 TS 测试用的对照 fixture（确定性；重跑即同一文件）。"""
    fixture = make_synthetic_fixture()
    n_ch = len(LABELS_10_20)
    n_t = 2000 // 4 + 1  # 2 s @ 250 Hz
    times = np.arange(0, 2000 + 1, 4, dtype=float)
    t_s = times / 1000.0
    # 解析 q(t)：8 Hz + 23 Hz 正弦（nA·m），只测 EEG 层，不含柱模型。
    q_analytic = 1.5 * np.sin(2 * np.pi * 8.0 * t_s) + 0.8 * np.sin(2 * np.pi * 23.0 * t_s)
    v_inf = project_moments(fixture, DEFAULT_SOURCE_POSITION_MM,
                            DEFAULT_SOURCE_NORMAL, q_analytic, "10-20")
    labels = LABELS_10_20
    v_avg = apply_reference(v_inf, ("average", None))
    v_el = apply_reference(v_inf, ("electrode", "Cz", labels))
    noise_params = dict(DEFAULT_NOISE)
    gen = generate_noise(noise_params, n_ch, n_t, SFREQ_HZ, 7)
    # 2 s WC 全跑（DOP853）：事件在 1000 ms、驱动 1.0、噪声 seed 7。
    run_wc = run_experiment(fixture, duration_ms=2000, montage="10-20",
                            reference=("average", None), source_model="wc",
                            noise=noise_params, seed=7)
    # 2 s JR 全跑（DOP853）：只取 q 序列供 TS 的 simulateSourceMoments 对照。
    _, q_jr = _jr_moments(2000, [1000], DEFAULT_DRIVE_DURATION_MS,
                          DEFAULT_JR_DRIVE_PER_S, DEFAULT_JR_BASELINE_PER_S)
    return {
        "generated_by": "scientific/eeg/eeg_reference.py generate_fixture (MNE not required)",
        "synthetic_fixture": fixture,
        "times_ms": times.tolist(),
        "analytic_q_nAm": q_analytic.tolist(),
        "expected_infinity_uv": v_inf.tolist(),
        "expected_average_uv": v_avg.tolist(),
        "expected_electrode_cz_uv": v_el.tolist(),
        "noise": {
            "params": noise_params,
            "seed": 7,
            "components": {k: v["data"].tolist()
                           for k, v in gen["components"].items()},
            "total": gen["total"].tolist(),
        },
        "run_wc": {
            "duration_ms": 2000,
            "event_interval_ms": 1000,
            "drive_duration_ms": 100,
            "wc_drive": 1.0,
            "noise": noise_params,
            "seed": 7,
            "q_nAm": run_wc["q_series"]["wc"],
            "expected_average_uv": run_wc["data_uv"].tolist(),
            "events": run_wc["events"],
        },
        "run_jr_q_nAm": q_jr.tolist(),
    }


def main() -> None:
    out = Path(__file__).resolve().parents[2] / "tests" / "pr6" / "fixtures" / \
        "eeg-recording-reference.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(generate_fixture(), ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
