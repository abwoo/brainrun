"""PR3 formal test: direct manipulation of the network (review §5 problem 3).

Covers, all with expectations derived from the SAME run's debug-bridge data
(no numbers copied from any earlier report; the cross-check reference
numbers live in tests/pr3/crosscheck-compare.py):
  W. weight editing is causal: zeroing the edge 73 -> 54 (W[54][73] 3.0 -> 0)
     drops the downstream peak to <30% of baseline and below the 0.01
     response threshold; doubling 69 -> 40 (W[40][69] 1.0 -> 2.0) enhances
     the downstream peak >1.5x; the edit is single-sided (reverse edge
     untouched); out-of-range values clamp to [0, 3].
  W-ui. CONNECTION panel: per-edge slider + number entry, "modified" badge
     with original value side by side, per-edge restore, restore-all, and
     RESET preserves edited weights (weights are only restored by the
     restore actions).
  B. sustained bias is causal: +0.5 raises node 40's steady E, -0.5 lowers
     it, an unconnected node's baseline (node 0) is unaffected, clearing
     the bias restores baseline.
  B-ui. bias UI is distinct from the pulse (different control, different
     wording, different 3D marker: violet octahedron vs amber ring), with
     toggle + amplitude control, and RESET clears the bias.
  M. stimulus markers land on the real hit point: two different clicks on
     the same region give different marker positions, both on the mesh
     surface (near-vertex distance within tolerance), and the persistent
     input ring sits on the same hit point.
  H. zero console errors throughout.

Assumes `npm run preview -- --port 4173` is already serving dist/.
Writes tests/pr3/pr3-test-report.json and screenshots to tests/pr3/shots/.
"""
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173/"
OUT = Path(__file__).parent / "shots"
OUT.mkdir(parents=True, exist_ok=True)
REPORT = Path(__file__).parent / "pr3-test-report.json"

results = []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(
            Path.home() / ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome"
        ), args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = ctx.new_page()
        page.set_default_timeout(60000)
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(BASE, wait_until="networkidle", timeout=30000)
        page.wait_for_function("window.__brainSim && window.__brainSim.isReady()", timeout=30000)
        page.wait_for_function("window.__brainScene", timeout=10000)
        page.wait_for_timeout(1500)
        rot_btn = page.locator("button:has-text('旋转')")
        if "开" in rot_btn.inner_text():
            rot_btn.click()
            page.wait_for_timeout(300)
        # Deterministic camera: double-click the canvas corner (background)
        # to fly back to the default view.
        box = page.locator(".brain-scene").bounding_box()
        page.mouse.dblclick(box["x"] + 15, box["y"] + 15)
        page.wait_for_timeout(2500)

        sim = lambda expr: page.evaluate(f"window.__brainSim.{expr}")
        scene = lambda expr: page.evaluate(f"window.__brainScene.{expr}")

        def pulse_peak(src, target):
            """Reset, settle, pulse src, return max|dE| at target."""
            sim("reset()")
            page.wait_for_timeout(2500)
            sim(f"pulse({src})")
            page.wait_for_timeout(3000)
            maxde = sim("getMaxAbsDeltaE()")
            return maxde[target] if maxde else None

        def mean_e(node, n=30):
            """Mean E of node over the last n snapshots of live history."""
            hist = sim("getSnapshotHistory()")
            rows = hist[-n:]
            return sum(r["e"][node] for r in rows) / len(rows) if rows else None

        def set_edge_slider(edge, slider_value_0_1000):
            """Set a weight row's range slider via the native setter
            (same approach as PR2's replay seek)."""
            page.evaluate(
                """([edge, v]) => {
                  const row = document.querySelector(`.weight-item[data-edge="${edge}"]`);
                  const s = row.querySelector('.edge-slider');
                  const setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value').set;
                  setter.call(s, String(v));
                  s.dispatchEvent(new Event('input', {bubbles: true}));
                  s.dispatchEvent(new Event('change', {bubbles: true}));
                }""",
                [edge, slider_value_0_1000],
            )
            page.wait_for_timeout(400)

        def select_region_via_response(node):
            page.locator(f'.resp-row[data-node="{node}"]').click()
            page.wait_for_timeout(500)

        # ---- W. weight editing is causal ---------------------------------
        # Baseline: pulse 73 (lV1) -> peak dE[54] (lPCS), W[54][73] = 3.0.
        peak54_base = pulse_peak(73, 54)
        check("W1 pulse 73 -> downstream peak dE[54] measurable at baseline",
              peak54_base is not None and peak54_base > 0.015,
              f"peak dE[54]={peak54_base}")
        # Zero the edge (single-sided: only W[54][73]).
        sim("setWeight(54, 73, 0)")
        peak54_zero = pulse_peak(73, 54)
        check("W2 zeroed edge kills downstream response (<30% and <0.01)",
              peak54_zero is not None and peak54_base is not None
              and peak54_zero < 0.3 * peak54_base and peak54_zero < 0.01,
              f"zeroed={peak54_zero} baseline={peak54_base} ratio={peak54_zero / peak54_base:.3f}")
        check("W3 zeroing is single-sided: reverse edge W[73][54] untouched",
              sim("getWeight(73, 54)") == 0.0 and sim("getOriginalWeight(54, 73)") == 3.0
              and sim("getWeight(54, 73)") == 0.0,
              f"W[73][54]={sim('getWeight(73, 54)')} W[54][73]={sim('getWeight(54, 73)')}")
        # Restore the edge: the response must come back.
        sim("resetWeight(54, 73)")
        peak54_restored = pulse_peak(73, 54)
        check("W4 restoring the edge restores the downstream response",
              peak54_restored is not None and peak54_base is not None
              and peak54_restored > 0.7 * peak54_base,
              f"restored={peak54_restored} baseline={peak54_base}")
        # Doubling: pulse 69 (lTCI) -> peak dE[40] (lAMYG), W[40][69] 1.0 -> 2.0.
        peak40_base = pulse_peak(69, 40)
        sim("setWeight(40, 69, 2.0)")
        peak40_dbl = pulse_peak(69, 40)
        check("W5 doubled edge enhances downstream response (>1.5x)",
              peak40_base is not None and peak40_dbl is not None
              and peak40_dbl > 1.5 * peak40_base and peak40_dbl > 0.006,
              f"doubled={peak40_dbl} baseline={peak40_base} ratio={peak40_dbl / peak40_base:.2f}x")
        check("W6 doubling is single-sided: reverse edge W[69][40] stays 1.0",
              sim("getWeight(69, 40)") == 1.0,
              f"W[69][40]={sim('getWeight(69, 40)')}")
        # Clamp: out-of-range values clamp to [0, 3].
        clamped_hi = sim("setWeight(54, 73, 9)")
        clamped_lo = sim("setWeight(54, 73, -1)")
        check("W7 out-of-range weights clamp to [0, 3]",
              clamped_hi == 3.0 and clamped_lo == 0.0,
              f"set 9 -> {clamped_hi}, set -1 -> {clamped_lo}")
        sim("resetAllWeights()")
        check("W8 reset-all restores every weight",
              sim("getModifiedWeights()") == [] and sim("getWeight(54, 73)") == 3.0
              and sim("getWeight(40, 69)") == 1.0,
              f"modified={sim('getModifiedWeights()')}")

        # ---- W-ui. CONNECTION panel --------------------------------------
        # Select node 54 via the response list (pulse 73 first).
        sim("reset()")
        page.wait_for_timeout(1200)
        sim("pulse(73)")
        page.wait_for_timeout(3000)
        select_region_via_response(54)
        panel = page.locator(".region-panel")
        row54_73 = page.locator('.weight-item[data-edge="54-73"]')
        check("WU1 panel shows 5 editable weight rows for node 54, first is lV1 -> lPCS",
              page.locator(".weight-item").count() == 5
              and "lV1 → lPCS" in row54_73.inner_text()
              and row54_73.locator(".edge-slider").count() == 1
              and row54_73.locator(".edge-number").count() == 1,
              f"rows={page.locator('.weight-item').count()} first={row54_73.inner_text()[:60]!r}")
        check("WU2 unmodified edge shows original value, no badge",
              "3.000" in row54_73.inner_text() and "已修改" not in row54_73.inner_text(),
              f"row={row54_73.inner_text()[:120]!r}")
        # Direct number entry: 0.
        num = row54_73.locator(".edge-number")
        num.fill("0")
        num.press("Enter")
        page.wait_for_timeout(400)
        check("WU3 number entry edits weight: badge + original shown side by side",
              "已修改" in row54_73.inner_text()
              and "当前 0.000" in row54_73.inner_text()
              and "原始 3.000" in row54_73.inner_text()
              and sim("getWeight(54, 73)") == 0.0
              and sim("getModifiedWeights()") == [{"i": 54, "j": 73, "w": 0.0, "original": 3.0}],
              f"row={row54_73.inner_text()[:160]!r} modified={sim('getModifiedWeights()')}")
        # Slider drag (native setter): 500/1000 -> 1.500.
        set_edge_slider("54-73", 500)
        check("WU4 slider drag edits weight to 1.500",
              "当前 1.500" in row54_73.inner_text() and sim("getWeight(54, 73)") == 1.5,
              f"row={row54_73.inner_text()[:120]!r}")
        # Per-edge restore.
        row54_73.locator(".weight-restore").click()
        page.wait_for_timeout(400)
        check("WU5 per-edge restore returns to the original value",
              "已修改" not in row54_73.inner_text()
              and sim("getWeight(54, 73)") == 3.0 and sim("getModifiedWeights()") == [],
              f"modified={sim('getModifiedWeights()')}")
        # Two edits, then restore-all.
        num.fill("0.5")
        num.press("Enter")
        row54_55 = page.locator('.weight-item[data-edge="54-55"]')
        row54_55.locator(".edge-number").fill("1")
        row54_55.locator(".edge-number").press("Enter")
        page.wait_for_timeout(400)
        check("WU6 two edges modified at once",
              len(sim("getModifiedWeights()")) == 2,
              f"modified={sim('getModifiedWeights()')}")
        page.locator(".weight-restore-all").click()
        page.wait_for_timeout(400)
        check("WU7 restore-all returns every weight to original",
              sim("getModifiedWeights()") == [] and sim("getWeight(54, 73)") == 3.0
              and sim("getWeight(54, 55)") == 3.0,
              f"modified={sim('getModifiedWeights()')}")
        # RESET preserves edited weights (and the panel says so).
        num.fill("0.5")
        num.press("Enter")
        page.wait_for_timeout(400)
        panel_text = panel.inner_text()
        check("WU8 panel states the RESET semantics (weights survive RESET)",
              "RESET 恢复仿真状态，但保留已改权重" in panel_text
              and "当前权重可能已被用户修改，不再是 TVB 原始数据" in panel_text,
              f"panel has semantics text: {'RESET 恢复仿真状态' in panel_text}")
        page.locator('.topbar button:has-text("RESET")').click()
        page.wait_for_timeout(1200)
        check("WU9 RESET preserves the edited weight",
              sim("getWeight(54, 73)") == 0.5
              and sim("getModifiedWeights()") == [{"i": 54, "j": 73, "w": 0.5, "original": 3.0}],
              f"modified after RESET={sim('getModifiedWeights()')}")
        # The badge is still there after re-selecting the region.
        # NOTE: do NOT re-pulse 73 to reselect 54: the preserved 0.5
        # weight suppresses 54's response to a 73 pulse below the 0.01
        # threshold, so 54 leaves the responder list (that suppression
        # IS the preserved-weight effect).  Pulse 55 instead — its edge
        # into 54 (W=3.0) was never edited, so 54 still responds.
        sim("pulse(55)")
        page.wait_for_timeout(3000)
        select_region_via_response(54)
        row54_73 = page.locator('.weight-item[data-edge="54-73"]')
        check("WU10 edited weight still marked after RESET + reselect",
              "已修改" in row54_73.inner_text() and "当前 0.500" in row54_73.inner_text(),
              f"row={row54_73.inner_text()[:120]!r}")
        sim("resetAllWeights()")

        # ---- B. sustained bias is causal ---------------------------------
        sim("reset()")
        page.wait_for_timeout(3500)
        e40_base = mean_e(40)
        e0_base = mean_e(0)
        check("B1 baseline steady E[40] ~0.012 before bias",
              e40_base is not None and abs(e40_base - 0.0118) < 0.003,
              f"E[40]={e40_base}")
        sim("setBias(40, 0.5)")
        page.wait_for_timeout(4000)
        e40_pos = mean_e(40)
        e0_pos = mean_e(0)
        check("B2 positive bias raises steady E[40]",
              e40_pos is not None and e40_base is not None and e40_pos > e40_base + 0.005,
              f"E[40] {e40_base:.4f} -> {e40_pos:.4f}")
        check("B3 positive bias leaves unconnected node 0 alone",
              e0_pos is not None and e0_base is not None and abs(e0_pos - e0_base) < 0.002,
              f"E[0] {e0_base:.4f} -> {e0_pos:.4f}")
        sim("setBias(40, -0.5)")
        page.wait_for_timeout(4000)
        e40_neg = mean_e(40)
        check("B4 negative bias lowers steady E[40]",
              e40_neg is not None and e40_base is not None and e40_neg < e40_base - 0.002,
              f"E[40] {e40_base:.4f} -> {e40_neg:.4f}")
        sim("clearBias(40)")
        page.wait_for_timeout(4000)
        e40_off = mean_e(40)
        check("B5 clearing the bias restores baseline behaviour",
              e40_off is not None and e40_base is not None and abs(e40_off - e40_base) < 0.002,
              f"E[40] {e40_base:.4f} -> {e40_off:.4f}")

        # ---- B-ui. bias controls -----------------------------------------
        sim("reset()")
        page.wait_for_timeout(1200)
        sim("pulse(40)")
        page.wait_for_timeout(3000)
        select_region_via_response(40)
        panel_text = panel.inner_text()
        check("BU1 bias section is worded as NOT a pulse",
              "持续偏置输入" in panel_text and "不是点击脉冲" in panel_text
              and "范围 −1.0–+1.0" in panel_text and "开启默认值 +0.50" in panel_text,
              f"bias section present: {'持续偏置输入' in panel_text}")
        toggle = page.locator('.bias-controls button:has-text("偏置")')
        check("BU2 bias starts off",
              "偏置 关" in toggle.inner_text() and sim("getBias(40)") == 0
              and scene("getBiasMarkers()") == [],
              f"toggle={toggle.inner_text()!r}")
        toggle.click()
        page.wait_for_timeout(500)
        markers = scene("getBiasMarkers()")
        check("BU3 switching bias on applies +0.50 with a violet octahedron marker",
              sim("getBias(40)") == 0.5 and len(markers) == 1
              and markers[0]["node"] == 40 and markers[0]["geometry"] == "OctahedronGeometry"
              and markers[0]["color"] == "#b78cff"
              and "兴奋 +0.50" in panel.inner_text(),
              f"bias={sim('getBias(40)')} markers={markers}")
        # Bias slider (native setter): (v+1)/2*1000; -0.5 -> 250.
        # Scoped to the bias slider only (weight rows have their own sliders).
        page.evaluate(
            """() => {
              const s = document.querySelector('.region-panel .bias-slider .edge-slider');
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value').set;
              setter.call(s, '250');
              s.dispatchEvent(new Event('input', {bubbles: true}));
              s.dispatchEvent(new Event('change', {bubbles: true}));
            }""")
        page.wait_for_timeout(500)
        check("BU4 bias slider moves to inhibitory -0.50",
              sim("getBias(40)") == -0.5 and "抑制 -0.50" in panel.inner_text(),
              f"bias={sim('getBias(40)')}")
        toggle.click()
        page.wait_for_timeout(500)
        check("BU5 switching bias off clears it and removes the marker",
              sim("getBias(40)") == 0 and scene("getBiasMarkers()") == []
              and "无偏置" in panel.inner_text(),
              f"bias={sim('getBias(40)')} markers={scene('getBiasMarkers()')}")
        # RESET clears bias (applied input) — unlike weights.
        toggle.click()
        page.wait_for_timeout(400)
        page.locator('.topbar button:has-text("RESET")').click()
        page.wait_for_timeout(1200)
        check("BU6 RESET clears the bias",
              sim("getBias(40)") == 0 and sim("getAllBias()") == []
              and scene("getBiasMarkers()") == [],
              f"bias={sim('getBias(40)')} all={sim('getAllBias()')}")

        # ---- M. markers land on the real hit point -----------------------
        # Probe the canvas with real clicks until one region has two hits
        # >= 8 mm apart; record each hit point + its surface distance.
        hits = {}  # node -> list of (point, surface_dist)
        found = None
        xs = [0.30 + 0.05 * k for k in range(9)]
        ys = [0.30 + 0.05 * k for k in range(9)]
        for fy in ys:
            if found:
                break
            for fx in xs:
                page.mouse.click(box["x"] + box["width"] * fx, box["y"] + box["height"] * fy)
                page.wait_for_timeout(120)
                pt = scene("getLastStimulusPoint()")
                if not pt:
                    continue
                dist = scene("getLastHitSurfaceDistance()")
                node = pt["node"]
                hits.setdefault(node, []).append((pt["point"], dist, pt["fromHit"]))
                pts = hits[node]
                for a in range(len(pts)):
                    for b in range(a + 1, len(pts)):
                        d = sum((x - y) ** 2 for x, y in zip(pts[a][0], pts[b][0])) ** 0.5
                        if d >= 8.0:
                            found = (node, pts[a], pts[b], d)
                            break
                    if found:
                        break
                if found:
                    break
        check("M1 two different clicks on the same region give points >= 8 mm apart",
              found is not None,
              f"found={found[0] if found else None} dist={found[3]:.1f} mm" if found else f"nodes hit={sorted(hits)}")
        if found:
            node, pa, pb, d = found
            check("M2 both hit points are real ray hits (not centroid fallback)",
                  pa[2] is True and pb[2] is True,
                  f"fromHit={pa[2]}, {pb[2]}")
            check("M3 both hit points lie on the mesh surface (near-vertex < 8 mm)",
                  pa[1] is not None and pb[1] is not None and pa[1] < 8.0 and pb[1] < 8.0,
                  f"surface dist={pa[1]:.2f} mm, {pb[1]:.2f} mm")
            # The persistent input ring sits on the last hit point.
            page.wait_for_timeout(1500)
            ring = scene("getInputRingPosition()")
            last = scene("getLastStimulusPoint()")
            ring_dist = (
                sum((x - y) ** 2 for x, y in zip(ring, last["point"])) ** 0.5
                if ring and last else None
            )
            check("M4 persistent input ring sits on the hit point (< 1 mm)",
                  ring_dist is not None and ring_dist < 1.0,
                  f"ring-to-hit={ring_dist}")
            # ... and the hit point is NOT the region centroid.
            centre = scene(f"getRegionCentre({node})")
            centre_dist = (
                sum((x - y) ** 2 for x, y in zip(last["point"], centre)) ** 0.5
                if centre and last else None
            )
            check("M5 hit point is not the region centroid (> 3 mm away)",
                  centre_dist is not None and centre_dist > 3.0,
                  f"hit-to-centre={centre_dist:.1f} mm")

        check("H1 zero console errors", len(errors) == 0, f"errors={errors[:5]}")

        REPORT.write_text(json.dumps({
            "peak54_baseline": peak54_base,
            "peak54_zeroed": peak54_zero,
            "peak54_restored": peak54_restored,
            "peak40_baseline": peak40_base,
            "peak40_doubled": peak40_dbl,
            "bias_E40": {"baseline": e40_base, "pos": e40_pos, "neg": e40_neg, "off": e40_off},
            "bias_E0": {"baseline": e0_base, "pos": e0_pos},
            "marker_pair": (
                {"node": found[0], "dist_mm": found[3],
                 "surface_mm": [found[1][1], found[2][1]]} if found else None
            ),
            "checks": results,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        browser.close()
        failed = [r for r in results if not r["ok"]]
        print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
        raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
