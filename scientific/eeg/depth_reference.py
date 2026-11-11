"""PR-15 拉伸项 — MNE 深度偏置的 Python 同公式实现（numpy）。

与 `app/src/lib/depthWeightedInverse.ts` 同式对照：
- 深度加权 MNE：R = diag(w_j²)，w_j = ||L_j||^(−depth)，depth 默认 0.8；
  s = R Lᵀ (L R Lᵀ + λ²σ²I)⁻¹ V。
- dSPM：G = R Lᵀ (L R Lᵀ + λ²σ²I)⁻¹，dSPM_j = |s_j| / √(Σ_c (G C Gᵀ)_{j,c})，
  C = σ²I；depth = 0 用 plain 算子。
- eLORETA（标量近似）：w_j ← √(trace(B_j)/3)，B = Lᵀ (L W⁻¹ Lᵀ + λ²σ²I)⁻¹ L
  的第 j 个 3×3 对角块；R = W⁻¹。

跑法（MNE 1.11.0 环境用 ~/workspace/eeg-venv/bin/python）：
    python scientific/eeg/depth_reference.py            # 自检并打印对照表
    python scientific/eeg/depth_reference.py --write-fixture
        # 生成 tests/pr7/fixtures/depth-reference.json（TS 测试对照用）
    python -m unittest discover -s tests/pr7 -p 'test_depth_weighted.py' -v

注意：球形正向模型须先生成（CI/本地）：
    ~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py
"""

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SPHERE_PATH = ROOT / "app" / "public" / "forward-assets" / "sphere-model.json"

DEPTH_DEFAULT = 0.8
LAMBDA2_DEFAULT = 1 / 9
NOISE_RMS_UV_DEFAULT = 1.0
ELORETA_MAX_ITER = 20
ELORETA_TOL = 1e-3


def load_sphere():
    fx = json.loads(SPHERE_PATH.read_text(encoding="utf-8"))
    return fx


def build_lead_field(fixture, montage="10-20", reference="average"):
    gains = np.asarray(fixture["gain_uv_per_nAm"], dtype=float)
    labels = fixture["montages"][montage]
    sidx = [next(i for i, s in enumerate(fixture["sensors"]) if s["label"] == lab)
            for lab in labels]
    L = gains[sidx].copy()
    if reference == "average":
        L = L - L.mean(axis=0, keepdims=True)
    elif reference == "electrode":
        raise ValueError("electrode reference needs a label; use average/infinity here")
    axis = np.asarray(fixture["source_grid_axis_mm"], dtype=float)
    pos = np.array([[x, y, z] for x in axis for y in axis for z in axis], dtype=float)
    return L, labels, pos


def forward_data(fixture, montage, true_position_mm, true_moment_nAm,
                 reference="average"):
    """已知源 → 正向 EEG（网格点上用精确列增益；与 TS 的插值在网格点处一致）。"""
    L, labels, pos = build_lead_field(fixture, montage, reference)
    d = np.linalg.norm(pos - np.asarray(true_position_mm, dtype=float), axis=1)
    s = int(np.argmin(d))
    if d[s] > 1e-9:
        raise ValueError("forward_data: true position must be on the source grid")
    # 注意：lead field 已做参考变换；数据侧用同一变换后的列增益。
    V = L[:, 3 * s:3 * s + 3] @ np.asarray(true_moment_nAm, dtype=float)
    return V, labels


def column_norms(L):
    n_src = L.shape[1] // 3
    return np.linalg.norm(L.reshape(L.shape[0], n_src, 3), axis=(0, 2))


def depth_weights(L, depth):
    return column_norms(L) ** (-depth)


def _solve_with_R(L, V, r_diag, lambda2, noise_rms_uv):
    reg = lambda2 * noise_rms_uv ** 2
    A = (L * r_diag) @ L.T + reg * np.eye(L.shape[0])
    y = np.linalg.solve(A, V)
    s = r_diag * (L.T @ y)
    return s, np.linalg.inv(A)


def _peak_and_spread(s, pos, already_norms=False):
    norms = np.asarray(s, dtype=float) if already_norms else np.linalg.norm(
        np.asarray(s, dtype=float).reshape(-1, 3), axis=1)
    i = int(np.argmax(norms))
    w = norms ** 2
    spread = float(np.sqrt(np.sum(w * np.sum((pos - pos[i]) ** 2, axis=1)) / np.sum(w)))
    return dict(estimated_position_mm=[float(v) for v in pos[i]],
                peak_value=float(norms[i]), spread_mm=spread, grid_index=i,
                source_norms=[float(v) for v in norms])


def depth_weighted_mne(L, V, pos, lambda2=LAMBDA2_DEFAULT,
                       noise_rms_uv=NOISE_RMS_UV_DEFAULT, depth=DEPTH_DEFAULT):
    w = depth_weights(L, depth)
    r_diag = np.repeat(w ** 2, 3)
    s, _ = _solve_with_R(L, V, r_diag, lambda2, noise_rms_uv)
    out = _peak_and_spread(s, pos)
    out.update(method="MNE-depth", lambda2=lambda2, noise_rms_uv=noise_rms_uv, depth=depth)
    return out


def mne_plain(L, V, pos, lambda2=LAMBDA2_DEFAULT, noise_rms_uv=NOISE_RMS_UV_DEFAULT):
    s, _ = _solve_with_R(L, V, np.ones(L.shape[1]), lambda2, noise_rms_uv)
    out = _peak_and_spread(s, pos)
    out.update(method="MNE", lambda2=lambda2, noise_rms_uv=noise_rms_uv, depth=0.0)
    return out


def dspm(L, V, pos, lambda2=LAMBDA2_DEFAULT, noise_rms_uv=NOISE_RMS_UV_DEFAULT, depth=0.0):
    w = depth_weights(L, depth)
    r_diag = np.repeat(w ** 2, 3)
    s, a_inv = _solve_with_R(L, V, r_diag, lambda2, noise_rms_uv)
    G = (r_diag[:, None] * (L.T @ a_inv))
    noise_var = np.sum(G ** 2, axis=1) * noise_rms_uv ** 2
    norms = np.linalg.norm(s.reshape(-1, 3), axis=1)
    dspm_vals = norms / np.sqrt(np.sum(noise_var.reshape(-1, 3), axis=1))
    out = _peak_and_spread(dspm_vals, pos, already_norms=True)
    out.update(method="dSPM", lambda2=lambda2, noise_rms_uv=noise_rms_uv, depth=depth,
               dspm_values=[float(v) for v in dspm_vals])
    return out


def eloreta(L, V, pos, lambda2=LAMBDA2_DEFAULT, noise_rms_uv=NOISE_RMS_UV_DEFAULT,
            max_iter=ELORETA_MAX_ITER, tol=ELORETA_TOL):
    n_src = L.shape[1] // 3
    w = np.ones(n_src)
    final_change = math.inf
    iters = 0
    for it in range(max_iter):
        iters = it + 1
        r_diag = np.repeat(1.0 / (w ** 2), 3)
        _, a_inv = _solve_with_R(L, V, r_diag, lambda2, noise_rms_uv)
        B = L.T @ a_inv @ L
        w_new = np.zeros(n_src)
        for j in range(n_src):
            blk = B[3 * j:3 * j + 3, 3 * j:3 * j + 3]
            w_new[j] = math.sqrt(max(np.trace(blk) / 3, 1e-300))
        # 尺度归一化（权重方程尺度不变；不归一化则沿尺度方向坍缩到 1e-150）。
        w_new = w_new / w_new.max()
        final_change = float(np.max(np.abs(w_new - w) / np.maximum(w, 1e-300)))
        w = w_new
        if final_change < tol:
            break
    r_diag = np.repeat(1.0 / (w ** 2), 3)
    s, _ = _solve_with_R(L, V, r_diag, lambda2, noise_rms_uv)
    out = _peak_and_spread(s, pos)
    out.update(method="eLORETA", lambda2=lambda2, noise_rms_uv=noise_rms_uv, depth=0.0,
               iterations=iters, final_max_change=final_change,
               weights=[float(v) for v in w])
    return out


def loc_error(est_pos, true_pos):
    return float(np.linalg.norm(np.asarray(est_pos, dtype=float)
                                - np.asarray(true_pos, dtype=float)))


def evaluate_case(fixture, montage, true_position_mm, true_moment_nAm,
                  noise_rms_uv=0.0, noise_seed=7):
    L, labels, pos = build_lead_field(fixture, montage, "average")
    V, _ = forward_data(fixture, montage, true_position_mm, true_moment_nAm, "average")
    if noise_rms_uv > 0:
        rng = np.random.default_rng(noise_seed)
        V = V + rng.normal(0.0, noise_rms_uv, size=V.shape)
    plain = mne_plain(L, V, pos)
    dw = depth_weighted_mne(L, V, pos)
    ds = dspm(L, V, pos)
    elo = eloreta(L, V, pos)
    for r in (plain, dw, ds, elo):
        r["localization_error_mm"] = loc_error(r["estimated_position_mm"], true_position_mm)
    return dict(data_uv=[float(v) for v in V], labels=labels,
                plain_mne=plain, depth_weighted=dw, dspm=ds, eloreta=elo)


def build_fixture():
    fixture = load_sphere()
    cases = {}
    for name, pos, mom in [("deep", [16, 16, 16], [0, 10, 5]),
                           ("shallow", [48, 48, 48], [0, 10, 5])]:
        cases[name] = evaluate_case(fixture, "10-20", pos, mom)
        cases[name + "_noisy"] = evaluate_case(fixture, "10-20", pos, mom,
                                                noise_rms_uv=0.5, noise_seed=7)
    return dict(generated_by="scientific/eeg/depth_reference.py",
                montage="10-20", reference="average",
                lambda2=LAMBDA2_DEFAULT, noise_rms_uv=NOISE_RMS_UV_DEFAULT,
                depth=DEPTH_DEFAULT, cases=cases)


def self_check():
    fx = build_fixture()
    for name, case in fx["cases"].items():
        print(f"{name}: plain={case['plain_mne']['localization_error_mm']:.2f} mm, "
              f"depth={case['depth_weighted']['localization_error_mm']:.2f} mm, "
              f"dSPM={case['dspm']['localization_error_mm']:.2f} mm, "
              f"eLORETA={case['eloreta']['localization_error_mm']:.2f} mm "
              f"(eLORETA iters={case['eloreta']['iterations']})")
    return fx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write-fixture", action="store_true")
    args = ap.parse_args()
    fx = self_check()
    if args.write_fixture:
        out = ROOT / "tests" / "pr7" / "fixtures" / "depth-reference.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(fx, indent=2), encoding="utf-8")
        print("wrote", out)


if __name__ == "__main__":
    main()
