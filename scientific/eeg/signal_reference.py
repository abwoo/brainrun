"""PR6 — 信号处理核心的 Python 对照实现（A1）。

与 ``app/src/lib/signalProcessing.ts`` 逐函数对应：同一输入、同一
约定（见 TS 文件头注释），TS 测试用本模块生成的 fixture
（``tests/pr6/fixtures/signal-reference.json``、``dpss-tapers.json``）
做数值对照。

量纲：输入 µV；采样率 Hz；时间 ms；频率 Hz。
Welch / multitaper PSD 为 µV²/Hz 密度；STFT / Morlet / multitaper
TFR 功率为 µV²（纯正弦幅值 A 在中心频率处 = A²/2）；ERSP 为 dB；
ITC 无量纲；ERP 平均/SEM 为 µV。

能直接调库的地方直接调库（Welch 用 ``scipy.signal.welch``，
DPSS 用 ``scipy.signal.windows.dpss``，FFT 用 ``numpy.fft``），
本模块只负责把库调用拼成与 TS 完全相同的约定；没有现成库函数
的地方（STFT 功率口径、Morlet 标定、epoch/ERSP/ITC）用 numpy
按与 TS 相同的公式实现，并在 ``tests/pr6/test_signal_processing.py``
里用 scipy/MNE 的对应功能做独立验证。

Morlet 标定注意：MNE ``tfr_morlet`` 的功率是本模块标定的
``2·σ_s·√π`` 倍（σ_s 为采样点单位的小波宽度），因为 MNE 小波
ℓ² 范数为 √2 而非 1；对照 MNE 时必须先除掉该因子（见测试）。
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy import signal as _signal

# 与设计稿 §1.1 / TS 的 EEG_BANDS 字面值相同（Hz）。
EEG_BANDS = {
    "delta": (0.5, 4.0),
    "theta": (4.0, 8.0),
    "alpha": (8.0, 13.0),
    "beta": (13.0, 30.0),
    "gamma": (30.0, 45.0),
}


def _as_float_array(x) -> np.ndarray:
    a = np.asarray(x, dtype=float)
    if not np.all(np.isfinite(a)):
        raise ValueError("input contains non-finite values")
    return a


def _floor_pow2(v: int) -> int:
    p = 1
    while p * 2 <= v:
        p *= 2
    return p


def _next_pow2(v: int) -> int:
    p = 1
    while p < v:
        p *= 2
    return p


def _hann_periodic(n: int) -> np.ndarray:
    """周期 Hann 窗（scipy fftbins=True），不是 numpy hanning 的对称形式。"""
    return 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)


# ── FFT / Welch / 频段功率 ─────────────────────────────────────────────

def fft_spectrum(x, n_fft: int) -> np.ndarray:
    """零填充到 n_fft 的 FFT（numpy 正变换口径，与 TS fftInPlace 同号）。"""
    a = _as_float_array(x)
    return np.fft.fft(a, n=n_fft)


def welch_psd(x, sfreq_hz: float, n_fft: int = 256, overlap: float = 0.5):
    """Welch PSD（µV²/Hz），scipy 口径：周期 Hann、50% 重叠、每段不去均值。

    返回 (freqs_hz, psd)。``scipy.signal.welch(detrend=False)`` 的直接
    包装；TS 的 welchPsd 必须与此逐点一致（舍入量级）。
    """
    a = _as_float_array(x)
    if not np.isfinite(sfreq_hz) or sfreq_hz <= 0:
        raise ValueError("sfreq_hz must be a finite positive number")
    if len(a) < 8:
        raise ValueError(f"welch_psd: signal too short ({len(a)} samples)")
    n_fft_eff = _floor_pow2(n_fft)
    n_fft_eff = max(n_fft_eff, 8)
    if n_fft_eff > len(a):
        n_fft_eff = _floor_pow2(len(a))
    if not (0 <= overlap < 1):
        raise ValueError(f"overlap must be in [0, 1), got {overlap}")
    noverlap = int(round(n_fft_eff * overlap))
    freqs, psd = _signal.welch(
        a, fs=sfreq_hz, window="hann", nperseg=n_fft_eff,
        noverlap=noverlap, scaling="density", detrend=False,
    )
    return np.asarray(freqs, dtype=float), np.asarray(psd, dtype=float)


def band_powers(freqs_hz, psd):
    """频段功率（µV²）：PSD 在 §1.1 EEG_BANDS 内梯形积分。"""
    f = _as_float_array(freqs_hz)
    p = _as_float_array(psd)
    if len(f) != len(p):
        raise ValueError("freqs/psd length mismatch")
    if len(f) < 2:
        raise ValueError("need at least 2 frequency points")
    if np.any(np.diff(f) <= 0):
        raise ValueError("freqs_hz must be strictly increasing")
    if np.any(p < 0):
        raise ValueError("psd must be non-negative")
    df_typ = f[1] - f[0]
    out = {}
    for band, (lo, hi) in EEG_BANDS.items():
        idx = np.where((f >= lo) & (f <= hi))[0]
        if len(idx) == 0:
            out[band] = 0.0
        elif len(idx) == 1:
            out[band] = float(p[idx[0]] * df_typ)
        else:
            out[band] = float(np.trapezoid(p[idx], f[idx]))
    return out


# ── STFT ───────────────────────────────────────────────────────────────

def stft(x, sfreq_hz: float, n_fft: int = 256, hop: int | None = None):
    """STFT：功率 µV²（纯正弦幅值 A 在中心频点 = A²/2）、相位 rad。

    与 TS 的 stft 同约定：周期 Hann 窗，左右各补 n_fft/2 个零、末尾
    补零凑整段数（scipy ``stft(boundary='zeros', padded=True)`` 同款），
    帧中心覆盖整个记录。返回 dict(times_ms, freqs_hz, power, phase)，
    power/phase 按 [频率][时间] 排列。
    """
    a = _as_float_array(x)
    if not np.isfinite(sfreq_hz) or sfreq_hz <= 0:
        raise ValueError("sfreq_hz must be a finite positive number")
    if len(a) < 8:
        raise ValueError(f"stft: signal too short ({len(a)} samples)")
    n_fft_eff = _floor_pow2(n_fft)
    n_fft_eff = max(n_fft_eff, 8)
    if n_fft_eff > len(a):
        n_fft_eff = _floor_pow2(len(a))
    hop_eff = n_fft_eff // 2 if hop is None else int(hop)
    if hop_eff < 1 or hop_eff > n_fft_eff:
        raise ValueError(f"hop must be in [1, n_fft], got {hop_eff}")
    win = _hann_periodic(n_fft_eff)
    win_sum2 = float(win.sum()) ** 2
    pad = n_fft_eff // 2
    n_frames = 1 + int(np.ceil(len(a) / hop_eff))
    padded_len = n_fft_eff + (n_frames - 1) * hop_eff
    xp = np.zeros(padded_len)
    xp[pad:pad + len(a)] = a
    k_max = n_fft_eff // 2
    freqs = np.fft.rfftfreq(n_fft_eff, d=1.0 / sfreq_hz)
    power = np.zeros((k_max + 1, n_frames))
    phase = np.zeros((k_max + 1, n_frames))
    for fr in range(n_frames):
        seg = xp[fr * hop_eff:fr * hop_eff + n_fft_eff] * win
        spec = np.fft.rfft(seg)
        mag2 = (np.abs(spec) ** 2) / win_sum2
        power[:, fr] = mag2
        power[1:k_max, fr] *= 2.0
        phase[:, fr] = np.angle(spec)
    times_ms = np.arange(n_frames) * hop_eff * 1000.0 / sfreq_hz
    return {"times_ms": times_ms, "freqs_hz": freqs, "power": power, "phase": phase}


# ── Morlet 小波时频 ────────────────────────────────────────────────────

def _morlet_wavelet(freq_hz: float, sfreq_hz: float, cycles: float = 5.0):
    """返回 (psi, k_cal)：复 Morlet 小波（中心在 0）与功率标定因子 K。

    ψ[n] = π^(−1/4)·σ_s^(−1/2)·exp(−n²/2σ_s²)·exp(i2πfn/fs)，
    σ_s = cycles·fs/(2πf)（采样点）；K = 2/(C²·S1²)，S1 = Σexp(−n²/2σ_s²)，
    使中心频率处纯正弦（幅值 A）的功率 = A²/2。
    """
    sigma_s = cycles * sfreq_hz / (2 * np.pi * freq_hz)
    if sigma_s < 1:
        raise ValueError(f"wavelet under-resolved at {freq_hz} Hz (sigma {sigma_s:.2f} samples < 1)")
    m = int(np.ceil(3 * sigma_s))
    n = np.arange(-m, m + 1)
    c = np.pi ** (-0.25) * sigma_s ** (-0.5)
    psi = c * np.exp(-n ** 2 / (2 * sigma_s ** 2)) * np.exp(1j * 2 * np.pi * freq_hz * n / sfreq_hz)
    s1 = float(np.sum(np.exp(-n ** 2 / (2 * sigma_s ** 2))))
    k_cal = 2.0 / (c ** 2 * s1 ** 2)
    return psi, k_cal, m


def morlet_tfr(x, sfreq_hz: float, freqs_hz, cycles: float = 5.0):
    """Morlet 小波时频：功率 µV²、相位 rad，按 [频率][时间] 排列。

    FFT 卷积、'same' 对齐（小波中心对准当前采样点）；两端 ±3σ_t
    内受零边界污染。返回 dict(times_ms, power, phase)。
    """
    a = _as_float_array(x)
    freqs = _as_float_array(freqs_hz)
    if not np.isfinite(sfreq_hz) or sfreq_hz <= 0:
        raise ValueError("sfreq_hz must be a finite positive number")
    if len(a) < 8:
        raise ValueError("morlet_tfr: signal too short")
    if not np.isfinite(cycles) or cycles <= 0:
        raise ValueError("cycles must be positive")
    n = len(a)
    power = np.zeros((len(freqs), n))
    phase = np.zeros((len(freqs), n))
    for fi, f in enumerate(freqs):
        if f <= 0:
            raise ValueError(f"frequencies must be positive, got {f}")
        if f >= sfreq_hz / 2:
            raise ValueError(f"frequency {f} Hz at/above Nyquist {sfreq_hz / 2} Hz")
        psi, k_cal, m = _morlet_wavelet(float(f), sfreq_hz, cycles)
        n_fft = _next_pow2(n + len(psi))
        conv = np.fft.ifft(np.fft.fft(a, n_fft) * np.fft.fft(np.conj(psi[::-1]), n_fft))
        y = conv[m:m + n]
        power[fi] = (np.abs(y) ** 2) * k_cal
        phase[fi] = np.angle(y)
    times_ms = np.arange(n) * 1000.0 / sfreq_hz
    return {"times_ms": times_ms, "power": power, "phase": phase}


# ── DPSS / multitaper ──────────────────────────────────────────────────

def dpss_tapers(n: int, nw: float, k: int) -> np.ndarray:
    """DPSS 锥（scipy 口径）：返回 (K, N)，每条 ℓ² 范数 1、相互正交。

    符号约定与 TS 一致：每条锥绝对值最大的元素取正。
    """
    if not isinstance(n, int) and not float(n).is_integer():
        raise ValueError("n must be an integer")
    n = int(n)
    if n < 8:
        raise ValueError("n must be >= 8")
    if not (0 < nw < n / 2):
        raise ValueError(f"nw must satisfy 0 < nw < n/2, got nw={nw}, n={n}")
    if not isinstance(k, int) and not float(k).is_integer():
        raise ValueError("k must be an integer")
    k = int(k)
    if not (1 <= k <= min(2 * nw - 1, n)):
        raise ValueError(f"k must be in [1, min(2*nw-1, n)], got k={k}, nw={nw}")
    tapers = _signal.windows.dpss(n, nw, k)
    for i in range(k):
        j = int(np.argmax(np.abs(tapers[i])))
        if tapers[i, j] < 0:
            tapers[i] = -tapers[i]
    return tapers


def _one_sided_psd_density(spec: np.ndarray, n_fft: int, sfreq_hz: float, win_energy: float) -> np.ndarray:
    psd = (np.abs(spec) ** 2) / (sfreq_hz * win_energy)
    psd[1:n_fft // 2] *= 2.0
    return psd[:n_fft // 2 + 1]


def multitaper_psd(x, sfreq_hz: float, nw: float = 4.0, k: int | None = None):
    """Multitaper PSD（µV²/Hz，Thomson 口径），与 TS 的 multitaperPsd 同约定：

    记录切成约 1 s 的段（段长 = clamp(round(fs), 64, 1024) 采样点，
    50% 重叠）逐段加锥平均；短于一段的记录用单段。返回 (freqs_hz, psd)。
    """
    a = _as_float_array(x)
    if not np.isfinite(sfreq_hz) or sfreq_hz <= 0:
        raise ValueError("sfreq_hz must be a finite positive number")
    if len(a) < 8:
        raise ValueError("multitaper_psd: signal too short")
    k_eff = max(1, int(np.floor(2 * nw - 1))) if k is None else int(k)
    seg_len = int(min(max(round(sfreq_hz), 64), 1024))
    seg_len_eff = min(seg_len, len(a))
    if not (0 < nw < seg_len_eff / 2):
        raise ValueError(f"nw must satisfy 0 < nw < segLen/2, got nw={nw}, segLen={seg_len_eff}")
    if not (1 <= k_eff <= min(2 * nw - 1, seg_len_eff)):
        raise ValueError(f"k must be in [1, min(2*nw-1, segLen)], got k={k_eff}, nw={nw}")
    n_fft = _next_pow2(seg_len_eff)
    tapers = dpss_tapers(seg_len_eff, nw, k_eff)
    taper_energy = np.sum(tapers ** 2, axis=1)
    acc = np.zeros(n_fft // 2 + 1)
    n_seg = 0
    if len(a) <= seg_len_eff:
        starts = [0]
    else:
        step = max(1, seg_len_eff // 2)
        starts = list(range(0, len(a) - seg_len_eff + 1, step))
    for start in starts:
        seg = a[start:start + seg_len_eff]
        for ti in range(k_eff):
            spec = np.fft.rfft(seg * tapers[ti], n=n_fft)
            acc += _one_sided_psd_density(spec, n_fft, sfreq_hz, float(taper_energy[ti]))
        n_seg += 1
    return np.fft.rfftfreq(n_fft, d=1.0 / sfreq_hz), acc / (n_seg * k_eff)


# ── Epoch / 平均 / ERSP-ITC / 峰值 ─────────────────────────────────────

def _uniform_dt_ms(times_ms) -> float:
    t = _as_float_array(times_ms)
    if len(t) < 2:
        raise ValueError("recording needs at least 2 samples")
    dt = (t[-1] - t[0]) / (len(t) - 1)
    if not dt > 0:
        raise ValueError("times_ms must be increasing")
    tol = 1e-9 * max(1.0, abs(t[-1] - t[0]))
    if np.any(np.abs(np.diff(t) - dt) > tol):
        raise ValueError("times_ms must be a uniform grid")
    return float(dt)


def epoch_recording(rec, events, tmin_ms: float, tmax_ms: float,
                    baseline_ms, reject_peak_to_peak_uv: float | None = None):
    """MNE 口径 epoch 切分（µV），与 TS 的 epochRecording 同约定。

    ``rec`` 为 dict：sfreq_hz、times_ms、channels（标签 list）、
    data_uv（[通道][采样]）；``events`` 为 dict list，每项含 t_ms。
    返回 dict（EpochSet 同款字段）：kept 与输入事件一一对应，
    trials/events 只含保留试次。
    """
    sfreq_hz = float(rec["sfreq_hz"])
    if not np.isfinite(sfreq_hz) or sfreq_hz <= 0:
        raise ValueError("sfreq_hz must be positive")
    if not np.isfinite(tmin_ms) or not np.isfinite(tmax_ms) or tmax_ms <= tmin_ms:
        raise ValueError(f"need tmin_ms < tmax_ms, got [{tmin_ms}, {tmax_ms}]")
    b0, b1 = float(baseline_ms[0]), float(baseline_ms[1])
    if b0 > b1:
        raise ValueError("baseline_ms must satisfy lo <= hi")
    if reject_peak_to_peak_uv is not None and (
            not np.isfinite(reject_peak_to_peak_uv) or reject_peak_to_peak_uv <= 0):
        raise ValueError("reject_peak_to_peak_uv must be positive")
    times = _as_float_array(rec["times_ms"])
    dt_ms = _uniform_dt_ms(times)
    dt_expected = 1000.0 / sfreq_hz
    if abs(dt_ms - dt_expected) > 1e-6 * dt_expected:
        raise ValueError("times_ms spacing disagrees with sfreq_hz")
    data = np.asarray(rec["data_uv"], dtype=float)
    n_ch = len(rec["channels"])
    if data.shape[0] != n_ch:
        raise ValueError("data_uv/channel count mismatch")
    n_samples = len(times)
    n_t = int(round((tmax_ms - tmin_ms) * sfreq_hz / 1000.0)) + 1
    if n_t < 1:
        raise ValueError("epoch has no samples")
    ep_times = tmin_ms + np.arange(n_t) * dt_expected
    base_idx = np.where((ep_times >= b0 - 1e-9) & (ep_times <= b1 + 1e-9))[0]
    if len(base_idx) == 0:
        raise ValueError(f"baseline window {baseline_ms} has no samples in the epoch")
    i0_offset = int(round(tmin_ms * sfreq_hz / 1000.0))
    t0 = float(times[0])
    kept, trials, kept_events = [], [], []
    for ev in events:
        i_ev = int(round((float(ev["t_ms"]) - t0) * sfreq_hz / 1000.0))
        i_ev = max(0, min(n_samples - 1, i_ev))
        i0 = i_ev + i0_offset
        i1 = i0 + n_t - 1
        if i0 < 0 or i1 >= n_samples:
            kept.append(False)
            continue
        ep = data[:, i0:i1 + 1].astype(float).copy()
        ep -= ep[:, base_idx].mean(axis=1, keepdims=True)
        if reject_peak_to_peak_uv is not None:
            ptp = ep.max(axis=1) - ep.min(axis=1)
            if np.any(ptp > reject_peak_to_peak_uv):
                kept.append(False)
                continue
        kept.append(True)
        trials.append(ep)
        kept_events.append(ev)
    return {
        "tmin_ms": float(tmin_ms), "tmax_ms": float(tmax_ms),
        "baseline_ms": [b0, b1], "times_ms": ep_times,
        "trials": trials, "kept": kept, "events": kept_events,
        "sfreq_hz": sfreq_hz, "channels": list(rec["channels"]),
    }


def average_epochs(epochs):
    """叠加平均（µV）：均值与 SEM（样本标准差 ddof=1 除以 √n；n=1 时 SEM 记 0）。"""
    trials = epochs["trials"]
    if len(trials) == 0:
        raise ValueError("average_epochs: no trials")
    arr = np.asarray(trials, dtype=float)  # (n_trials, n_ch, n_t)
    n = arr.shape[0]
    mean = arr.mean(axis=0)
    if n > 1:
        sem = arr.std(axis=0, ddof=1) / np.sqrt(n)
    else:
        sem = np.zeros_like(mean)
    return {"times_ms": np.asarray(epochs["times_ms"], dtype=float),
            "mean_uv": mean, "sem_uv": sem, "n": n}


def _multitaper_tfr(x, sfreq_hz: float, freqs_hz):
    """滑动窗 multitaper 时频（内部用）：每频率窗长 = 7 个周期（MNE 同款）。

    功率 µV²（正弦标定，与 Morlet 同口径）；相位取首条锥的系数相位。
    """
    a = _as_float_array(x)
    freqs = _as_float_array(freqs_hz)
    n = len(a)
    nw, k = 4.0, 7
    times_ms = np.arange(n) * 1000.0 / sfreq_hz
    power = np.zeros((len(freqs), n))
    phase = np.zeros((len(freqs), n))
    for fi, f in enumerate(freqs):
        if f <= 0:
            raise ValueError("frequencies must be positive")
        if f >= sfreq_hz / 2:
            raise ValueError(f"frequency {f} Hz at/above Nyquist")
        length = int(round(7 * sfreq_hz / f))
        length = max(16, min(length, n))
        tapers = dpss_tapers(length, nw, k)
        s_sum = tapers.sum(axis=1)
        k_cal = 2.0 / float(np.mean(s_sum ** 2))
        n_fft = _next_pow2(length)
        bin_idx = min(int(round(f * n_fft / sfreq_hz)), n_fft // 2)
        half = length // 2
        for t in range(n):
            lo = t - half
            seg = np.zeros(length)
            src_lo = max(lo, 0)
            src_hi = min(lo + length, n)
            if src_hi > src_lo:
                seg[src_lo - lo:src_hi - lo] = a[src_lo:src_hi]
            # 直接 DFT 求 bin（与 TS 的逐点求和同公式）。
            ang = -2 * np.pi * bin_idx * np.arange(length) / n_fft
            coef = np.sum((seg * tapers) * np.exp(1j * ang), axis=1)
            power[fi, t] = float(np.mean(np.abs(coef) ** 2)) * k_cal
            phase[fi, t] = float(np.angle(coef[0]))
    return {"times_ms": times_ms, "power": power, "phase": phase}


def ersp_itc(epochs, channel: str, freqs_hz, method: str, baseline_ms):
    """ERSP（dB）与 ITC（0–1），单通道，按 [频率][时间] 排列。

    与 TS 的 erspItc 同约定：ERSP = 10·log10(试次平均功率/基线功率)，
    基线为 baselineMs 窗内试次平均功率的时间均值；ITC = |试次平均 e^{iφ}|。
    """
    channels = list(epochs["channels"])
    if channel not in channels:
        raise ValueError(f"channel {channel} not in EpochSet")
    ch_idx = channels.index(channel)
    trials = epochs["trials"]
    if len(trials) == 0:
        raise ValueError("ersp_itc: no trials")
    freqs = _as_float_array(freqs_hz)
    if len(freqs) == 0:
        raise ValueError("empty freqs_hz")
    b0, b1 = float(baseline_ms[0]), float(baseline_ms[1])
    if b0 > b1:
        raise ValueError("baseline_ms must satisfy lo <= hi")
    sfreq_hz = float(epochs["sfreq_hz"])
    t0 = float(np.asarray(epochs["times_ms"])[0])
    n_f = len(freqs)
    tfr_times = None
    sum_power = sum_re = sum_im = None
    for trial in trials:
        x = np.asarray(trial[ch_idx], dtype=float)
        stft_n_fft = 0
        if method == "stft":
            stft_n_fft = min(256, _floor_pow2(max(8, len(x))))
            tfr = stft(x, sfreq_hz, n_fft=stft_n_fft, hop=max(1, stft_n_fft // 2))
        elif method == "morlet":
            tfr = morlet_tfr(x, sfreq_hz, freqs, cycles=5.0)
        elif method == "multitaper":
            tfr = _multitaper_tfr(x, sfreq_hz, freqs)
        else:
            raise ValueError(f"unknown method {method}")
        if tfr_times is None:
            tfr_times = np.asarray(tfr["times_ms"], dtype=float) + t0
            sum_power = np.zeros((n_f, len(tfr_times)))
            sum_re = np.zeros((n_f, len(tfr_times)))
            sum_im = np.zeros((n_f, len(tfr_times)))
        # STFT 返回全部 FFT 频点，需把请求的频率映射到最近频点；
        # morlet/multitaper 直接返回请求的频率，行号即频率序号。
        pwr = np.asarray(tfr["power"], dtype=float)
        phs = np.asarray(tfr["phase"], dtype=float)
        if method == "stft":
            rows = [min(int(round(f * stft_n_fft / sfreq_hz)), stft_n_fft // 2) for f in freqs]
            pwr = pwr[rows]
            phs = phs[rows]
        sum_power += pwr
        sum_re += np.cos(phs)
        sum_im += np.sin(phs)
    base_idx = np.where((tfr_times >= b0 - 1e-9) & (tfr_times <= b1 + 1e-9))[0]
    if len(base_idx) == 0:
        raise ValueError(f"baseline window {baseline_ms} has no samples on the TFR time axis")
    avg_power = sum_power / len(trials)
    base = avg_power[:, base_idx].mean(axis=1)
    if np.any(base <= 0):
        raise ValueError(f"baseline power is {base} (must be > 0)")
    ersp_db = 10 * np.log10(avg_power / base[:, None])
    itc = np.hypot(sum_re, sum_im) / len(trials)
    return {"ersp_db": ersp_db, "itc": itc, "times_ms": tfr_times}


def peak_in_window(times_ms, values, win_ms):
    """窗内峰值（MNE get_peak(mode='abs') 口径）：窗内 |值| 最大的采样点。

    返回 dict(peak_uv, latency_ms, window_mean_uv)。
    """
    t = _as_float_array(times_ms)
    v = _as_float_array(values)
    if len(t) != len(v):
        raise ValueError("times/values length mismatch")
    if len(t) == 0:
        raise ValueError("empty input")
    lo, hi = float(win_ms[0]), float(win_ms[1])
    if lo > hi:
        raise ValueError("window must satisfy lo <= hi")
    idx = np.where((t >= lo - 1e-9) & (t <= hi + 1e-9))[0]
    if len(idx) == 0:
        raise ValueError(f"window {win_ms} has no samples")
    j = idx[int(np.argmax(np.abs(v[idx])))]
    return {"peak_uv": float(v[j]), "latency_ms": float(t[j]),
            "window_mean_uv": float(v[idx].mean())}


# ── Fixture 生成 ───────────────────────────────────────────────────────

def _synthetic_recording_and_events():
    """确定性合成记录：2 通道（Pz、Cz），10 s @ 250 Hz；8 个 oddball 事件。

    Pz 上叠加高斯 P300 形 bump（峰 8.89 µV @ 410 ms，σ=78 ms——
    该 σ 使 300–500 ms 窗均值 ≈ ds003061 约束值 6.94 µV），Cz 上
    同形半幅；另加白噪声（seed 2）。
    事件间隔取 1200 ms（epoch [−200, 800] 不重叠），避免上一试次
    的 bump 落进下一试次的基线窗——400 ms 间隔时上一 bump 的峰
    （+410 ms）正好落在下一基线窗内，基线校正会减掉约 3.9 µV，
    平均峰值会被压到约 5.1 µV（实测过的真实现象，不是代码 bug）。
    第 3 个试次含 200 µV 尖峰（应被 150 µV 峰峰值剔除），第 8 个
    事件在记录末尾（出界，应丢弃）。
    注意：[−200, 800] ms @ 250 Hz 含两端共 251 个采样点（MNE 同款）。
    """
    rng = np.random.default_rng(2)
    sfreq = 250.0
    n_samples = 2500
    times_ms = np.arange(n_samples) * 1000.0 / sfreq
    data = rng.standard_normal((2, n_samples)) * 2.0
    events = []
    for i in range(8):
        events.append({"id": i, "type": "oddball", "t_ms": float(1000 + 1200 * i),
                       "condition": "oddball", "drive": 1.0, "drive_unit": "jr"})
    events[7]["t_ms"] = 9400.0  # 末尾：epoch [−200, 800] 出界
    rel = np.arange(251) * 4.0 - 200.0  # epoch 相对时刻，−200..800 ms
    bump = 8.89 * np.exp(-((rel - 410.0) ** 2) / (2 * 78.0 ** 2))
    for k, ev in enumerate(events):
        i_ev = int(round(ev["t_ms"] * sfreq / 1000.0))
        i0 = i_ev - 50
        if 0 <= i0 and i0 + 251 <= n_samples:
            data[0, i0:i0 + 251] += bump
            data[1, i0:i0 + 251] += 0.5 * bump
    # 第 3 个试次（事件 idx 2）加 200 µV 尖峰（+100 ms 处）→ 应被剔除。
    i_ev = int(round(events[2]["t_ms"] * sfreq / 1000.0))
    data[0, i_ev + 25] += 200.0
    rec = {"version": 1, "sfreq_hz": sfreq, "times_ms": times_ms,
           "channels": ["Pz", "Cz"], "data_uv": data,
           "reference": {"mode": "average"}, "montage": "10-20",
           "forward_model_id": "fixture", "source_model_id": "fixture",
           "seed": 2, "noise": None}
    return rec, events


def build_fixture() -> dict:
    """生成 TS 测试用的对照 fixture（确定性；见 tests/pr6/fixtures/）。"""
    sfreq = 250.0
    t2 = np.arange(500) / sfreq
    rng0 = np.random.default_rng(0)
    x_sine = 5.0 * np.cos(2 * np.pi * 10 * t2) + rng0.standard_normal(500) * 0.5
    rng1 = np.random.default_rng(1)
    x_white = rng1.standard_normal(1000) * 3.0
    t4 = np.arange(1000) / sfreq
    x_two = (5.0 * np.cos(2 * np.pi * 10 * t4)
             + 3.0 * np.cos(2 * np.pi * 20 * t4)
             + rng0.standard_normal(1000) * 0.5)

    f_w, p_w = welch_psd(x_sine, sfreq, n_fft=256, overlap=0.5)
    f_m, p_m = multitaper_psd(x_sine, sfreq, nw=4.0, k=7)
    f_mw, p_mw = multitaper_psd(x_white, sfreq, nw=4.0, k=7)
    st = stft(x_two, sfreq, n_fft=128, hop=64)
    mo = morlet_tfr(x_two, sfreq, np.array([5.0, 10.0, 15.0, 20.0, 30.0]), cycles=5.0)

    rec, events = _synthetic_recording_and_events()
    ep = epoch_recording(rec, events, -200.0, 800.0, [-200.0, 0.0],
                         reject_peak_to_peak_uv=150.0)
    avg = average_epochs(ep)
    peak_pz = peak_in_window(avg["times_ms"], avg["mean_uv"][0], [250.0, 600.0])
    peak_pz_mean = peak_in_window(avg["times_ms"], avg["mean_uv"][0], [300.0, 500.0])
    ersp_morlet = ersp_itc(ep, "Pz", np.array([5.0, 10.0, 20.0]), "morlet", [-200.0, 0.0])
    ersp_stft = ersp_itc(ep, "Pz", np.array([5.0, 10.0, 20.0]), "stft", [-200.0, 0.0])

    return {
        "meta": {
            "source": "scientific/eeg/signal_reference.py build_fixture()",
            "sfreq_hz": sfreq,
            "note": "Deterministic synthetic inputs (seeded RNG); outputs are the "
                    "Python reference. TS test compares its own outputs to these.",
        },
        "welch_sine10": {
            "x": x_sine.tolist(),
            "freqs_hz": f_w.tolist(), "psd": p_w.tolist(),
            "band_powers": band_powers(f_w, p_w),
        },
        "multitaper_sine10": {"x": x_sine.tolist(), "freqs_hz": f_m.tolist(), "psd": p_m.tolist()},
        "multitaper_white": {"x": x_white.tolist(), "freqs_hz": f_mw.tolist(), "psd": p_mw.tolist()},
        "stft_two_sine": {
            "x": x_two.tolist(), "n_fft": 128, "hop": 64,
            "times_ms": st["times_ms"].tolist(), "freqs_hz": st["freqs_hz"].tolist(),
            "power": st["power"].tolist(), "phase": st["phase"].tolist(),
        },
        "morlet_two_sine": {
            "x": x_two.tolist(), "freqs_hz": [5.0, 10.0, 15.0, 20.0, 30.0],
            "times_ms": mo["times_ms"].tolist(),
            "power": mo["power"].tolist(), "phase": mo["phase"].tolist(),
        },
        "erp": {
            "rec": {"sfreq_hz": rec["sfreq_hz"], "times_ms": rec["times_ms"].tolist(),
                    "channels": rec["channels"], "data_uv": rec["data_uv"].tolist()},
            "events": events,
            "tmin_ms": -200.0, "tmax_ms": 800.0, "baseline_ms": [-200.0, 0.0],
            "reject_peak_to_peak_uv": 150.0,
            "kept": ep["kept"],
            "times_ms": ep["times_ms"].tolist(),
            "trials": [tr.tolist() for tr in ep["trials"]],
            "mean_uv": avg["mean_uv"].tolist(), "sem_uv": avg["sem_uv"].tolist(),
            "n": avg["n"],
            "peak_250_600_pz": peak_pz,
            "window_300_500_pz": peak_pz_mean,
        },
        "ersp_morlet": {
            "freqs_hz": [5.0, 10.0, 20.0], "times_ms": ersp_morlet["times_ms"].tolist(),
            "ersp_db": ersp_morlet["ersp_db"].tolist(), "itc": ersp_morlet["itc"].tolist(),
        },
        "ersp_stft": {
            "freqs_hz": [5.0, 10.0, 20.0], "times_ms": ersp_stft["times_ms"].tolist(),
            "ersp_db": ersp_stft["ersp_db"].tolist(), "itc": ersp_stft["itc"].tolist(),
        },
    }


def build_dpss_fixture() -> dict:
    """DPSS 锥 fixture：scipy 口径，注明来源与参数。"""
    cases = []
    for (n, nw, k) in ((250, 4.0, 7), (256, 4.0, 7), (128, 2.5, 4)):
        tapers = dpss_tapers(n, nw, k)
        cases.append({"n": n, "nw": nw, "k": k, "tapers": tapers.tolist()})
    return {
        "meta": {
            "source": "scipy.signal.windows.dpss (scipy 1.18.1) via "
                      "scientific/eeg/signal_reference.py build_dpss_fixture()",
            "note": "Unit-energy orthonormal tapers; sign convention: largest-|value| "
                    "element positive (matches TS dpssTapers). Compare up to per-taper sign.",
            "params": "NW = time-halfbandwidth product; K = 2*NW-1 tapers",
        },
        "cases": cases,
    }


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    out_dir = root / "tests" / "pr6" / "fixtures"
    out_dir.mkdir(parents=True, exist_ok=True)
    fixture = build_fixture()
    (out_dir / "signal-reference.json").write_text(json.dumps(fixture), encoding="utf-8")
    dpss = build_dpss_fixture()
    (out_dir / "dpss-tapers.json").write_text(json.dumps(dpss), encoding="utf-8")
    print(f"wrote {out_dir / 'signal-reference.json'}")
    print(f"wrote {out_dir / 'dpss-tapers.json'}")


if __name__ == "__main__":
    main()
