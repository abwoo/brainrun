"""PR6 — 时频/地形/源定位的 Python 对照实现（B3：PR-10/11/12）。

与 ``app/src/lib/topography.ts``（PR-11）与
``app/src/lib/sourceLocalization.ts``（PR-12）逐函数对应；PR-10
的时频对照复用 A1 的 ``scientific/eeg/signal_reference.py``
（``ersp_itc``），本模块只补 A1 的残留项：multitaper 分支 ERSP
的小规模 fixture（见 ``build_multitaper_ersp_small_fixture``）。

量纲：位置 mm、电位 µV、偶极矩 nA·m、时间 ms、频率 Hz；
ERSP dB、ITC 无量纲 0–1；λ² 无量纲、噪声 σ µV。

── PR-11 球面样条（Perrin et al. 1989, 1990）────────────────────
与 TS 的 ``sphericalSplineTopography`` 同公式：核
G(x) = (1/4π)·Σ_{n=1}^{7} (2n+1)/(n⁴·(n+1)⁴)·P_n(x)，解
[G+λI, 1; 1ᵀ, 0]·[C; c0] = [V; 0]（λ = 1e-5），约束 ΣC = 0。
2D 网格为头顶俯视图单位圆坐标（x = X/R，y = Y/R）。

── PR-12 逆解 ────────────────────────────────────────────────────
Lead-field 取自球形 fixture（``app/public/forward-assets/
sphere-model.json``，CI/本地生成，不入库；本地生成命令见
``tests/pr6/test_tfr_topo_inverse.py`` 文件头）。
- 偶极子拟合：64 网格点逐个最小二乘（``numpy.linalg.lstsq``），
  取残差 RMS 最小者（TS 用 3×3 法方程 + 相对脊 1e-12，结果在
  1e-9 相对量级一致）。
- MNE 逆解：s = Lᵀ(LLᵀ + λ²σ²I)⁻¹V，R = I（无深度加权），
  C = σ²I；λ² 默认 1/9（MNE 默认 SNR = 3），σ 默认 1.0 µV。
  与 TS 同公式，逐点对照到舍入量级。
- 另有 ``mne_operator_estimate``：走 MNE 真实管线
  ``make_inverse_operator``（loose=0.0、depth=None）+
  ``apply_inverse``（method='MNE'），只作峰值交叉验证——
  MNE 内部有自己的 SVD/白化管线，估计向量与 numpy 公式不逐点
  相等（实测相关 0.990–0.995、峰值网格点三例全同），故只断言
  峰值网格点相同 + 相关 > 0.98，不逐点比。

参考变换：lead-field 列与数据用同一参考（默认 average）；
average 参考对 lead-field 列做“减该列在所选导联上的均值”，
与 TS 的 ``buildLeadField`` / ``sphereElectrodePotentials`` 同口径。
MNE 管线里 average 参考用投影实现（``set_eeg_reference``，
projection=True），数学上等价（减均值）。

盲测：真值只用来合成数据与事后算误差，逆解函数签名里没有真值参数。
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

# 与 TS 的 topography.ts / sourceLocalization.ts 字面值相同。
SPLINE_ORDER_M = 4
SPLINE_N_MAX = 7
SPLINE_LAMBDA_DEFAULT = 1e-5
MNE_LAMBDA2_DEFAULT = 1.0 / 9.0
MNE_NOISE_RMS_UV_DEFAULT = 1.0
GRID_AXIS_MM = [-48.0, -16.0, 16.0, 48.0]


def _as_float_array(x) -> np.ndarray:
    a = np.asarray(x, dtype=float)
    if not np.all(np.isfinite(a)):
        raise ValueError("input contains non-finite values")
    return a


# ── PR-11 球面样条 ───────────────────────────────────────────────────

def spline_kernel_g(cos_angle: float, m: int = SPLINE_ORDER_M, n_max: int = SPLINE_N_MAX) -> float:
    """Perrin 核 G(x)，x = cos(夹角)。Legendre 递推与 TS 同式。"""
    if not (-1.0 <= cos_angle <= 1.0):
        raise ValueError(f"cos_angle must be in [-1, 1], got {cos_angle}")
    p_prev = 1.0  # P_0
    p_curr = float(cos_angle)  # P_1；循环开头恒有 p_curr = P_n
    total = 0.0
    for n in range(1, n_max + 1):
        total += ((2 * n + 1) / (n ** m * (n + 1) ** m)) * p_curr
        p_next = ((2 * n + 1) * cos_angle * p_curr - n * p_prev) / (n + 1)
        p_prev, p_curr = p_curr, p_next
    return total / (4 * math.pi)


def _unit_vectors(positions_mm) -> np.ndarray:
    p = _as_float_array(positions_mm)
    if p.ndim != 2 or p.shape[1] != 3:
        raise ValueError("positions must be (n, 3)")
    norms = np.linalg.norm(p, axis=1)
    if np.any(norms <= 0):
        raise ValueError("electrode positions must be non-zero vectors")
    return p / norms[:, None]


def spherical_spline_coefficients(positions_mm, values_uv,
                                   m: int = SPLINE_ORDER_M, n_max: int = SPLINE_N_MAX,
                                   lambda_: float = SPLINE_LAMBDA_DEFAULT):
    """解 [G+λI, 1; 1ᵀ, 0]·[C; c0] = [V; 0]。返回 (weights, c0)。"""
    u = _unit_vectors(positions_mm)
    v = _as_float_array(values_uv)
    if len(u) != len(v):
        raise ValueError(f"{len(u)} electrodes vs {len(v)} values")
    if len(u) < 4:
        raise ValueError(f"need at least 4 electrodes, got {len(u)}")
    n = len(u)
    cos = np.clip(u @ u.T, -1.0, 1.0)
    g = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            g[i, j] = spline_kernel_g(float(cos[i, j]), m, n_max)
    a = np.zeros((n + 1, n + 1))
    a[:n, :n] = g + lambda_ * np.eye(n)
    a[:n, n] = 1.0
    a[n, :n] = 1.0
    b = np.concatenate([v, [0.0]])
    sol = np.linalg.solve(a, b)
    return sol[:n], float(sol[n])


def spherical_spline_topography(positions_mm, values_uv, grid_resolution: int = 25,
                                m: int = SPLINE_ORDER_M, n_max: int = SPLINE_N_MAX,
                                lambda_: float = SPLINE_LAMBDA_DEFAULT):
    """2D 球面样条插值场。返回 dict(grid=[{x, y, value_uv}])，x/y 为单位圆坐标。

    网格行从上（前，+Y）往下排，与 TS 的 ``sphericalSplineTopography`` 同序。
    """
    weights, c0 = spherical_spline_coefficients(positions_mm, values_uv, m, n_max, lambda_)
    u = _unit_vectors(positions_mm)
    if not isinstance(grid_resolution, int) or grid_resolution < 5:
        raise ValueError(f"grid_resolution must be an integer >= 5, got {grid_resolution}")
    grid = []
    for iy in range(grid_resolution):
        for ix in range(grid_resolution):
            x = 2 * ix / (grid_resolution - 1) - 1
            y = 1 - 2 * iy / (grid_resolution - 1)
            r2 = x * x + y * y
            if r2 > 1:
                continue
            z = math.sqrt(max(0.0, 1 - r2))
            direction = np.array([x, y, z])
            cos = np.clip(u @ direction, -1.0, 1.0)
            vals = np.array([spline_kernel_g(float(c), m, n_max) for c in cos])
            grid.append({"x": float(x), "y": float(y),
                         "value_uv": float(c0 + weights @ vals)})
    return {"grid": grid, "grid_resolution": grid_resolution,
            "weights": weights, "c0": c0}


def evaluate_spline_at_electrodes(positions_mm, values_uv, **kwargs):
    """在电极点上复核插值：λ 很小时应近乎精确重现实测值。"""
    weights, c0 = spherical_spline_coefficients(positions_mm, values_uv, **kwargs)
    u = _unit_vectors(positions_mm)
    cos = np.clip(u @ u.T, -1.0, 1.0)
    g = np.array([[spline_kernel_g(float(cos[i, j])) for j in range(len(u))]
                  for i in range(len(u))])
    return c0 + g @ weights


# ── PR-12 lead-field / 正向 / 逆解 ─────────────────────────────────────

def load_sphere_fixture(path) -> dict:
    """读球形 fixture JSON（CI/本地生成，不入库）。"""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def source_grid_positions_mm(axis_mm=GRID_AXIS_MM) -> np.ndarray:
    """64 点源网格位置，mm；顺序 x 外层→z 内层，与 fixture 增益列一致。"""
    return np.array([(x, y, z) for x in axis_mm for y in axis_mm for z in axis_mm], dtype=float)


def lead_field_matrix(fixture: dict, montage: str, reference: str = "average",
                      reference_label: str | None = None):
    """Lead-field L（[传感器][192]，µV/(nA·m)），已按参考变换。

    reference: 'average'（减列均值）/ 'infinity'（不变）/
    'electrode'（减参考电极行，需 reference_label）。
    返回 (L, labels, source_positions_mm)。
    """
    labels = list(fixture["montages"][montage])
    sensors = fixture["sensors"]
    index = {s["label"]: i for i, s in enumerate(sensors)}
    gains = np.asarray(fixture["gain_uv_per_nAm"], dtype=float)
    rows = np.array([gains[index[lb]] for lb in labels])
    if reference == "average":
        rows = rows - rows.mean(axis=0, keepdims=True)
    elif reference == "electrode":
        if reference_label is None or reference_label not in labels:
            raise ValueError(f"reference electrode {reference_label} not in montage {montage}")
        rows = rows - rows[labels.index(reference_label)]
    elif reference != "infinity":
        raise ValueError(f"unknown reference {reference}")
    return rows, labels, source_grid_positions_mm(fixture["source_grid_axis_mm"])


def forward_eeg(fixture: dict, montage: str, position_mm, moment_nAm,
                reference: str = "average", reference_label: str | None = None):
    """已知源的正向 EEG（µV）：V = L·q（源在网格点上时精确；网格点外
    用三线性插值，与 TS 的 ``sphereElectrodePotentials`` 同口径）。

    网格点外的位置：对 8 个角点做三线性插值后点乘（与
    ``interpolateSphereGain`` 同式）。返回 (V, labels)。
    """
    axis = np.asarray(fixture["source_grid_axis_mm"], dtype=float)
    pos = _as_float_array(position_mm)
    mom = _as_float_array(moment_nAm)
    if len(pos) != 3 or len(mom) != 3:
        raise ValueError("position/moment must be 3-vectors")
    labels = list(fixture["montages"][montage])
    sensors = fixture["sensors"]
    index = {s["label"]: i for i, s in enumerate(sensors)}
    gains = np.asarray(fixture["gain_uv_per_nAm"], dtype=float)
    grid = source_grid_positions_mm(axis)
    if np.any(pos < axis[0]) or np.any(pos > axis[-1]):
        raise ValueError(f"source position {pos} outside grid [{axis[0]}, {axis[-1]}]")

    def _index_and_weight(x: float):
        for i in range(len(axis) - 1):
            if x <= axis[i + 1]:
                return i, (x - axis[i]) / (axis[i + 1] - axis[i])
        return len(axis) - 2, 1.0

    (ix, wx), (iy, wy), (iz, wz) = (_index_and_weight(float(pos[k])) for k in range(3))
    n = len(axis)
    gain_at = np.zeros((len(labels), 3))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                gi = ((ix + dx) * n + (iy + dy)) * n + (iz + dz)
                w = (wx if dx else 1 - wx) * (wy if dy else 1 - wy) * (wz if dz else 1 - wz)
                for r, lb in enumerate(labels):
                    gain_at[r] += w * gains[index[lb], 3 * gi:3 * gi + 3]
    values = gain_at @ mom
    if reference == "average":
        values = values - values.mean()
    elif reference == "electrode":
        if reference_label is None or reference_label not in labels:
            raise ValueError(f"reference electrode {reference_label} not in montage {montage}")
        values = values - values[labels.index(reference_label)]
    elif reference != "infinity":
        raise ValueError(f"unknown reference {reference}")
    return values, labels


def dipole_fit(L, data_uv):
    """偶极子拟合：64 网格点逐个最小二乘，取残差 RMS 最小者。

    返回 dict(estimated_position_mm, estimated_moment_nAm,
    residual_rms_uv, grid_index, residual_rms_by_grid)。
    """
    L = np.asarray(L, dtype=float)
    v = _as_float_array(data_uv)
    if v.shape[0] != L.shape[0]:
        raise ValueError(f"data length {len(v)} != channel count {L.shape[0]}")
    if len(v) < 3:
        raise ValueError("dipole fit needs at least 3 channels")
    positions = source_grid_positions_mm()
    best = None
    residuals = np.zeros(len(positions))
    for s in range(len(positions)):
        li = L[:, 3 * s:3 * s + 3]
        q, *_ = np.linalg.lstsq(li, v, rcond=None)
        rms = float(np.sqrt(np.mean((v - li @ q) ** 2)))
        residuals[s] = rms
        if best is None or rms < best["residual_rms_uv"]:
            best = {"estimated_position_mm": positions[s], "estimated_moment_nAm": q,
                    "residual_rms_uv": rms, "grid_index": s}
    best["residual_rms_by_grid"] = residuals
    return best


def mne_inverse(L, data_uv, lambda2: float = MNE_LAMBDA2_DEFAULT,
                noise_rms_uv: float = MNE_NOISE_RMS_UV_DEFAULT):
    """MNE 逆解：s = Lᵀ(LLᵀ + λ²σ²I)⁻¹V，R = I（无深度加权），C = σ²I。

    返回 dict(estimated_position_mm, peak_value, spread_mm, lambda2,
    source_norms, source_moments, grid_index)。
    """
    L = np.asarray(L, dtype=float)
    v = _as_float_array(data_uv)
    if v.shape[0] != L.shape[0]:
        raise ValueError(f"data length {len(v)} != channel count {L.shape[0]}")
    if not lambda2 > 0:
        raise ValueError(f"lambda2 must be > 0, got {lambda2}")
    if not noise_rms_uv > 0:
        raise ValueError(f"noise_rms_uv must be > 0, got {noise_rms_uv}")
    positions = source_grid_positions_mm()
    n_ch = L.shape[0]
    a = L @ L.T + lambda2 * noise_rms_uv ** 2 * np.eye(n_ch)
    y = np.linalg.solve(a, v)
    moments = (L.T @ y).reshape(-1, 3)
    norms = np.linalg.norm(moments, axis=1)
    peak = int(np.argmax(norms))
    weights = norms ** 2
    dist2 = np.sum((positions - positions[peak]) ** 2, axis=1)
    spread = float(np.sqrt(np.sum(weights * dist2) / np.sum(weights))) if np.sum(weights) > 0 else 0.0
    return {"estimated_position_mm": positions[peak], "peak_value": float(norms[peak]),
            "spread_mm": spread, "lambda2": float(lambda2),
            "noise_rms_uv": float(noise_rms_uv),
            "source_norms": norms, "source_moments": moments, "grid_index": peak}


def localization_error_mm(a, b) -> float:
    return float(np.linalg.norm(_as_float_array(a) - _as_float_array(b)))


def blind_test(fixture: dict, montage: str, true_position_mm, true_moment_nAm,
               reference: str = "average", noise_rms_uv: float = 0.0, seed: int = 7,
               lambda2: float = MNE_LAMBDA2_DEFAULT,
               mne_noise_rms_uv: float = MNE_NOISE_RMS_UV_DEFAULT):
    """盲测：已知源 → 正向 EEG → 逆解。真值只用来合成数据与事后算误差。

    返回 dict(dipole={...含 localization_error_mm}、
    mne={...}、data_uv、labels)。
    """
    if not noise_rms_uv >= 0:
        raise ValueError(f"noise_rms_uv must be >= 0, got {noise_rms_uv}")
    data, labels = forward_eeg(fixture, montage, true_position_mm, true_moment_nAm, reference)
    if noise_rms_uv > 0:
        rng = np.random.default_rng(seed)
        data = data + rng.standard_normal(len(data)) * noise_rms_uv
    L, _, positions = lead_field_matrix(fixture, montage, reference)
    fit = dipole_fit(L, data)
    inv = mne_inverse(L, data, lambda2=lambda2, noise_rms_uv=mne_noise_rms_uv)
    return {
        "dipole": {
            "estimated_position_mm": fit["estimated_position_mm"].tolist(),
            "estimated_moment_nAm": fit["estimated_moment_nAm"].tolist(),
            "residual_rms_uv": fit["residual_rms_uv"],
            "true_position_mm": list(map(float, true_position_mm)),
            "true_moment_nAm": list(map(float, true_moment_nAm)),
            "localization_error_mm": localization_error_mm(
                fit["estimated_position_mm"], true_position_mm),
        },
        "mne": {
            "estimated_position_mm": inv["estimated_position_mm"].tolist(),
            "peak_value": inv["peak_value"],
            "spread_mm": inv["spread_mm"],
            "localization_error_mm": localization_error_mm(
                inv["estimated_position_mm"], true_position_mm),
            "true_position_mm": list(map(float, true_position_mm)),
            "lambda2": inv["lambda2"],
            "method": "MNE",
        },
        "data_uv": data.tolist(),
        "labels": labels,
    }


# ── MNE 真实管线交叉验证 ───────────────────────────────────────────────

def mne_operator_estimate(fixture: dict, montage: str, data_uv,
                          lambda2: float = MNE_LAMBDA2_DEFAULT,
                          noise_rms_uv: float = MNE_NOISE_RMS_UV_DEFAULT):
    """走 MNE ``make_inverse_operator`` / ``apply_inverse`` 的估计。

    按 ``scientific/forward/generate_sphere_model.py`` 的做法重建
    正向（``make_forward_dipole`` + 四层球），average 参考用投影
    实现；噪声协方差为对角 σ²I（σ 以 V 计）；loose=0.0（偶极子
    正向本身就是固定方向：每网格点 3 个方向各为一个源），
    depth=None（无深度加权，与 numpy 公式同口径）。
    返回 dict(estimate_nAm=(192,)、peak_grid_index、peak_value)。
    注意：MNE 内部的 SVD/白化管线使估计向量与 numpy 公式不逐点
    相等（实测相关 0.990–0.995），只以峰值网格点 + 相关作交叉验证。
    """
    import mne

    labels = list(fixture["montages"][montage])
    origin_m = np.array([0.0, 0.0, 0.04])
    radius_m = 0.095
    info = mne.create_info(labels, sfreq=250.0, ch_types="eeg")
    # 蒙导位置：与生成脚本同式——标准蒙导位置径向投影到 95 mm 球面。
    std_name = "standard_1005" if montage == "10-05" else "standard_1020"
    mont = mne.channels.make_standard_montage(std_name)
    info.set_montage(mont)
    for ch in info["chs"]:
        orig = ch["loc"][:3].copy()
        radial = orig - origin_m
        ch["loc"][:3] = origin_m + radius_m * radial / np.linalg.norm(radial)
        ch["coord_frame"] = mne.io.constants.FIFF.FIFFV_COORD_HEAD
    axis = np.asarray(fixture["source_grid_axis_mm"], dtype=float)
    coords = source_grid_positions_mm(axis)
    positions = np.repeat(origin_m + coords * 1e-3, 3, axis=0)
    orientations = np.tile(np.eye(3), (len(coords), 1))
    dipoles = mne.Dipole(np.arange(len(positions)) * 0.001, positions,
                         np.full(len(positions), 1e-9), orientations,
                         np.ones(len(positions)))
    sphere = mne.make_sphere_model(
        r0=origin_m, head_radius=radius_m,
        relative_radii=(0.90, 0.92, 0.97, 1.0), sigmas=(0.33, 1.0, 0.004, 0.33),
        verbose=False)
    fwd, _ = mne.make_forward_dipole(dipoles, sphere, info, verbose=False)
    cov = mne.Covariance(data=(noise_rms_uv * 1e-6) ** 2 * np.eye(len(labels)),
                         names=labels, bads=[], projs=[], nfree=1000)
    probe = mne.EvokedArray(np.zeros((len(labels), 1)), info, tmin=0.0, verbose=False)
    mne.set_eeg_reference(probe, "average", projection=True, verbose=False)
    inv = mne.minimum_norm.make_inverse_operator(
        probe.info, fwd, cov, loose=0.0, depth=None, verbose=False)
    evk = mne.EvokedArray(np.asarray(data_uv, dtype=float).reshape(-1, 1) * 1e-6,
                          info, tmin=0.0, verbose=False)
    mne.set_eeg_reference(evk, "average", projection=True, verbose=False)
    stc = mne.minimum_norm.apply_inverse(
        evk, inv, lambda2=lambda2, method="MNE", verbose=False)
    est = np.asarray(stc.data[:, 0], dtype=float) * 1e9  # A·m -> nA·m
    norms = np.linalg.norm(est.reshape(-1, 3), axis=1)
    peak = int(np.argmax(norms))
    return {"estimate_nAm": est, "peak_grid_index": peak,
            "peak_value": float(norms[peak])}


# ── Fixture 生成（TS 测试读这些 JSON 做逐点对照）──────────────────────

def build_multitaper_ersp_small_fixture() -> dict:
    """A1 残留项：multitaper 分支 ERSP 的小规模逐点对照 fixture。

    规模特意压小：3 试次 × 1 通道 × 128 采样（−200..308 ms @ 250 Hz），
    频率 [5, 10, 20, 40] Hz，基线 [−200, 0] ms。multitaper TFR 在 TS
    与 Python 两边都是逐点卷积实现（O(试次×频率×时间×锥×窗长)），
    全尺寸 epoch（251 采样 × 6 试次）做逐点对照太慢，小 fixture
    是有意为之（不是放宽门槛：对照本身仍是逐点、容差 1e-6 dB）。
    信号：20 Hz 正弦突发（幅值 5 µV，t ≥ 0 才出现）+ 白噪声
    （seed 11），每试次相位相同。预期形态（Python 实测）：20 Hz
    刺激后 100–300 ms 均值约 +5.7 dB、ITC ≈ 1.00；基线窗内 ERSP
    均值不为 0（log 均值 ≠ 均值的 log，Jensen  gap，窗边缘效应所致，
    两边同公式故逐点一致）；5/40 Hz 也有正 ERSP（突发起始沿的宽带
    泄漏，不是 20 Hz 的频率特异性，解读时勿误读）。
    """
    from scientific.eeg.signal_reference import ersp_itc

    sfreq = 250.0
    n_t = 128
    times = -200.0 + np.arange(n_t) * 1000.0 / sfreq
    rng = np.random.default_rng(11)
    trials = []
    for _ in range(3):
        t = np.arange(n_t) / sfreq
        env = (times >= 0).astype(float)  # 突发只在 t >= 0 出现
        x = env * 5.0 * np.cos(2 * np.pi * 20 * t) + rng.standard_normal(n_t) * 0.5
        trials.append([x.tolist()])
    epochs = {"tmin_ms": -200.0, "tmax_ms": 308.0, "baseline_ms": [-200.0, 0.0],
              "times_ms": times, "trials": trials,
              "kept": [True, True, True], "events": [],
              "sfreq_hz": sfreq, "channels": ["Pz"]}
    freqs = np.array([5.0, 10.0, 20.0, 40.0])
    r = ersp_itc(epochs, "Pz", freqs, "multitaper", [-200.0, 0.0])
    return {
        "meta": {
            "source": "scientific/eeg/inverse_reference.py "
                      "build_multitaper_ersp_small_fixture() via "
                      "scientific/eeg/signal_reference.py ersp_itc(..., 'multitaper')",
            "note": "Small on purpose: per-point multitaper TFR cross-check; "
                    "tolerances stay 1e-6 dB (ERSP) / 1e-9 (ITC).",
            "sfreq_hz": sfreq, "freqs_hz": freqs.tolist(),
            "baseline_ms": [-200.0, 0.0],
        },
        "epochs": {"times_ms": times.tolist(), "trials": trials,
                   "channels": ["Pz"], "sfreq_hz": sfreq,
                   "tmin_ms": -200.0, "tmax_ms": 52.0,
                   "baseline_ms": [-200.0, 0.0]},
        "ersp_db": np.asarray(r["ersp_db"]).tolist(),
        "itc": np.asarray(r["itc"]).tolist(),
        "times_ms": np.asarray(r["times_ms"]).tolist(),
    }


def build_tfr_topo_inverse_fixture(fixture_path) -> dict:
    """TS 测试读的对照 fixture：球面样条网格 + 盲测结果表。

    地形输入：10-20 各电极在真源 [16, 16, 16] mm、矩 [0, 10, 5] nA·m
    下的正向电位（average 参考）；TS 用同一组电极值算插值网格，逐点对照。
    盲测表：固定配置（源位置/矩/导联/噪声/λ²）下 Python 的偶极子拟合
    与 MNE 结果；TS 对同一配置逐项对照（位置分量、残差、峰值、分布范围）。
    """
    fixture = load_sphere_fixture(fixture_path)
    # ── 地形 ──
    topo_values, topo_labels = forward_eeg(fixture, "10-20", [16.0, 16.0, 16.0],
                                           [0.0, 10.0, 5.0], "average")
    positions = [[s["position_mm"] for s in fixture["sensors"]
                  if s["label"] == lb][0] for lb in topo_labels]
    topo = spherical_spline_topography(positions, topo_values, grid_resolution=25)
    # ── 盲测表 ──
    configs = [
        {"montage": "10-20", "true_position_mm": [-16.0, -16.0, -16.0],
         "true_moment_nAm": [0.0, 10.0, 0.0], "noise_rms_uv": 0.0, "seed": 7,
         "lambda2": MNE_LAMBDA2_DEFAULT},
        {"montage": "10-20", "true_position_mm": [48.0, 48.0, 48.0],
         "true_moment_nAm": [0.0, 0.0, 10.0], "noise_rms_uv": 0.0, "seed": 7,
         "lambda2": MNE_LAMBDA2_DEFAULT},
        {"montage": "10-20", "true_position_mm": [-16.0, 16.0, 48.0],
         "true_moment_nAm": [10.0, 0.0, 0.0], "noise_rms_uv": 0.0, "seed": 7,
         "lambda2": MNE_LAMBDA2_DEFAULT},
        {"montage": "10-05", "true_position_mm": [48.0, 48.0, 48.0],
         "true_moment_nAm": [0.0, 0.0, 10.0], "noise_rms_uv": 0.0, "seed": 7,
         "lambda2": MNE_LAMBDA2_DEFAULT},
        {"montage": "10-05", "true_position_mm": [-16.0, -16.0, -16.0],
         "true_moment_nAm": [0.0, 10.0, 0.0], "noise_rms_uv": 0.0, "seed": 7,
         "lambda2": 0.01},
    ]
    blind = []
    for cfg in configs:
        # 全是无噪声配置：TS/Python 逐点对照。TS 与 Python 的噪声 RNG
        # 流不同（mulberry32 vs numpy），有噪声的配置不进 fixture 表，
        # 由两边测试各自实测并报告误差（见测试文件）。
        res = blind_test(fixture, cfg["montage"], cfg["true_position_mm"],
                         cfg["true_moment_nAm"], noise_rms_uv=0.0,
                         lambda2=cfg["lambda2"])
        blind.append({**cfg, "dipole": res["dipole"], "mne": res["mne"]})
    return {
        "meta": {
            "source": "scientific/eeg/inverse_reference.py "
                      "build_tfr_topo_inverse_fixture()",
            "note": "Spline grid + blind-test table (all noiseless configs, "
                    "compared point-by-point by the TS test). Noisy configs "
                    "are measured separately by each side's test (different "
                    "RNG streams) and reported, not compared point-by-point.",
            "fixture_model": fixture["model_id"],
        },
        "topography": {
            "labels": topo_labels,
            "positions_mm": positions,
            "values_uv": topo_values.tolist(),
            "grid": topo["grid"],
        },
        "blind": blind,
    }


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    out_dir = root / "tests" / "pr6" / "fixtures"
    out_dir.mkdir(parents=True, exist_ok=True)
    small = build_multitaper_ersp_small_fixture()
    (out_dir / "multitaper-ersp-small.json").write_text(json.dumps(small), encoding="utf-8")
    print(f"wrote {out_dir / 'multitaper-ersp-small.json'}")
    fixture_path = root / "app" / "public" / "forward-assets" / "sphere-model.json"
    topo_inv = build_tfr_topo_inverse_fixture(fixture_path)
    (out_dir / "tfr-topo-inverse-reference.json").write_text(json.dumps(topo_inv), encoding="utf-8")
    print(f"wrote {out_dir / 'tfr-topo-inverse-reference.json'}")


if __name__ == "__main__":
    main()
