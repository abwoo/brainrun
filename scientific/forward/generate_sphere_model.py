#!/usr/bin/env python3
"""Generate an independent MNE-Python four-layer spherical EEG forward fixture.

No Internet fetch and no subject data are required. MNE standard montage
coordinates are transformed to the HEAD frame, then projected radially to an
explicit spherical surface. This is a reproducible *sphere approximation*,
NOT a realistic MRI/BEM head or a native-coordinate 10-20 scalp fit.
All output positions are sphere-centred RAS head coordinates in millimetres.
The lead field gives microvolts per nA.m of dipole moment.
"""
import argparse
import json
import sys
from pathlib import Path
import warnings

import mne
import numpy as np

ORIGIN_M = np.array([0.0, 0.0, 0.04])
RADIUS_M = 0.095
GRID_MM = [-48.0, -16.0, 16.0, 48.0]
CORE_1020 = (
    "Fp1 Fp2 F7 F3 Fz F4 F8 T7 C3 Cz C4 T8 "
    "P7 P3 Pz P4 P8 O1 O2"
).split()
MNE_REQUIRED = "1.11.0"
RELATIVE_RADII = (0.90, 0.92, 0.97, 1.0)
SIGMAS_S_M = (0.33, 1.0, 0.004, 0.33)


def create_fixture(skull_sigma=0.004):
    sigmas=(0.33,1.0,skull_sigma,0.33)
    if mne.__version__ != MNE_REQUIRED:
        raise RuntimeError(
            f"Expected MNE {MNE_REQUIRED}, got {mne.__version__}; pin the version"
        )
    electrode_original = {}
    names_by_montage = {}
    for key, name in [("10-10", "standard_1020"), ("10-05", "standard_1005")]:
        montage = mne.channels.make_standard_montage(name)
        info = mne.create_info(montage.ch_names, sfreq=250.0, ch_types="eeg")
        info.set_montage(montage)
        names_by_montage[key] = montage.ch_names
        for ch in info["chs"]:
            electrode_original[ch["ch_name"]] = ch["loc"][:3].copy()
    names_by_montage["10-20"] = CORE_1020
    electrode_names = list(dict.fromkeys(
        names_by_montage["10-05"] + names_by_montage["10-10"]
    ))
    if not all(n in electrode_original for n in CORE_1020):
        raise ValueError("10-20 core electrodes absent from montage")
    info = mne.create_info(electrode_names, sfreq=250.0, ch_types="eeg")
    sensors = []
    for ch in info["chs"]:
        original = electrode_original[ch["ch_name"]]
        radial = original - ORIGIN_M
        normalized = radial / np.linalg.norm(radial)
        sphere_position = ORIGIN_M + RADIUS_M * normalized
        ch["loc"][:3] = sphere_position
        ch["coord_frame"] = mne.io.constants.FIFF.FIFFV_COORD_HEAD
        sensors.append({
            "label": ch["ch_name"],
            "position_mm": np.round((sphere_position - ORIGIN_M) * 1000, 6).tolist(),
            "original_head_mm": np.round(original * 1000, 6).tolist(),
        })
    sphere = mne.make_sphere_model(
        r0=ORIGIN_M, head_radius=RADIUS_M,
        relative_radii=RELATIVE_RADII, sigmas=sigmas, verbose=False,
    )
    coordinates = np.array([
        (x, y, z) for x in GRID_MM for y in GRID_MM for z in GRID_MM
    ])
    if np.max(np.linalg.norm(coordinates, axis=1)) >= (
        RADIUS_M * 1000 * RELATIVE_RADII[0]
    ):
        raise AssertionError("Source grid outside inner brain sphere")
    positions = np.repeat(ORIGIN_M + coordinates * 1e-3, 3, axis=0)
    orientations = np.tile(np.eye(3), (len(coordinates), 1))
    # Dipole amplitudes are defined in A.m; forward matrix maps A.m to V.
    dipoles = mne.Dipole(
        np.arange(len(positions)) * 0.001, positions,
        np.full(len(positions), 1e-9), orientations,
        np.ones(len(positions)),
    )
    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)
        forward, _ = mne.make_forward_dipole(dipoles, sphere, info, verbose=False)
    raw_forward = np.asarray(forward["sol"]["data"], dtype=np.float64)
    gains = raw_forward * (1e-9 * 1e6)  # V/(A.m) -> µV/(nA.m)
    if gains.shape != (len(electrode_names), len(coordinates) * 3):
        raise AssertionError(f"Bad lead field shape {gains.shape}")
    if not np.isfinite(gains).all():
        raise ValueError("Forward lead field contains nonfinite values")

    # A separate scalp mesh is evaluated by the SAME MNE conductor/source grid.
    # It is not derived by smoothing the 19 displayed EEG channels.
    width, height = 32, 16
    scalp_positions = [[0.0, 0.0, RADIUS_M * 1000]]
    for lat in range(1, height):
        theta = np.pi * lat / height
        for lon in range(width):
            phi = 2 * np.pi * lon / width
            scalp_positions.append((RADIUS_M * 1000 * np.array([
                np.sin(theta) * np.cos(phi), np.sin(theta) * np.sin(phi), np.cos(theta)
            ])).tolist())
    south = len(scalp_positions)
    scalp_positions.append([0.0, 0.0, -RADIUS_M * 1000])
    triangles = []
    for lon in range(width):
        nxt = (lon + 1) % width
        triangles.extend([0, 1 + lon, 1 + nxt])
        for lat in range(height - 2):
            a = 1 + lat * width + lon
            b = 1 + (lat + 1) * width + lon
            c = 1 + lat * width + nxt
            d = 1 + (lat + 1) * width + nxt
            triangles.extend([a, b, c, c, b, d])
        last = 1 + (height - 2) * width
        triangles.extend([south, last + nxt, last + lon])
    scalp_info = mne.create_info([f"SCALP{i:04d}" for i in range(len(scalp_positions))],
                                 sfreq=250.0, ch_types="eeg")
    for channel, point in zip(scalp_info["chs"], scalp_positions):
        channel["loc"][:3] = ORIGIN_M + np.asarray(point) * 1e-3
        channel["coord_frame"] = mne.io.constants.FIFF.FIFFV_COORD_HEAD
    scalp_fwd, _ = mne.make_forward_dipole(dipoles, sphere, scalp_info, verbose=False)
    scalp_gains = np.asarray(scalp_fwd["sol"]["data"], dtype=np.float64) * 1e-3
    if not np.isfinite(scalp_gains).all():
        raise ValueError("Nonfinite scalp vertex lead field")

    return {
        "scalp_field_grid": {
            "positions_mm": scalp_positions, "triangles": triangles,
            "gain_uv_per_nAm": np.round(scalp_gains, 9).tolist(),
            "method": "MNE forward values at scalp vertices; triangle colors interpolate only for rendering",
        },
        "model_id": "mne-four-layer-sphere-ras-v1"+("" if skull_sigma==0.004 else f"-skull-{skull_sigma:.3f}"),
        "mne_version": mne.__version__,
        "coordinate_frame": "head-RAS-sphere-centered",
        "origin_in_head_mm": [0.0, 0.0, 40.0],
        "radius_mm": RADIUS_M * 1000,
        "brain_inner_radius_mm": RADIUS_M * 1000 * RELATIVE_RADII[0],
        "relative_radii": RELATIVE_RADII,
        "conductivities_S_m": sigmas,
        "source_grid_axis_mm": GRID_MM,
        "gain_units": "microvolts_per_nanoampere_metre",
        "source_moment_axes": ["x", "y", "z"],
        "method": "MNE make_forward_dipole; four-layer concentric sphere (Mosher/Zhang/Berg)",
        "limitations": (
            "MNE standard montage head-coordinate directions are projected onto a "
            "95 mm radius sphere. No MRI-derived scalp or skull geometry, human connectome, "
            "BEM/FEM, dipole-to-neural-mass calibration, or MNI/Talairach atlas alignment. "
            "Between grid points the browser uses bounded trilinear interpolation."
        ),
        "montages": names_by_montage,
        "sensors": sensors,
        "gain_uv_per_nAm": np.round(gains, 9).tolist(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output", type=Path,
        default=Path(__file__).resolve().parents[2] /
        "app/public/forward-assets/sphere-model.json",
    )
    parser.add_argument('--skull-conductivity',type=float,choices=(0.002,0.004,0.008),default=0.004)
    args = parser.parse_args()
    fixture = create_fixture(args.skull_conductivity)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(fixture, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    print(json.dumps({
        "file": str(args.output),
        "model": fixture["model_id"],
        "channels": len(fixture["sensors"]),
        "grid_points": len(GRID_MM) ** 3,
        "gain_columns": len(fixture["gain_uv_per_nAm"][0]),
        "montages": {k: len(v) for k, v in fixture["montages"].items()},
    }))


if __name__ == "__main__":
    main()
