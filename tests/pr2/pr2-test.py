"""PR2 formal test: causal feedback made visible (delta-E view, slow-motion
replay, response highlighting).

Covers, all with expectations derived from the SAME run's debug-bridge data
(no numbers copied from any earlier report):
  A. pre-stimulus: no fabricated activity in the dE view (baseline null,
     "not yet stimulated", every sampled region at base colour).
  B. one known stimulus (lAMYG #40): window/summary/groups cross-checked
     against each other and against the DOM panel (threshold 0.01, grouping,
     ordering, per-row peaks).
  C. dE colouring is true to the real dE: display colours match the design
     formula applied to the same run's bridge dE, for the stimulated node,
     a distal responder, and a quiet non-responder; pixel-level amber check.
  D. slow-motion replay peak == live peak (replay E, window peak, live peak
     tracker, all three read in the same run); 0.25x clock rate; pause;
     back-to-live.
  E. three marker classes coexist and differ in geometry AND colour/size.
  F. a new stimulus replaces the whole window/baseline (and drops replay).
  G. RESET clears everything, dE view back to base colour.
  H. zero console errors throughout.
  I. param controls (PR2, user request): sliders replace the rotary knobs —
     drag changes value + engine param in sync (STIMULUS non-linear map
     0.5*4^k), direct number entry, steppers, double-click reset, clamp
     out-of-range input, wheel, 978px usable.

Assumes `npm run preview -- --port 4173` is already serving dist/.
Writes tests/pr2/pr2-test-report.json and screenshots to tests/pr2/shots/.
"""
import json
import math
import re
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173/"
OUT = Path(__file__).parent / "shots"
OUT.mkdir(parents=True, exist_ok=True)
REPORT = Path(__file__).parent / "pr2-test-report.json"

# Design constants from the implementation (app/src/components/BrainScene.tsx).
# NOTE: three.js stores vertex colours in its LINEAR-sRGB working space
# (THREE.Color('#…') converts from sRGB on construction), so every expected
# colour below is converted sRGB -> linear first and lerped in linear space
# — comparing against raw sRGB hex values fails by up to ~0.27/channel.
def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _hex_lin(hexstr):
    h = hexstr.lstrip("#")
    return tuple(_srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


BASE_RGB = _hex_lin("#2a4a66")   # base colour
AMBER_RGB = _hex_lin("#ffb340")
HOT_RGB = _hex_lin("#fff8ec")
NEG_RGB = _hex_lin("#2f7fd0")    # blue (dE < 0)
DELTA_FULL = 0.1
E_BASELINE = 0.011
E_PEAK = 0.5

results = []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def expected_delta_color(d):
    """Design formula for the dE diverging scale, applied to a real dE."""
    sgn = math.copysign(math.sqrt(min(abs(d) / DELTA_FULL, 1.0)), d) if d != 0 else 0.0
    if sgn >= 0:
        if sgn <= 0.55:
            return lerp(BASE_RGB, AMBER_RGB, (sgn / 0.55) ** 0.8)
        return lerp(AMBER_RGB, HOT_RGB, ((sgn - 0.55) / 0.45) ** 0.7)
    return lerp(BASE_RGB, NEG_RGB, (-sgn) ** 0.8)


def expected_absolute_color(e):
    """Design formula for the absolute-E heat scale, applied to a real E."""
    intensity = min(1.0, max(0.0, (e - E_BASELINE) / (E_PEAK - E_BASELINE)))
    if intensity <= 0.55:
        return lerp(BASE_RGB, AMBER_RGB, (intensity / 0.55) ** 0.8)
    return lerp(AMBER_RGB, HOT_RGB, ((intensity - 0.55) / 0.45) ** 0.7)


def close(c1, c2, tol=0.10):
    return c1 is not None and c2 is not None and all(abs(a - b) <= tol for a, b in zip(c1, c2))


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
        # to fly back to the default view, so screenshots are comparable
        # across rounds instead of depending on how far auto-rotate got.
        box = page.locator(".brain-scene").bounding_box()
        page.mouse.dblclick(box["x"] + 15, box["y"] + 15)
        page.wait_for_timeout(2500)
        cam = page.evaluate("window.__brainScene.getCameraPosition()")
        cam_def = page.evaluate("window.__brainScene.getDefaultCameraPosition()")
        cam_dist = sum((a - b) ** 2 for a, b in zip(cam, cam_def)) ** 0.5
        check("A0 camera reset to default view",
              cam_dist < 5.0, f"camera={ [round(v, 1) for v in cam] } dist={cam_dist:.2f} mm")

        def display_color(node):
            return page.evaluate(f"window.__brainScene.getRegionDisplayColor({node})")

        def wait_for_color(node, expected, timeout_s=40):
            """Wait until the interpolated display colour has actually
            converged to the known expected target (within 0.05/channel).
            Do NOT infer convergence from stillness: under SwiftShader a
            single frame can take >1 s, so two 1 s-apart polls can show zero
            change while the colour is still mid-interpolation. Returns
            (colour, converged)."""
            deadline = time.time() + timeout_s
            cur = display_color(node)
            while time.time() < deadline:
                if close(cur, expected, 0.05):
                    return cur, True
                page.wait_for_timeout(1000)
                cur = display_color(node)
            return cur, close(cur, expected, 0.05)

        def set_view(mode):
            label = "活动变化 ΔE" if mode == "delta" else "绝对活动 E"
            page.locator(f".stage-tools button:has-text('{label}')").click()
            page.wait_for_timeout(300)

        def seek_to(t_ms):
            page.evaluate(
                """(t) => {
                  const s = document.querySelector('.replay-seek');
                  const setter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value').set;
                  setter.call(s, String(t));
                  s.dispatchEvent(new Event('input', {bubbles: true}));
                }""",
                t_ms,
            )
            page.wait_for_timeout(400)

        def replay_state():
            return page.evaluate("window.__brainSim.getReplayState()")

        panel = page.locator(".response-panel")

        # ---- A. pre-stimulus: no fabricated activity ----------------------
        check("A1 pre-stimulus baseline null",
              page.evaluate("window.__brainSim.getBaseline()") is None)
        check("A2 pre-stimulus summary null",
              page.evaluate("window.__brainSim.getResponseSummary()") is None)
        check("A3 pre-stimulus max|dE| null",
              page.evaluate("window.__brainSim.getMaxAbsDeltaE()") is None)
        groups0 = page.evaluate("window.__brainSim.getResponseGroups()")
        check("A4 pre-stimulus groups empty",
              groups0 and groups0["input"] is None and groups0["local"] == []
              and groups0["network"] == [], f"groups={groups0}")
        panel_text0 = panel.inner_text()
        check("A5 pre-stimulus panel says not yet stimulated",
              "尚未刺激" in panel_text0 and "尚未刺激，暂无响应列表。" in panel_text0)
        set_view("delta")
        pre_colors = {}
        pre_conv = {}
        for n in (40, 47, 59):
            pre_colors[n], pre_conv[n] = wait_for_color(n, BASE_RGB)
        check("A6 dE view pre-stimulus: sampled regions at base colour",
              all(pre_conv.values())
              and all(close(c, BASE_RGB, 0.05) for c in pre_colors.values()),
              f"colors={ {n: [round(v, 3) for v in c] for n, c in pre_colors.items()} } "
              f"converged={pre_conv}")
        cd0 = page.evaluate("window.__brainScene.getColorDebug()")
        check("A7 dE view pre-stimulus: colour debug has no baseline/delta",
              cd0["colorMode"] == "delta" and cd0["hasBaseline"] is False
              and cd0["delta40"] is None, f"debug={cd0}")
        set_view("absolute")

        # ---- B. one known stimulus: lAMYG #40 ----------------------------
        page.evaluate("window.__brainSim.reset()")
        page.wait_for_timeout(1200)
        page.evaluate("window.__brainSim.resetPeakTracking()")
        page.evaluate("window.__brainSim.pulse(40)")
        page.wait_for_timeout(3000)

        summary = page.evaluate("window.__brainSim.getResponseSummary()")
        groups = page.evaluate("window.__brainSim.getResponseGroups()")
        maxde = page.evaluate("window.__brainSim.getMaxAbsDeltaE()")
        window = page.evaluate("window.__brainSim.getLastResponseWindow()")
        baseline = page.evaluate("window.__brainSim.getBaseline()")
        peak_e = page.evaluate("window.__brainSim.getPeakE()")
        n_snaps = len(window["snapshots"]) if window else 0
        check("B1 window filled: node 40, baseline-500ms..+2000ms",
              window is not None and n_snaps >= 60 and window["node"] == 40
              and abs(window["t0_ms"] - (window["baselineT_ms"] - 500)) <= 200
              and abs(window["t1_ms"] - (window["baselineT_ms"] + 2000)) <= 250
              and all(window["snapshots"][i]["t_ms"] < window["snapshots"][i + 1]["t_ms"]
                      for i in range(n_snaps - 1)),
              f"snapshots={n_snaps} t0={window['t0_ms'] if window else None} "
              f"t1={window['t1_ms'] if window else None} base={window['baselineT_ms'] if window else None}")
        responders = summary["responders"] if summary else []
        n_resp = summary["count"] if summary else 0
        sorted_ok = all(abs(responders[i]["peakDeltaE"]) >= abs(responders[i + 1]["peakDeltaE"])
                        for i in range(len(responders) - 1))
        check("B2 summary: node 40, threshold 0.01, count>=2, sorted by |peak|",
              summary and summary["node"] == 40 and summary["threshold"] == 0.01
              and n_resp >= 2 and sorted_ok,
              f"count={n_resp} threshold={summary['threshold'] if summary else None}")
        peak40 = next((r["peakDeltaE"] for r in responders if r["node"] == 40), None)
        distal = [r for r in responders if r["node"] != 40]
        distal_max = max((abs(r["peakDeltaE"]) for r in distal), default=0.0)
        check("B3 stimulated node dE >> distal nodes (same run)",
              peak40 is not None and distal_max > 0 and abs(peak40) > 5 * distal_max,
              f"peak dE[40]={peak40} max distal |dE|={distal_max:.4f} "
              f"ratio={abs(peak40) / distal_max:.1f}x")
        agree = summary is not None and maxde is not None and all(
            abs(maxde[r["node"]] - abs(r["peakDeltaE"])) < 1e-9 for r in responders)
        check("B4 max|dE| agrees with summary peak for EVERY responder",
              agree, f"responders checked={len(responders)}")
        s005 = page.evaluate("window.__brainSim.getResponseSummary(0.05)")
        s0005 = page.evaluate("window.__brainSim.getResponseSummary(0.005)")
        check("B5 threshold semantics: higher threshold -> fewer/equal, all pass it",
              s005 and s0005 and s005["count"] <= n_resp <= s0005["count"]
              and all(abs(r["peakDeltaE"]) >= 0.05 for r in s005["responders"])
              and all(abs(r["peakDeltaE"]) >= 0.005 for r in s0005["responders"]),
              f"count@0.05={s005['count'] if s005 else None} @0.01={n_resp} "
              f"@0.005={s0005['count'] if s0005 else None}")
        check("B6 groups: input=40, local=[40] iff it responds, network=rest in order",
              groups and groups["input"] == 40 and groups["threshold"] == 0.01
              and groups["local"] == ([40] if peak40 is not None else [])
              and groups["network"] == [r["node"] for r in distal],
              f"groups={ {k: groups[k] for k in ('input', 'local', 'network')} if groups else None }")
        # DOM panel vs bridge, every row.
        panel_text = panel.inner_text()
        m = re.search(r"共 (\d+) 个响应脑区", panel_text)
        dom_count = int(m.group(1)) if m else -1
        rows_ok = True
        row_detail = ""
        for r in responders:
            row = page.locator(f'.resp-row[data-node="{r["node"]}"]')
            if row.count() != 1:
                rows_ok = False
                row_detail = f"node {r['node']}: row count {row.count()}"
                break
            want = f"{r['peakDeltaE']:+.3f}"
            if want not in row.inner_text():
                rows_ok = False
                row_detail = f"node {r['node']}: want {want}, got {row.inner_text()!r}"
                break
        check("B7 DOM panel: count + every row peak == bridge numbers",
              dom_count == n_resp and page.locator(".resp-row").count() == n_resp and rows_ok,
              f"dom={dom_count} bridge={n_resp} rows={page.locator('.resp-row').count()} {row_detail}")
        # Group membership in the DOM: rows under each group title.
        def nodes_under(title):
            return page.evaluate(
                """(t) => {
                  const titles = [...document.querySelectorAll('.resp-group-title')];
                  const el = titles.find(x => x.textContent.trim() === t);
                  if (!el) return null;
                  const ul = el.nextElementSibling;
                  if (!ul) return null;
                  return [...ul.querySelectorAll('.resp-row')].map(
                    b => Number(b.getAttribute('data-node')));
                }""",
                title,
            )
        dom_local = nodes_under("局部响应")
        dom_network = nodes_under("网络响应")
        check("B8 DOM group lists match bridge groups",
              dom_local == groups["local"] and dom_network == groups["network"],
              f"dom local={dom_local} network={dom_network}")
        win_peak40 = max(s["e"][40] for s in window["snapshots"]) if window else None
        check("B9 window peak E[40] == live peak tracker",
              win_peak40 is not None and peak_e is not None
              and abs(win_peak40 - peak_e[40]) < 1e-9,
              f"window={win_peak40} tracker={peak_e[40] if peak_e else None}")

        # Peak instants, read from this run's window (not assumed).
        peak_snap = max(window["snapshots"], key=lambda s: s["e"][40])
        peak_t = peak_snap["t_ms"]
        distal_node = max(distal, key=lambda r: abs(r["peakDeltaE"]))["node"]
        distal_peak_t = max(window["snapshots"],
                            key=lambda s: abs(s["e"][distal_node] - baseline["e"][distal_node]))["t_ms"]
        quiet_node = min(range(76), key=lambda r: maxde[r])
        quiet_peak = maxde[quiet_node]

        def snapshot_at(t_ms):
            cur = None
            for s in window["snapshots"]:
                if s["t_ms"] <= t_ms:
                    cur = s
                else:
                    break
            return cur

        # ---- C. dE colouring is true to the real dE -----------------------
        page.locator(".replay-play").click()  # start replay (playing)
        page.wait_for_timeout(200)
        page.locator(".replay-play").click()  # pause
        page.wait_for_timeout(300)
        rs = replay_state()
        check("C1 replay pauses",
              rs["active"] is True and rs["playing"] is False, f"state={rs}")
        seek_to(peak_t)
        rs = replay_state()
        check("C2 replay seek lands on the node-40 peak instant",
              abs(rs["tMs"] - peak_t) <= 20, f"tMs={rs['tMs']} peak_t={peak_t}")
        snap = snapshot_at(rs["tMs"])
        # Absolute view first (screenshots + colour), then dE view.
        exp_d40 = snap["e"][40] - baseline["e"][40]
        exp_a40 = expected_absolute_color(snap["e"][40])
        set_view("absolute")
        c40_abs, conv_abs = wait_for_color(40, exp_a40)
        # Let presented frames catch up with the converged vertex colours
        # (SwiftShader ~1 FPS: an immediate screenshot can capture a stale
        # compositor frame), then take two shots and keep the max amber.
        page.wait_for_timeout(3000)
        shot_abs = OUT / "pr2-peak40-absolute.png"
        page.locator(".brain-scene canvas").screenshot(path=str(shot_abs))
        page.wait_for_timeout(1200)
        shot_abs2 = OUT / "pr2-peak40-absolute-2.png"
        page.locator(".brain-scene canvas").screenshot(path=str(shot_abs2))
        set_view("delta")
        c40_de, conv_de = wait_for_color(40, expected_delta_color(exp_d40))
        page.wait_for_timeout(3000)
        shot_de = OUT / "pr2-peak40-delta.png"
        page.locator(".brain-scene canvas").screenshot(path=str(shot_de))
        page.wait_for_timeout(1200)
        shot_de2 = OUT / "pr2-peak40-delta-2.png"
        page.locator(".brain-scene canvas").screenshot(path=str(shot_de2))
        cd = page.evaluate("window.__brainScene.getColorDebug()")
        check("C3 replay dE[40] at peak instant == window-derived dE (exact)",
              cd["colorMode"] == "delta" and cd["hasReplayE"] is True
              and cd["e40"] == snap["e"][40] and cd["base40"] == baseline["e"][40]
              and abs(cd["delta40"] - exp_d40) < 1e-9,
              f"debug dE40={cd['delta40']} expected={exp_d40}")
        exp_c40 = expected_delta_color(exp_d40)
        check("C4 stimulated node display colour == formula(real dE), dE view",
              conv_de and close(c40_de, exp_c40),
              f"actual={[round(v, 3) for v in c40_de]} expected={[round(v, 3) for v in exp_c40]} "
              f"converged={conv_de}")
        check("C4b stimulated node absolute-view colour == formula(real E)",
              conv_abs and close(c40_abs, exp_a40),
              f"actual={[round(v, 3) for v in c40_abs]} expected={[round(v, 3) for v in exp_a40]} "
              f"converged={conv_abs}")
        check("C5 stimulated node saturates in dE view at its peak",
              c40_de[0] > 0.9, f"R={c40_de[0]:.3f}")
        # Quiet non-responder at the same instant: must stay near base.
        exp_cq = expected_delta_color(snap["e"][quiet_node] - baseline["e"][quiet_node])
        cq_de, conv_q = wait_for_color(quiet_node, exp_cq)
        check("C6 quiet node stays near base in dE view (no fabrication)",
              conv_q and close(cq_de, exp_cq) and cq_de[0] < 0.5,
              f"node={quiet_node} max|dE|={quiet_peak:.4f} "
              f"actual={[round(v, 3) for v in cq_de]} expected={[round(v, 3) for v in exp_cq]} "
              f"converged={conv_q}")
        from PIL import Image

        def amber_count(path):
            raw = Image.open(path).convert("RGB").tobytes()
            return sum(1 for i in range(0, len(raw), 3)
                       if raw[i] > 150 and 90 < raw[i + 1] < 210 and raw[i + 2] < 130)
        amber_abs = max(amber_count(shot_abs), amber_count(shot_abs2))
        amber_de = max(amber_count(shot_de), amber_count(shot_de2))
        check("C7 pixel check: dE view shows far more amber than absolute at peak",
              amber_de > 1.5 * max(amber_abs, 1),
              f"amber px absolute={amber_abs} delta={amber_de} "
              f"(ratio {amber_de / max(amber_abs, 1):.2f}x)")
        # Distal responder at ITS OWN peak instant: dE view vs absolute view.
        seek_to(distal_peak_t)
        rs = replay_state()
        snap_d = snapshot_at(rs["tMs"])
        d_dist = snap_d["e"][distal_node] - baseline["e"][distal_node]
        exp_d_de = expected_delta_color(d_dist)
        exp_d_abs = expected_absolute_color(snap_d["e"][distal_node])
        set_view("delta")
        cd_de, conv_dde = wait_for_color(distal_node, exp_d_de)
        set_view("absolute")
        cd_abs, conv_dabs = wait_for_color(distal_node, exp_d_abs)
        check("C8 distal node dE-view colour == formula(real dE) at its peak",
              conv_dde and close(cd_de, exp_d_de),
              f"node={distal_node} dE={d_dist:.4f} "
              f"actual={[round(v, 3) for v in cd_de]} expected={[round(v, 3) for v in exp_d_de]} "
              f"converged={conv_dde}")
        check("C9 distal node: dE view much brighter than absolute view (same instant)",
              cd_de[0] > 0.6 and cd_abs[0] < 0.45 and cd_de[0] - cd_abs[0] > 0.15,
              f"node={distal_node} R dE={cd_de[0]:.3f} R abs={cd_abs[0]:.3f}")
        check("C10 distal node absolute-view colour == formula(real E)",
              conv_dabs and close(cd_abs, exp_d_abs),
              f"actual={[round(v, 3) for v in cd_abs]} expected={[round(v, 3) for v in exp_d_abs]} "
              f"converged={conv_dabs}")
        set_view("delta")

        # ---- D. replay peak == live peak; slow motion ---------------------
        # Seek 8 ms past the peak instant: the range input snaps to a 16 ms
        # step grid, so seeking exactly at peak_t could land one step below
        # the peak snapshot; +8 ms guarantees the snapshot at/below tMs is
        # the peak snapshot itself (next snapshot is ~33 ms later).
        seek_to(peak_t + 8)
        page.wait_for_timeout(500)
        cd_peak = page.evaluate("window.__brainScene.getColorDebug()")
        check("D1 replay peak E[40] == window peak == live peak tracker",
              abs(cd_peak["e40"] - win_peak40) < 1e-9
              and abs(win_peak40 - peak_e[40]) < 1e-9,
              f"replay={cd_peak['e40']} window={win_peak40} tracker={peak_e[40]}")
        # Pause freezes the replay clock.
        rs_a = replay_state()
        page.wait_for_timeout(600)
        rs_b = replay_state()
        check("D2 paused replay clock frozen",
              rs_a["playing"] is False and rs_a["tMs"] == rs_b["tMs"],
              f"tMs {rs_a['tMs']} -> {rs_b['tMs']}")
        # 0.25x rate.
        seek_to(window["t0_ms"])
        page.locator(".replay-speed:has-text('0.25×')").click()
        page.wait_for_timeout(300)
        page.locator(".replay-play").click()  # resume
        page.wait_for_timeout(300)
        t_a = replay_state()["tMs"]
        w0 = time.perf_counter()
        page.wait_for_timeout(2000)
        w1 = time.perf_counter()
        t_b = replay_state()["tMs"]
        wall_ms = (w1 - w0) * 1000
        ratio = (t_b - t_a) / wall_ms if wall_ms else 0
        check("D3 replay 0.25x advances at ~quarter speed",
              0.15 < ratio < 0.35,
              f"advanced {t_b - t_a:.0f} ms over {wall_ms:.0f} ms wall (ratio {ratio:.2f})")
        rs1 = replay_state()
        check("D4 replay still active at 0.25x",
              rs1["active"] is True and rs1["speed"] == 0.25, f"state={rs1}")
        page.locator(".replay-live").click()
        page.wait_for_timeout(300)
        rs2 = replay_state()
        cd_live = page.evaluate("window.__brainScene.getColorDebug()")
        check("D5 back-to-live clears replay",
              rs2["active"] is False and cd_live["hasReplayE"] is False,
              f"state={rs2}")

        # ---- E. three marker classes --------------------------------------
        markers = page.evaluate("window.__brainScene.getResponseMarkers()")
        details = page.evaluate("window.__brainScene.getResponseMarkerDetails()")
        check("E1 groups: input + local + network all non-empty",
              groups["input"] is not None and len(groups["local"]) >= 1
              and len(groups["network"]) >= 1,
              f"input={groups['input']} local={groups['local']} network={len(groups['network'])}")
        check("E2 marker counts match bridge groups",
              markers is not None and markers["input"] == 1
              and markers["local"] == len(groups["local"])
              and markers["network"] == len(groups["network"]),
              f"markers={markers}")
        d_in, d_lo, d_ne = details.get("input"), details.get("local"), details.get("network")
        check("E3 markers differ in geometry AND colour/size",
              d_in and d_lo and d_ne
              and d_in["geometry"] == "RingGeometry"
              and d_lo["geometry"] == "SphereGeometry" and d_ne["geometry"] == "SphereGeometry"
              and d_in["color"] == "#ffb340" and d_lo["color"] == "#ffc861"
              and d_ne["color"] == "#4fb6f2"
              and d_lo["radius"] == 2.6 and d_ne["radius"] == 1.6,
              f"details={details}")
        legend = page.locator(".marker-legend").inner_text() if page.locator(".marker-legend").count() else ""
        check("E4 DOM marker legend names all three classes",
              "琥珀色环" in legend and "琥珀实心" in legend and "蓝色小点" in legend,
              f"legend={legend!r}")

        # ---- F. new stimulus replaces the window --------------------------
        old_base_t, old_t0 = window["baselineT_ms"], window["t0_ms"]
        page.locator(".replay-play").click()  # replay window 1 again
        page.wait_for_timeout(500)
        check("F0 replay of window 1 active before second stimulus",
              replay_state()["active"] is True)
        page.evaluate("window.__brainSim.resetPeakTracking()")
        page.evaluate("window.__brainSim.pulse(47)")
        page.wait_for_timeout(3000)
        check("F1 new stimulus drops replay back to live",
              replay_state()["active"] is False)
        window2 = page.evaluate("window.__brainSim.getLastResponseWindow()")
        summary2 = page.evaluate("window.__brainSim.getResponseSummary()")
        groups2 = page.evaluate("window.__brainSim.getResponseGroups()")
        check("F2 new window: node 47, fresh baseline/window",
              window2 is not None and window2["node"] == 47
              and window2["baselineT_ms"] != old_base_t and window2["t0_ms"] != old_t0
              and len(window2["snapshots"]) >= 60,
              f"node={window2['node'] if window2 else None} base {old_base_t} -> "
              f"{window2['baselineT_ms'] if window2 else None} "
              f"snapshots={len(window2['snapshots']) if window2 else 0}")
        check("F3 new summary/groups follow the new stimulus",
              summary2 and summary2["node"] == 47 and groups2["input"] == 47
              and summary2["count"] >= 1,
              f"count={summary2['count'] if summary2 else None} input={groups2['input'] if groups2 else None}")
        panel_text2 = panel.inner_text()
        m2 = re.search(r"共 (\d+) 个响应脑区", panel_text2)
        check("F4 DOM panel count follows the new window",
              m2 and int(m2.group(1)) == summary2["count"],
              f"dom={m2.group(1) if m2 else None} bridge={summary2['count']}")

        # ---- G. RESET ------------------------------------------------------
        page.locator("button:has-text('RESET')").first.click()
        page.wait_for_timeout(800)
        check("G1 RESET clears baseline/summary/window",
              page.evaluate("window.__brainSim.getBaseline()") is None
              and page.evaluate("window.__brainSim.getResponseSummary()") is None
              and page.evaluate("window.__brainSim.getLastResponseWindow()") is None)
        check("G2 RESET clears 3D response markers",
              page.evaluate("window.__brainScene.getResponseMarkers()")
              == {"input": 0, "local": 0, "network": 0})
        check("G3 RESET panel back to not-yet-stimulated",
              "尚未刺激" in panel.inner_text())
        set_view("delta")
        c_reset, conv_reset = wait_for_color(40, BASE_RGB)
        cd_r = page.evaluate("window.__brainScene.getColorDebug()")
        check("G4 RESET: dE view back to base colour, no baseline",
              conv_reset and close(c_reset, BASE_RGB, 0.05) and cd_r["hasBaseline"] is False,
              f"color={[round(v, 3) for v in c_reset]} converged={conv_reset}")

        # ---- I. param controls (PR2: sliders replace rotary knobs) --------
        # RESET (section G) restored all params to defaults, so start here.
        def param_row(name):
            return page.locator(f'.param[data-param="{name}"]')

        def slider_k(name):
            return float(param_row(name).locator(".param-slider").input_value()) / 1000

        def param_display(name):
            return param_row(name).locator(".param-value").inner_text()

        def engine_params():
            return page.evaluate("window.__brainSim.getParams()")

        check("I0 four param controls, each with slider + number + steppers",
              page.locator(".param").count() == 4
              and all(page.locator(".param").nth(i).locator(".param-slider").count() == 1
                      and page.locator(".param").nth(i).locator(".param-number").count() == 1
                      and page.locator(".param").nth(i).locator(".param-step").count() == 2
                      for i in range(4)),
              f"params={page.locator('.param').count()}")
        p0 = engine_params()
        check("I0b params at defaults after RESET",
              p0["stim_amplitude"] == 2.0 and p0["stim_duration_ms"] == 100
              and p0["c_ei"] == 4.0 and p0["g"] == 0.35, f"params={p0}")
        # I1: drag the STIMULUS slider left; engine amplitude must follow
        # the non-linear map 0.5*4^k exactly (k read from the slider itself).
        stim_slider = param_row("STIMULUS").locator(".param-slider")
        sbox = stim_slider.bounding_box()
        k_before = slider_k("STIMULUS")
        amp_before = p0["stim_amplitude"]
        thumb_x = sbox["x"] + 11 + k_before * (sbox["width"] - 22)
        thumb_y = sbox["y"] + sbox["height"] / 2
        page.mouse.move(thumb_x, thumb_y)
        page.mouse.down()
        page.mouse.move(thumb_x - 80, thumb_y, steps=8)
        page.mouse.up()
        page.wait_for_timeout(400)
        k_after = slider_k("STIMULUS")
        amp_after = engine_params()["stim_amplitude"]
        exp_amp = 0.5 * (4 ** k_after)
        check("I1 slider drag changes value + engine follows 0.5*4^k",
              k_after < k_before and float(param_display("STIMULUS")) < float(amp_before)
              and abs(amp_after - exp_amp) < 1e-9,
              f"k {k_before} -> {k_after}, amp {amp_before} -> {amp_after} (map {exp_amp:.4f})")
        # I2: direct number entry (mapped value, e.g. 1.00 -> k = 0.5).
        stim_num = param_row("STIMULUS").locator(".param-number")
        stim_num.fill("1.00")
        stim_num.press("Enter")
        page.wait_for_timeout(400)
        check("I2 number entry sets mapped value + slider + engine",
              param_display("STIMULUS") == "1.00"
              and abs(slider_k("STIMULUS") - 0.5) < 0.002
              and abs(engine_params()["stim_amplitude"] - 1.0) < 1e-9,
              f"display={param_display('STIMULUS')} k={slider_k('STIMULUS'):.3f} "
              f"amp={engine_params()['stim_amplitude']}")
        # I3: steppers move k by 0.02 per click.
        step_up = param_row("STIMULUS").locator('.param-step[aria-label="STIMULUS 增大"]')
        step_down = param_row("STIMULUS").locator('.param-step[aria-label="STIMULUS 减小"]')
        step_up.click()
        page.wait_for_timeout(300)
        k_step1 = slider_k("STIMULUS")
        step_down.click()
        page.wait_for_timeout(200)
        step_down.click()
        page.wait_for_timeout(300)
        k_step2 = slider_k("STIMULUS")
        check("I3 steppers move k by 0.02 per click, engine follows",
              abs(k_step1 - 0.52) < 0.002 and abs(k_step2 - 0.48) < 0.002
              and abs(engine_params()["stim_amplitude"] - 0.5 * (4 ** 0.48)) < 1e-9,
              f"k 0.50 -> {k_step1:.3f} -> {k_step2:.3f} "
              f"amp={engine_params()['stim_amplitude']:.4f}")
        # I4: double-click the slider restores the default.
        stim_slider.dblclick()
        page.wait_for_timeout(400)
        check("I4 slider double-click restores default",
              param_display("STIMULUS") == "2.00"
              and abs(slider_k("STIMULUS") - 1.0) < 0.002
              and abs(engine_params()["stim_amplitude"] - 2.0) < 1e-9,
              f"display={param_display('STIMULUS')} amp={engine_params()['stim_amplitude']}")
        # I5: out-of-range number entry is clamped to the range ends.
        stim_num.fill("9.99")
        stim_num.press("Enter")
        page.wait_for_timeout(400)
        hi_ok = param_display("STIMULUS") == "2.00" \
            and abs(engine_params()["stim_amplitude"] - 2.0) < 1e-9
        stim_num.fill("0.01")
        stim_num.press("Enter")
        page.wait_for_timeout(400)
        lo_ok = param_display("STIMULUS") == "0.50" \
            and abs(engine_params()["stim_amplitude"] - 0.5) < 1e-9
        check("I5 out-of-range number entry clamps to 0.5 / 2.0",
              hi_ok and lo_ok,
              f"9.99 -> {'2.00' if hi_ok else 'NOT clamped'}, "
              f"0.01 -> {'0.50' if lo_ok else 'NOT clamped'}")
        stim_slider.dblclick()  # back to default
        page.wait_for_timeout(300)
        # I6: wheel on a slider still adjusts the engine param.
        conn_slider = param_row("CONNECTIVITY").locator(".param-slider")
        cbox = conn_slider.bounding_box()
        page.mouse.move(cbox["x"] + cbox["width"] / 2, cbox["y"] + cbox["height"] / 2)
        g0 = engine_params()["g"]
        page.mouse.wheel(0, 120)
        page.wait_for_timeout(300)
        g1 = engine_params()["g"]
        page.mouse.wheel(0, -120)
        page.wait_for_timeout(300)
        g2 = engine_params()["g"]
        check("I6 slider wheel decreases then increases G",
              g1 < g0 and g2 > g1 and abs(g2 - 0.35) < 1e-9,
              f"G {g0} -> {g1} -> {g2}")
        # I7: 978px layout still usable, no horizontal overflow.
        page.set_viewport_size({"width": 978, "height": 800})
        page.wait_for_timeout(1000)
        overflow = page.evaluate(
            "document.documentElement.scrollWidth > document.documentElement.clientWidth")
        dur_before = param_display("DURATION")
        dur_step = param_row("DURATION").locator('.param-step[aria-label="DURATION 增大"]')
        dur_step.scroll_into_view_if_needed()
        dur_step.click()
        page.wait_for_timeout(400)
        dur_after = param_display("DURATION")
        check("I7 978px: no overflow, stepper works",
              not overflow and dur_after != dur_before,
              f"overflow={overflow} DURATION {dur_before} -> {dur_after}")
        page.set_viewport_size({"width": 1920, "height": 1080})
        page.wait_for_timeout(500)

        check("H1 zero console errors", len(errors) == 0, f"errors={errors[:5]}")

        REPORT.write_text(json.dumps({
            "peak40": peak40,
            "responder_count": n_resp,
            "distal_node": distal_node,
            "distal_max_peak": distal_max,
            "window_snapshots": n_snaps,
            "checks": results,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        browser.close()
        failed = [r for r in results if not r["ok"]]
        print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
        raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
