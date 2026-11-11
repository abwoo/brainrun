"""Smoke screenshots for the Jansen-Rit panel in LocalBEMLab.

Scope (per the 2026-11-11 test-rhythm rule): ONLY the newly added JR
panel, at 1920x1080 and 978px, checking for overlap / clipped content.
No full-site layout sweep, no PR1-PR4 regression, no performance run.

Serves the production build with `npm run preview` on 127.0.0.1:4173
(starts it if it is not already up; leaves a pre-existing server alone),
opens the app, navigates HEAD EEG ->进阶 MRI/BEM, uploads a SYNTHETIC
BEM model, switches to local-column + Jansen-Rit, stimulates, and
screenshots tests/pr5/shots/jr-panel-1920.png and jr-panel-978.png.

The synthetic model is a layout fixture ONLY: it passes
validateFsaverageBEM structurally (the validator demands fsaverage
metadata strings) but its gains are toy analytic numbers and its meshes
are tetrahedra. It is generated in /tmp at runtime, never committed, and
must never be presented as real anatomy or a real lead field.
"""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHOTS = Path(__file__).resolve().parent / "shots"
SHOTS.mkdir(parents=True, exist_ok=True)
PREVIEW_URL = "http://127.0.0.1:4173/"
MODEL_PATH = Path("/tmp/jr-synthetic-bem-smoke.json")

IDENTITY = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


def tetra(scale, center):
    cx, cy, cz = center
    verts = [[cx + scale, cy, cz], [cx - scale, cy, cz],
             [cx, cy + scale, cz], [cx, cy, cz + scale]]
    return {"vertices_head_mm": verts, "triangles": [[0, 1, 2], [0, 1, 3],
                                                     [0, 2, 3], [1, 2, 3]]}


def build_synthetic_model():
    # Two sources, three electrodes, toy gains (rows length 3*n_sources).
    model = {
        "synthetic_smoke_fixture": True,
        "note": ("LAYOUT ONLY. Toy analytic gains and tetrahedron meshes. "
                 "Not fsaverage anatomy, not a real lead field."),
        "model_id": "fsaverage-mne-three-layer-bem-v1",
        "subject": "fsaverage",
        "subject_type": "average",
        "montage": "standard_1020",
        "frame": "HEAD_RAS_MM",
        "gain_unit": "uV_per_nA_m",
        "source_moment_unit": "nA_m",
        "interpolation": "none (nearest validated source)",
        "license_status": "REVIEW_REQUIRED_FREESURFER_DERIVED_ASSET",
        "transform_mri_to_head_rowmajor": IDENTITY,
        "transform_mri_to_mni305_rowmajor": IDENTITY,
        "standard_coordinate_definition": "MNI305 (mni_tal), not MNI152",
        "source_positions": [
            {"hemisphere": "lh", "vertex": 0, "head_mm": [-40, 10, 60],
             "normal_head_unit": [0, 0, 1], "mni305_mm": [-40, 10, 60],
             "atlas": "aparc", "region": "precentral"},
            {"hemisphere": "rh", "vertex": 1, "head_mm": [40, 10, 60],
             "normal_head_unit": [0, 1, 0], "mni305_mm": [40, 10, 60],
             "atlas": "aparc", "region": "precentral"},
        ],
        "electrodes": [
            {"label": "Cz", "head_mm": [0, 0, 95]},
            {"label": "Pz", "head_mm": [0, -40, 85]},
            {"label": "Fz", "head_mm": [0, 40, 85]},
        ],
        "gains_uV_per_nAm": [
            [0.5, 0.3, 4.0, 0.2, 0.1, 1.0],
            [0.4, 0.2, 2.0, 0.3, 0.2, 0.5],
            [0.6, 0.4, 3.0, 0.1, 0.3, 0.8],
        ],
        "meshes": {
            "scalp": tetra(95, [0, 0, 0]),
            "skull": tetra(85, [0, 0, 0]),
            "brain": tetra(75, [0, 0, 0]),
            "cortex": {"lh": tetra(60, [-20, 0, 20]),
                       "rh": tetra(60, [20, 0, 20])},
        },
    }
    MODEL_PATH.write_text(json.dumps(model))
    return MODEL_PATH


def preview_up():
    try:
        with urllib.request.urlopen(PREVIEW_URL, timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def main():
    build_synthetic_model()
    proc = None
    if not preview_up():
        proc = subprocess.Popen(
            ["npm", "run", "preview", "--", "--port", "4173",
             "--host", "127.0.0.1"],
            cwd=str(ROOT / "app"),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(30):
            if preview_up():
                break
            time.sleep(1)
        assert preview_up(), "preview server did not come up on 4173"
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=[
                "--use-gl=angle", "--use-angle=swiftshader",
                "--enable-webgl", "--no-sandbox"])
            for width, height, name in [
                    (1920, 1080, "jr-panel-1920.png"),
                    (978, 800, "jr-panel-978.png")]:
                page = browser.new_page(viewport={"width": width,
                                                  "height": height})
                page.set_default_timeout(60000)
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(PREVIEW_URL, wait_until="load")
                page.get_by_role("button", name="HEAD EEG").wait_for(
                    state="visible", timeout=60000)
                page.get_by_role("button", name="HEAD EEG").click()
                page.get_by_label("打开本地真实 MRI BEM").click()
                dialog = page.get_by_role(
                    "dialog", name="真实模板 MRI BEM 实验")
                dialog.wait_for()
                dialog.get_by_label("导入本地 BEM 模型").set_input_files(
                    str(MODEL_PATH))
                dialog.get_by_label("皮层源位置").wait_for()
                dialog.get_by_label("BEM物理源模式").select_option(
                    "local-column")
                dialog.get_by_label("局部源模型").select_option("jr")
                dialog.get_by_role("button", name="施加局部刺激").click()
                page.wait_for_timeout(3000)
                # Layout checks on the new panel only.
                checks = page.evaluate("""() => {
                  const dialog = document.querySelector('[role="dialog"]');
                  const body = dialog.querySelector('.modal-body');
                  const grid = [...document.querySelectorAll('.conn-title')]
                    .find(el => el.textContent.includes('并排比较'));
                  const panel = grid ? grid.nextElementSibling : null;
                  const cards = panel ? [...panel.children] : [];
                  const boxes = cards.map(c => c.getBoundingClientRect());
                  const overlap = boxes.length === 2 &&
                    boxes[0].right > boxes[1].left + 1;
                  const jrTrace = [...document.querySelectorAll('svg')]
                    .find(s => (s.getAttribute('aria-label') || '')
                      .includes('Jansen–Rit 偶极矩'));
                  const wcTrace = [...document.querySelectorAll('svg')]
                    .find(s => (s.getAttribute('aria-label') || '')
                      .includes('Wilson–Cowan 偶极矩'));
                  return {
                    hOverflow: body.scrollWidth > body.clientWidth + 1,
                    cards: boxes.length, overlap,
                    jrTraceVisible: !!jrTrace && jrTrace.getBoundingClientRect().width > 50,
                    wcTraceVisible: !!wcTrace && wcTrace.getBoundingClientRect().width > 50,
                    jrQ: (document.body.innerText.match(/Jansen–Rit · q (-?[0-9.]+) nA·m/) || [])[1] || null,
                    wcQ: (document.body.innerText.match(/Wilson–Cowan · q (-?[0-9.]+) nA·m/) || [])[1] || null,
                  };
                }""")
                assert not errors, f"page errors: {errors}"
                assert not checks["hOverflow"], f"horizontal overflow at {width}px"
                assert checks["cards"] == 2, f"comparison cards: {checks['cards']}"
                assert not checks["overlap"], "WC/JR cards overlap"
                assert checks["jrTraceVisible"] and checks["wcTraceVisible"], \
                    f"traces not visible: {checks}"
                print(f"{width}x{height}: checks OK {checks}")
                page.screenshot(path=str(SHOTS / name))
                print(f"wrote {SHOTS / name}")
                page.close()
            browser.close()
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    sys.exit(main())
