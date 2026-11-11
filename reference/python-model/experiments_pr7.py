"""PR-15 — 双脑对照、时间机器、闭环控制的 Python 同公式实现。

与 `app/src/lib/experiments.ts` 同式对照：
- Jansen–Rit 六个一阶 ODE + RK4（dt = 0.5 ms），sigmoid 与 TS 的
  `jansenRitSigmoidPerS` 同式；偶极矩耦合 q = N·coherence·L·g·(y0−y0_0)·1e-6；
  Pz 代理增益 0.16 µV/(nA·m)（PR6 `PZ_GAIN_UV_PER_NAM`）。
- 确定性测量噪声：splitmix32 哈希 → Box–Muller，按节拍序号索引
  （与 TS 的 `indexedGaussian` 同式，恢复后重跑逐值相同）。
- 阈值控制器 + PID（位置式，条件积分抗饱和）+ 延迟线，与 TS 同律。
- 特征：Goertzel 单频功率（标定 A²/2）、滑窗 RMS、瞬时值。

跑法（MNE 1.11.0 环境用 ~/workspace/eeg-venv/bin/python）：
    python reference/python-model/experiments_pr7.py            # 自检并打印关键数值
    python reference/python-model/experiments_pr7.py --write-fixture
        # 生成 tests/pr7/fixtures/experiments-reference.json（TS 测试对照用）
    python -m unittest discover -s tests/pr7 -p 'test_experiments.py' -v

数值对照容差（实测后定，见 tests/pr7/experiments.test.mjs）：
TS 与 Python 用同一 RK4、同一 float64 运算顺序，自由运行 y0/q 的差
来自 math.exp / Math.exp 的末位差异，随步数累积；PID 阶跃响应用
精确指数积分，两边逐值一致到 1e-12 量级。
"""

import argparse
import json
import math
import sys
from pathlib import Path

# ---------------------------------------------------------------- constants

DT_MS = 0.5
CONTROL_TICK_STEPS = 8
CONTROL_DT_MS = DT_MS * CONTROL_TICK_STEPS
PZ_GAIN_UV_PER_NAM = 0.16

JR_DEFAULTS = dict(
    gain_exc_mv=3.25, gain_inh_mv=22.0,
    rate_exc_per_s=100.0, rate_inh_per_s=50.0,
    c1=135.0, c2=108.0, c3=33.75, c4=33.75,
    sigmoid_max_per_s=2.5, sigmoid_half_mv=6.0, sigmoid_slope_per_mv=0.56,
    baseline_input_per_s=90.0, dt_ms=0.5,
)
N_CELLS = 1_000_000
COHERENCE = 0.08
L_MM = 0.5
G_PA_PER_MV = 200.0


# ---------------------------------------------------------------- JR model

def jr_sigmoid_per_s(v_mv, p):
    a = p["sigmoid_slope_per_mv"] * (p["sigmoid_half_mv"] - v_mv)
    if a >= 0:
        k = math.exp(-a)
        return 2 * p["sigmoid_max_per_s"] * k / (1 + k)
    k = math.exp(a)
    return 2 * p["sigmoid_max_per_s"] / (1 + k)


def jr_derivative(s, input_per_s, p):
    y0, y1, y2, y3, y4, y5 = s
    a = p["rate_exc_per_s"] / 1000.0
    b = p["rate_inh_per_s"] / 1000.0
    s_per_ms = lambda v: jr_sigmoid_per_s(v, p) / 1000.0
    inp = input_per_s / 1000.0
    return (
        y3,
        y4,
        y5,
        p["gain_exc_mv"] * a * s_per_ms(y1 - y2) - 2 * a * y3 - a * a * y0,
        p["gain_exc_mv"] * a * (inp + p["c2"] * s_per_ms(p["c1"] * y0))
        - 2 * a * y4 - a * a * y1,
        p["gain_inh_mv"] * b * p["c4"] * s_per_ms(p["c3"] * y0)
        - 2 * b * y5 - b * b * y2,
    )


def _add(s, k, f):
    return tuple(x + f * ki for x, ki in zip(s, k))


def jr_rk4(s, input_per_s, p, dt):
    k1 = jr_derivative(s, input_per_s, p)
    k2 = jr_derivative(_add(s, k1, dt / 2), input_per_s, p)
    k3 = jr_derivative(_add(s, k2, dt / 2), input_per_s, p)
    k4 = jr_derivative(_add(s, k3, dt), input_per_s, p)
    return tuple(
        s[i] + dt * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6 for i in range(6)
    )


def equilibrate_jr(p):
    state = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    duration = 5000.0
    t = 0.0
    while t < duration - 1e-12:
        dt = min(p["dt_ms"], duration - t)
        state = jr_rk4(state, p["baseline_input_per_s"], p, dt)
        t += dt
    res = jr_derivative(state, p["baseline_input_per_s"], p)
    if max(abs(v) for v in res) > 1e-6 or any(not math.isfinite(v) for v in state):
        raise ValueError("No stable physical equilibrium for these Jansen-Rit parameters")
    return state


def moment_nAm(y0, baseline_y0):
    return N_CELLS * COHERENCE * L_MM * G_PA_PER_MV * (y0 - baseline_y0) * 1e-6


# ---------------------------------------------------------------- deterministic noise

def _u32(x):
    return x & 0xFFFFFFFF


def splitmix32_uniform(seed, index):
    z = _u32(_u32(seed) + _u32(index * 0x9E3779B9))
    z = _u32(z + 0x9E3779B9)
    z = _u32((z ^ (z >> 16)) * 0x85EBCA6B)
    z = _u32((z ^ (z >> 13)) * 0xC2B2AE35)
    return ((z ^ (z >> 16)) & 0xFFFFFFFF) / 4294967296.0


def indexed_gaussian(seed, index):
    u1 = max(splitmix32_uniform(seed, 2 * index), 1e-12)
    u2 = splitmix32_uniform(seed, 2 * index + 1)
    return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


# ---------------------------------------------------------------- plant

class JrPlant:
    """单步植物：六维 JR 状态 + 时钟 + 事件表 + 适应资源（可快照/恢复）。"""

    def __init__(self, config):
        self.params = dict(JR_DEFAULTS)
        if config.get("jr_params"):
            self.params.update(config["jr_params"])
        self.baseline_input = config.get("baseline_input_per_s",
                                         self.params["baseline_input_per_s"])
        self.params["baseline_input_per_s"] = self.baseline_input
        self.limit_cycle = bool(config.get("limit_cycle", False))
        self.adaptation = config.get("adaptation")
        self.events = [dict(ev, effective_drive_per_s=ev["drive_per_s"],
                            started=False) for ev in config.get("events", [])]
        if self.limit_cycle:
            self.state = (0.0,) * 6
            self.baseline_y0 = 0.0
        else:
            self.state = equilibrate_jr(self.params)
            self.baseline_y0 = self.state[0]
        self.t_ms = 0.0
        self.adaptation_x = 1.0

    def _event_drive_at(self, t_ms):
        drive = 0.0
        for ev in self.events:
            if abs(t_ms - ev["t_ms"]) < 1e-9 and not ev["started"]:
                ev["started"] = True
                ev["effective_drive_per_s"] = (
                    ev["drive_per_s"] * self.adaptation_x
                    if self.adaptation else ev["drive_per_s"])
                if self.adaptation:
                    self.adaptation_x *= 1 - self.adaptation["utilization"]
            if t_ms >= ev["t_ms"] - 1e-9 and t_ms < ev["t_ms"] + ev["duration_ms"] - 1e-9:
                drive += ev["effective_drive_per_s"]
        return drive

    def step(self, control_input_per_s=0.0):
        if self.adaptation:
            self.adaptation_x += (1 - self.adaptation_x) * (DT_MS / self.adaptation["tau_rec_ms"])
            if self.adaptation_x > 1.0:
                self.adaptation_x = 1.0
        drive = self._event_drive_at(self.t_ms)
        total = max(0.0, self.baseline_input + drive + control_input_per_s)
        self.state = jr_rk4(self.state, total, self.params, DT_MS)
        if (any(not math.isfinite(v) for v in self.state)
                or not (-10 <= self.state[0] <= 100)
                or not (-10 <= self.state[1] <= 100)
                or not (-10 <= self.state[2] <= 100)):
            raise ValueError("JrPlant: Jansen-Rit population diverged")
        self.t_ms += DT_MS
        return self.read()

    def read(self):
        q = moment_nAm(self.state[0], self.baseline_y0)
        return dict(t_ms=self.t_ms, y0=self.state[0], q_nAm=q, eeg_uv=q * PZ_GAIN_UV_PER_NAM)

    def effective_drives(self):
        return [ev["effective_drive_per_s"] for ev in self.events]

    def snapshot(self):
        return dict(t_ms=self.t_ms, state=list(self.state),
                    adaptation_x=self.adaptation_x,
                    events=[dict(started=ev["started"],
                                 effective_drive_per_s=ev["effective_drive_per_s"])
                            for ev in self.events])

    def restore(self, snap):
        if len(snap["state"]) != 6:
            raise ValueError("JrPlant.restore: snapshot state must have 6 numbers")
        self.state = tuple(snap["state"])
        self.t_ms = snap["t_ms"]
        self.adaptation_x = snap["adaptation_x"]
        for ev, s in zip(self.events, snap["events"]):
            ev["started"] = s["started"]
            ev["effective_drive_per_s"] = s["effective_drive_per_s"]


def run_single_experiment(config):
    plant = JrPlant(config)
    n_steps = round(config["duration_ms"] / DT_MS)
    times, y0s, qs = [0.0], [plant.read()["y0"]], [plant.read()["q_nAm"]]
    times4, eegs = [0.0], [plant.read()["eeg_uv"]]
    for s in range(1, n_steps + 1):
        r = plant.step(0.0)
        times.append(r["t_ms"])
        y0s.append(r["y0"])
        qs.append(r["q_nAm"])
        if s % CONTROL_TICK_STEPS == 0:
            times4.append(r["t_ms"])
            eegs.append(r["eeg_uv"])
    baseline_y0 = plant.baseline_y0
    if config.get("limit_cycle"):
        settle = config.get("settle_ms", 2000.0)
        seg = [y for t, y in zip(times, y0s) if t >= settle]
        baseline_y0 = sum(seg) / len(seg)
        qs = [moment_nAm(y, baseline_y0) for y in y0s]
        eegs = [qs[round(t / DT_MS)] * PZ_GAIN_UV_PER_NAM for t in times4]
    return dict(config=config, times_ms=times, y0_mv=y0s, q_nAm=qs,
                times_ms4=times4, eeg_uv_pz=eegs,
                effective_drives_per_s=plant.effective_drives(),
                baseline_y0_mv=baseline_y0)


# ---------------------------------------------------------------- comparison helpers

def _peak(values):
    i = max(range(len(values)), key=lambda k: abs(values[k]))
    return abs(values[i]), i


def _rms(values):
    return math.sqrt(sum(v * v for v in values) / len(values))


def _welch_peak_hz(y0_4ms):
    """Welch PSD 峰值（y0，去均值；Hann 周期窗、50% 重叠，与 TS welchPsd 同口径）。"""
    import numpy as np
    x = np.asarray(y0_4ms, dtype=float)
    x = x - x.mean()
    fs = 250.0
    n_fft = 256
    while n_fft * 2 <= len(x) and n_fft < 1024:
        n_fft *= 2
    if n_fft > len(x):
        n_fft = 1
        while n_fft * 2 <= len(x):
            n_fft *= 2
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n_fft) / n_fft)
    win_e = float((win ** 2).sum())
    step = max(1, round(n_fft * 0.5))
    acc = np.zeros(n_fft // 2 + 1)
    n_seg = 0
    for start in range(0, len(x) - n_fft + 1, step):
        seg = x[start:start + n_fft] * win
        spec = np.fft.rfft(seg, n=n_fft)
        p = (np.abs(spec) ** 2) / (fs * win_e)
        p[1:-1] *= 2
        acc += p
        n_seg += 1
    psd = acc / max(n_seg, 1)
    freqs = np.fft.rfftfreq(n_fft, 1 / fs)
    band = (freqs >= 1)
    return float(freqs[band][int(np.argmax(psd[band]))])


def _erp_peak(run):
    """事件锁定平均 ERP 峰值（Pz，窗 −200–800 ms，基线 −200–0 ms，峰窗 0–600 ms）。"""
    events = run["config"].get("events", [])
    if not events:
        return None
    eeg = run["eeg_uv_pz"]
    times4 = run["times_ms4"]
    dt = 4.0
    n_t = round(1000 / dt) + 1  # −200..800 ms
    base_idx = [j for j in range(n_t) if -200 <= -200 + j * dt <= 0]
    trials = []
    for ev in events:
        i_ev = round(ev["t_ms"] / dt)
        i0 = i_ev + round(-200 / dt)
        i1 = i0 + n_t - 1
        if i0 < 0 or i1 >= len(eeg):
            continue
        ep = [eeg[i0 + j] for j in range(n_t)]
        base = sum(ep[j] for j in base_idx) / len(base_idx)
        trials.append([v - base for v in ep])
    if not trials:
        return None
    mean = [sum(t[j] for t in trials) / len(trials) for j in range(n_t)]
    rel = [-200 + j * dt for j in range(n_t)]
    cand = [(abs(v), v, t) for v, t in zip(mean, rel) if 0 <= t <= 600]
    _, peak, lat = max(cand)
    return dict(peak_uv=peak, latency_ms=lat)


def compare_runs(a, b):
    if len(a["times_ms"]) != len(b["times_ms"]) or any(
            abs(x - y) > 1e-9 for x, y in zip(a["times_ms"], b["times_ms"])):
        raise ValueError("compare_runs: runs must share the same time axis")
    pk_a, i_a = _peak(a["y0_mv"])
    pk_b, i_b = _peak(b["y0_mv"])
    psd_a = _welch_peak_hz(a["y0_mv"][::CONTROL_TICK_STEPS])
    psd_b = _welch_peak_hz(b["y0_mv"][::CONTROL_TICK_STEPS])
    erp_a = _erp_peak(a)
    erp_b = _erp_peak(b)
    max_diff = max(abs(x - y) for x, y in zip(a["y0_mv"], b["y0_mv"]))
    mean_diff = sum(abs(x - y) for x, y in zip(a["y0_mv"], b["y0_mv"])) / len(a["y0_mv"])
    return dict(
        shared_times_ms=True,
        peak_y0_diff_mv=pk_b - pk_a, peak_y0_a=pk_a, peak_y0_b=pk_b,
        peak_time_diff_ms=b["times_ms"][i_b] - a["times_ms"][i_a],
        rms_eeg_diff_uv=_rms(b["eeg_uv_pz"]) - _rms(a["eeg_uv_pz"]),
        max_abs_y0_diff_mv=max_diff, mean_abs_y0_diff_mv=mean_diff,
        psd_peak_hz_a=psd_a, psd_peak_hz_b=psd_b, psd_peak_shift_hz=psd_b - psd_a,
        erp_peak_diff_uv=(erp_b["peak_uv"] - erp_a["peak_uv"]) if erp_a and erp_b else float("nan"),
        erp_peak_a=erp_a["peak_uv"] if erp_a else float("nan"),
        erp_peak_b=erp_b["peak_uv"] if erp_b else float("nan"),
        erp_latency_diff_ms=(erp_b["latency_ms"] - erp_a["latency_ms"]) if erp_a and erp_b else float("nan"),
        effective_drives_a=list(a["effective_drives_per_s"]),
        effective_drives_b=list(b["effective_drives_per_s"]),
    )


def run_ab(config_a, config_b):
    a = run_single_experiment(config_a)
    b = run_single_experiment(config_b)
    return dict(a=a, b=b, comparison=compare_runs(a, b))


# ---------------------------------------------------------------- PID

class PidController:
    """位置式 PID + 条件积分抗饱和（与 TS 同律）。"""

    def __init__(self, params):
        self.kp = params["kp"]
        self.ki = params["ki"]
        self.kd = params["kd"]
        self.setpoint = params["setpoint"]
        self.out_min = params.get("output_min_per_s", -90.0)
        self.out_max = params.get("output_max_per_s", 300.0)
        self.integral_clamp = params.get("integral_clamp", math.inf)
        self.integral = 0.0
        self.prev_error = None

    def step(self, measurement, dt_ms):
        dt_s = dt_ms / 1000.0
        e = self.setpoint - measurement
        deriv = 0.0 if self.prev_error is None else (e - self.prev_error) / dt_s
        trial = self.kp * e + self.ki * self.integral + self.kd * deriv
        pushing = (trial > self.out_max and e > 0) or (trial < self.out_min and e < 0)
        if not pushing:
            self.integral += e * dt_s
            self.integral = max(-self.integral_clamp, min(self.integral_clamp, self.integral))
        self.prev_error = e
        u = self.kp * e + self.ki * self.integral + self.kd * deriv
        return max(self.out_min, min(self.out_max, u))


def simulate_pid_step_response(pid_params, plant_tau_ms, duration_ms,
                                dt_ms=CONTROL_DT_MS, x0=0.0):
    pid = PidController(pid_params)
    n = round(duration_ms / dt_ms)
    times, xs, us = [0.0], [x0], [0.0]
    cur = x0
    for i in range(1, n + 1):
        ui = pid.step(cur, dt_ms)
        cur += (ui - cur) * (1 - math.exp(-dt_ms / plant_tau_ms))
        times.append(i * dt_ms)
        xs.append(cur)
        us.append(ui)
    sp = pid_params["setpoint"]
    band = 0.02 * abs(sp)
    peak = max(xs)
    overshoot = 0.0 if sp == 0 else max(0.0, peak - sp) / abs(sp) * 100
    settling = None
    for i in range(len(xs) - 1, -1, -1):
        if abs(xs[i] - sp) > band:
            settling = times[i + 1] if i + 1 < len(xs) else None
            break
        if i == 0:
            settling = 0.0
    return dict(times_ms=times, x=xs, u=us, overshoot_pct=overshoot,
                settling_time_ms=settling, steady_state_error=sp - xs[-1])


# ---------------------------------------------------------------- feature + closed loop

def goertzel_power(samples, freq_hz, sfreq_hz):
    n = len(samples)
    if n == 0:
        raise ValueError("goertzel_power: empty window")
    w = 2 * math.pi * freq_hz / sfreq_hz
    coeff = 2 * math.cos(w)
    s0 = s1 = s2 = 0.0
    for v in samples:
        s0 = v + coeff * s1 - s2
        s2 = s1
        s1 = s0
    re = s1 * math.cos(w * (n - 1)) - s2 * math.cos(w * n)
    im = -(s1 * math.sin(w * (n - 1)) - s2 * math.sin(w * n))
    amp = 2 * math.hypot(re, im) / n
    return amp * amp / 2


class FeatureExtractor:
    def __init__(self, config):
        self.kind = config["kind"]
        window_ms = config.get("window_ms", 252.0)
        self.window_samples = max(1, round(window_ms / CONTROL_DT_MS))
        self.target_freq_hz = config.get("target_freq_hz", 10.0)
        self.window = []

    def push(self, sample_uv):
        self.window.append(sample_uv)
        if len(self.window) > self.window_samples:
            self.window.pop(0)
        if self.kind == "instant":
            return sample_uv
        if self.kind == "rms":
            return math.sqrt(sum(v * v for v in self.window) / len(self.window))
        return goertzel_power(self.window, self.target_freq_hz, 250.0)


def run_closed_loop(config):
    base = config["base"]
    delay_ms = config.get("delay_ms", 0.0)
    noise_rms = config.get("measurement_noise_rms_uv", 0.0)
    mode = config.get("controller", "off")
    if mode == "threshold" and "threshold" not in config:
        raise ValueError("threshold mode needs a threshold config")
    if mode == "pid" and "pid" not in config:
        raise ValueError("pid mode needs pid params")
    plant = JrPlant(base)
    extractor = FeatureExtractor(config.get("feature", dict(kind="alphaPower")))
    pid = PidController(config["pid"]) if mode == "pid" else None
    delay_ticks = round(delay_ms / CONTROL_DT_MS)
    delay_queue = []
    noise_seed = config.get("noise_seed", 7)
    n_ticks = round(base["duration_ms"] / CONTROL_DT_MS)
    times, feature, commanded, applied = [0.0], [], [], []
    eegs, y0s, triggered = [plant.read()["eeg_uv"]], [plant.read()["y0"]], []
    for tick in range(n_ticks):
        r = plant.read()
        noisy = r["eeg_uv"] + (noise_rms * indexed_gaussian(noise_seed, tick) if noise_rms > 0 else 0.0)
        f = extractor.push(noisy)
        cmd = 0.0
        if mode == "threshold":
            th = config["threshold"]
            cmd = th.get("output_per_s", -80.0) if f > th["threshold"] else 0.0
        elif mode == "pid" and pid is not None:
            cmd = pid.step(f, CONTROL_DT_MS)
        feature.append(f)
        commanded.append(cmd)
        delay_queue.append(cmd)
        app = delay_queue.pop(0) if len(delay_queue) > delay_ticks else 0.0
        applied.append(app)
        triggered.append(app != 0.0)
        for _ in range(CONTROL_TICK_STEPS):
            plant.step(app)
        r2 = plant.read()
        times.append(r2["t_ms"])
        eegs.append(r2["eeg_uv"])
        y0s.append(r2["y0"])
    max_y0 = max(abs(v) for v in y0s)
    max_eeg = max(abs(v) for v in eegs)
    diverged = (not all(math.isfinite(v) for v in y0s + eegs)) or max_y0 > 100
    n_trig = sum(1 for t in triggered if t)
    first_idx = next((i for i, t in enumerate(triggered) if t), -1)
    evs = base.get("events", [])
    first_event = min((e["t_ms"] for e in evs), default=None)
    metrics = dict(
        trigger_fraction=n_trig / len(triggered) if triggered else 0.0,
        first_trigger_ms=times[first_idx] if first_idx >= 0 else None,
        response_latency_ms=(times[first_idx] - first_event) if first_idx >= 0 and first_event is not None else None,
        max_abs_control_per_s=max((abs(v) for v in applied), default=0.0),
        max_abs_y0_mv=max_y0, max_abs_eeg_uv=max_eeg,
        rms_y0_mv=_rms(y0s), rms_eeg_uv=_rms(eegs),
        diverged=diverged, delay_ms=delay_ms,
    )
    return dict(config=config, times_ms=times, feature=feature,
                commanded_per_s=commanded, applied_per_s=applied,
                eeg_uv_pz=eegs, y0_mv=y0s, triggered=triggered, metrics=metrics)


# ---------------------------------------------------------------- time machine (light)

class TimeMachine:
    """时间机器（开环）：单步 / 历史快照 / 回放 / 恢复 / 分支。"""

    def __init__(self, config, snapshot_interval_ms=10.0):
        self.config = config
        self.plant = JrPlant(config)
        self.snapshot_interval_ms = snapshot_interval_ms
        self.history = []
        self._steps_since = 0
        self.paused = False
        self._record()

    def _record(self):
        snap = self.plant.snapshot()
        snap["readout"] = self.plant.read()
        self.history.append(snap)

    def step(self, control=0.0):
        if self.paused:
            return None
        r = self.plant.step(control)
        self._steps_since += 1
        if self._steps_since * DT_MS >= self.snapshot_interval_ms - 1e-9:
            self._record()
            self._steps_since = 0
        return r

    def step_to(self, t_ms):
        n = round((t_ms - self.plant.t_ms) / DT_MS)
        for _ in range(n):
            self.step()

    def replay(self, t0, t1):
        return [s for s in self.history if t0 - 1e-9 <= s["t_ms"] <= t1 + 1e-9]

    def restore(self, snap):
        self.plant.restore(snap)
        self.history = [s for s in self.history if s["t_ms"] <= snap["t_ms"] + 1e-9]
        # 恢复点本身就是一份快照：历史里没有它时补进，否则分支点处少一个快照。
        if not self.history or abs(self.history[-1]["t_ms"] - snap["t_ms"]) > 1e-9:
            self.history.append(snap)
        self._steps_since = 0

    def fork(self, snap, patch):
        cfg = dict(self.config)
        cfg.update(patch)
        nxt = TimeMachine(cfg, self.snapshot_interval_ms)
        nxt.plant.restore(snap)
        nxt.history = [s for s in self.history if s["t_ms"] <= snap["t_ms"] + 1e-9]
        nxt._steps_since = 0
        return nxt


# ---------------------------------------------------------------- fixture / self-check

def build_fixture():
    free_cfg = dict(duration_ms=2000.0,
                    events=[dict(t_ms=1000.0, drive_per_s=120.0, duration_ms=100.0)])
    free = run_single_experiment(free_cfg)
    # PID 阶跃：kp=2、ki=10、τ=200 ms、设定点 1.0（实测：超调 0%、安定 ~388 ms）。
    pid_params = dict(kp=2.0, ki=10.0, kd=0.0, setpoint=1.0)
    pid_step = simulate_pid_step_response(pid_params, 200.0, 3000.0)
    # 阈值触发：瞬时特征、阈值 0.1 µV、输出 −80 1/s、测量噪声 0.02 µV
    #（响应峰 Pz ≈ 0.19 µV；阈值 0.5 µV 高于峰值、永不触发，见文档）。
    thr_cfg = dict(base=dict(duration_ms=3000.0,
                             events=[dict(t_ms=1000.0, drive_per_s=300.0, duration_ms=100.0)]),
                   feature=dict(kind="instant"),
                   controller="threshold",
                   threshold=dict(threshold=0.1, output_per_s=-80.0),
                   measurement_noise_rms_uv=0.02, noise_seed=7)
    thr = run_closed_loop(thr_cfg)
    # 有控制 vs 无控制（同一 base，阈值抑制）。
    noctl = run_closed_loop(dict(base=thr_cfg["base"], controller="off"))
    ctl_vs_noctl = dict(
        rms_eeg_diff_uv=thr["metrics"]["rms_eeg_uv"] - noctl["metrics"]["rms_eeg_uv"],
        peak_eeg_diff_uv=thr["metrics"]["max_abs_eeg_uv"] - noctl["metrics"]["max_abs_eeg_uv"],
        rms_eeg_noctl_uv=noctl["metrics"]["rms_eeg_uv"],
        rms_eeg_ctl_uv=thr["metrics"]["rms_eeg_uv"],
        trigger_fraction=thr["metrics"]["trigger_fraction"])
    ab = run_ab(dict(duration_ms=2000.0,
                     events=[dict(t_ms=1000.0, drive_per_s=120.0, duration_ms=100.0)]),
                dict(duration_ms=2000.0,
                     events=[dict(t_ms=1000.0, drive_per_s=300.0, duration_ms=100.0)]))
    # 分支点重现：跑 2000 ms，在 1000 ms 快照处恢复重跑。
    tm = TimeMachine(free_cfg)
    tm.step_to(2000.0)
    snap1000 = next(s for s in tm.history if abs(s["t_ms"] - 1000.0) < 1e-9)
    tm2 = TimeMachine(free_cfg)
    tm2.plant.restore(snap1000)
    tm2.history = [s for s in tm.history if s["t_ms"] <= 1000.0 + 1e-9]
    tm2.step_to(2000.0)
    y_orig = [s["readout"]["y0"] for s in tm.history if s["t_ms"] >= 1000.0 - 1e-9]
    y_re = [s["readout"]["y0"] for s in tm2.history if s["t_ms"] >= 1000.0 - 1e-9]
    branch_replay_max_diff = max(abs(a - b) for a, b in zip(y_orig, y_re))
    # 分支改参数：1000 ms 处把驱动改成 300。
    tm3 = tm.fork(snap1000, dict(events=[dict(t_ms=1000.0, drive_per_s=300.0, duration_ms=100.0)]))
    tm3.step_to(2000.0)
    y_br = [s["readout"]["y0"] for s in tm3.history if s["t_ms"] >= 1000.0 - 1e-9]
    branch_diverge_max_diff = max(abs(a - b) for a, b in zip(y_orig, y_br))
    # 适应：5 次重复驱动，U=0.5，τ=1000 ms。
    adapt_cfg = dict(duration_ms=2000.0,
                     events=[dict(t_ms=1000.0 + 200 * k, drive_per_s=300.0, duration_ms=40.0)
                             for k in range(5)],
                     adaptation=dict(utilization=0.5, tau_rec_ms=1000.0))
    adapt = run_single_experiment(adapt_cfg)
    # 纯噪声误触发：无事件，alpha 功率特征，阈值 0.05 µV²，噪声 0.5 µV。
    noise_cfg = dict(base=dict(duration_ms=5000.0),
                     feature=dict(kind="alphaPower"),
                     controller="threshold",
                     threshold=dict(threshold=0.05, output_per_s=-80.0),
                     measurement_noise_rms_uv=0.5, noise_seed=7)
    noise_run = run_closed_loop(noise_cfg)
    # 误触发率以后 300 ms（滑窗 252 ms 建满之后）计：前 252 ms 窗未满、
    # 功率估计方差大，误触发主要来自建窗期，不是稳态行为。
    post_trig = [t for t, tt in zip(noise_run["triggered"], noise_run["times_ms"]) if tt >= 300.0]
    noise_post_frac = sum(post_trig) / len(post_trig) if post_trig else 0.0
    # 20 s 稳定性（闭环阈值，有事件；阈值 0.1 µV，控制器实际触发）。
    stab_cfg = dict(base=dict(duration_ms=20000.0,
                              events=[dict(t_ms=1000.0, drive_per_s=300.0, duration_ms=100.0)]),
                    feature=dict(kind="instant"),
                    controller="threshold",
                    threshold=dict(threshold=0.1, output_per_s=-80.0),
                    measurement_noise_rms_uv=0.02, noise_seed=7)
    stab = run_closed_loop(stab_cfg)
    return dict(
        generated_by="reference/python-model/experiments_pr7.py",
        free_run=dict(times_ms4=free["times_ms4"], y0_4ms=free["y0_mv"][::CONTROL_TICK_STEPS],
                      q_nAm_4ms=free["q_nAm"][::CONTROL_TICK_STEPS],
                      eeg_uv_pz=free["eeg_uv_pz"]),
        pid_step=dict(overshoot_pct=pid_step["overshoot_pct"],
                      settling_time_ms=pid_step["settling_time_ms"],
                      steady_state_error=pid_step["steady_state_error"],
                      x_final=pid_step["x"][-1], u_final=pid_step["u"][-1]),
        threshold=dict(first_trigger_ms=thr["metrics"]["first_trigger_ms"],
                       response_latency_ms=thr["metrics"]["response_latency_ms"],
                       trigger_fraction=thr["metrics"]["trigger_fraction"],
                       max_abs_eeg_uv=thr["metrics"]["max_abs_eeg_uv"]),
        control_vs_no_control=ctl_vs_noctl,
        ab_comparison=ab["comparison"],
        branch=dict(replay_max_diff_mv=branch_replay_max_diff,
                    diverge_max_diff_mv=branch_diverge_max_diff),
        adaptation=dict(effective_drives_per_s=adapt["effective_drives_per_s"]),
        noise_only=dict(trigger_fraction=noise_run["metrics"]["trigger_fraction"],
                        post_warmup_trigger_fraction=noise_post_frac,
                        first_trigger_ms=noise_run["metrics"]["first_trigger_ms"]),
        stability_20s=dict(max_abs_y0_mv=stab["metrics"]["max_abs_y0_mv"],
                           diverged=stab["metrics"]["diverged"],
                           trigger_fraction=stab["metrics"]["trigger_fraction"]),
    )


def self_check():
    fx = build_fixture()
    print("free-run y0[1000ms] =", fx["free_run"]["y0_4ms"][250])
    print("free-run q peak =", max(abs(v) for v in fx["free_run"]["q_nAm_4ms"]), "nA·m")
    print("PID step: overshoot %.3f%%, settling %s ms, steady err %.6f"
          % (fx["pid_step"]["overshoot_pct"], fx["pid_step"]["settling_time_ms"],
             fx["pid_step"]["steady_state_error"]))
    print("threshold: first trigger", fx["threshold"]["first_trigger_ms"],
          "ms, latency", fx["threshold"]["response_latency_ms"], "ms")
    print("control vs no-control: rms diff", fx["control_vs_no_control"]["rms_eeg_diff_uv"], "µV")
    print("AB peak y0 diff =", fx["ab_comparison"]["peak_y0_diff_mv"], "mV")
    print("AB PSD peaks =", fx["ab_comparison"]["psd_peak_hz_a"],
          "->", fx["ab_comparison"]["psd_peak_hz_b"], "Hz")
    print("branch replay max diff =", fx["branch"]["replay_max_diff_mv"], "mV")
    print("branch diverge max diff =", fx["branch"]["diverge_max_diff_mv"], "mV")
    print("adaptation effective drives =", fx["adaptation"]["effective_drives_per_s"])
    print("noise-only false trigger rate =", fx["noise_only"]["trigger_fraction"],
          "(post-warmup", fx["noise_only"]["post_warmup_trigger_fraction"], ")")
    print("stability 20s max|y0| =", fx["stability_20s"]["max_abs_y0_mv"], "mV")
    return fx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write-fixture", action="store_true")
    args = ap.parse_args()
    fx = self_check()
    if args.write_fixture:
        root = Path(__file__).resolve().parents[2]
        out = root / "tests" / "pr7" / "fixtures" / "experiments-reference.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(fx, indent=2))
        print("wrote", out)


if __name__ == "__main__":
    main()
