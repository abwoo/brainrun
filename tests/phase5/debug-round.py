"""Phase 5 multi-round debug: authenticity spot-check + fresh-eyes usability pass.

Authenticity: for 3 regions, panel E readout vs window.__brainSim snapshot E,
before stimulus (baseline) and while held (elevated) -- both must agree within
0.005 while the clock is paused (frozen E, so the comparison is exact).
Also: no stimulus -> no activity at all.

Usability (fresh eyes): click 5 different regions, change each of the 4 knobs
once via the UI wheel, pause/resume via PLAY, Reset, then repeat a click at
978 px. Zero console errors throughout. Anything odd is recorded in
`observations` (printed and saved), even if it does not fail a check.

Usage: python tests/phase5/debug-round.py <round-number>
Writes tests/phase5/debug-round-r<round>.json. Prereq: npm run preview on :4173.
"""
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173/"
HERE = Path(__file__).parent
ROUND = sys.argv[1] if len(sys.argv) > 1 else "0"

results = []
observations = []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def observe(msg):
    observations.append(msg)
    print(f"NOTE  {msg}")


def sim_time(page):
    txt = page.locator(".bottombar .mono").inner_text()
    m = re.search(r"TIME ([\d.]+) S", txt)
    return float(m.group(1)) if m else -1.0


def panel_e(page):
    txt = page.locator(".region-panel").inner_text()
    m = re.search(r"兴奋活动 E\s*\n([\d.]+)", txt)
    return float(m.group(1)) if m else None


def panel_sel(page):
    txt = page.locator(".region-panel").inner_text()
    m = re.search(r"#(\d+) / 76", txt)
    return int(m.group(1)) if m else None


def knob_value(page, idx):
    return page.locator(".knob-value").nth(idx).inner_text()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=(
            Path.home() / ".cache/ms-playwright/chromium-1254/chrome-linux64/chrome"
        ), args=[
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
        ])
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

        box = page.locator(".brain-scene").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        rot_btn = page.locator("button:has-text('旋转')")
        if "开" in rot_btn.inner_text():
            rot_btn.click()
            page.wait_for_timeout(300)

        # ---- Authenticity 1: no stimulus -> no activity --------------------
        page.evaluate("window.__brainSim.reset()")
        page.wait_for_timeout(1500)
        snap0 = page.evaluate("window.__brainSim.getSnapshot()")
        max_e0 = max(snap0["e"])
        markers0 = page.evaluate("window.__brainSim.getMarkers()")
        check("auth no stimulus, no activity",
              max_e0 < 0.05 and len(markers0) == 0,
              f"max E={max_e0:.4f} (baseline ~0.011), markers={len(markers0)}")

        # ---- Authenticity 2: panel E vs snapshot E, 3 regions x before/after
        points = [(cx, cy - 40), (cx - 160, cy + 40), (cx + 160, cy - 60)]
        for k, (x, y) in enumerate(points):
            page.mouse.click(x, y)
            page.wait_for_timeout(800)  # click pulse (~72 ms) has decayed
            sel = panel_sel(page)
            if sel is None:
                check(f"auth region {k}: selected", False, f"click at ({x:.0f},{y:.0f}) selected nothing")
                observe(f"click at ({x:.0f},{y:.0f}) hit no region -- noted, not fatal")
                continue
            page.evaluate("window.__brainSim.pause()")
            page.wait_for_timeout(500)  # let the 15 Hz panel sync to frozen E
            pe = panel_e(page)
            se = page.evaluate(f"window.__brainSim.getSnapshot().e[{sel}]")
            check(f"auth region {k} ({sel}) baseline: panel E == snapshot E",
                  pe is not None and abs(pe - se) < 0.005,
                  f"panel={pe} snapshot={se:.4f}")
            page.evaluate("window.__brainSim.resume()")
            page.evaluate(f"window.__brainSim.holdStart({sel})")
            page.wait_for_timeout(800)  # E rises and stays while held
            page.evaluate("window.__brainSim.pause()")
            page.wait_for_timeout(500)
            pe2 = panel_e(page)
            se2 = page.evaluate(f"window.__brainSim.getSnapshot().e[{sel}]")
            check(f"auth region {k} ({sel}) held: panel E == snapshot E",
                  pe2 is not None and abs(pe2 - se2) < 0.005 and se2 > 0.2,
                  f"panel={pe2} snapshot={se2:.4f} (must be elevated >0.2)")
            page.evaluate(f"window.__brainSim.holdEnd({sel})")
            page.evaluate("window.__brainSim.reset()")
            page.wait_for_timeout(500)

        # ---- Usability: 5 different regions --------------------------------
        seen = []
        for (x, y) in [(cx, cy - 40), (cx - 180, cy - 20), (cx + 180, cy - 20),
                       (cx - 80, cy + 100), (cx + 80, cy - 100)]:
            page.mouse.click(x, y)
            page.wait_for_timeout(600)
            sel = panel_sel(page)
            if sel is not None:
                seen.append(sel)
        distinct = len(set(seen))
        check("usability 5 clicks select regions",
              len(seen) == 5 and distinct >= 4,
              f"selected ids in order: {seen} ({distinct} distinct)")
        if len(seen) < 5:
            observe(f"only {len(seen)}/5 fresh-eyes clicks selected a region")

        # ---- Usability: 4 knobs, one wheel change each ----------------------
        knob_names = ["STIMULUS", "DURATION", "EXC / INH", "CONNECTIVITY"]
        param_keys = ["stim_amplitude", "stim_duration_ms", "c_ei", "g"]
        for idx in range(4):
            dial = page.locator(".knob-dial").nth(idx)
            dial_box = dial.bounding_box()
            v0 = knob_value(page, idx)
            p0 = page.evaluate("window.__brainSim.getParams()")[param_keys[idx]]
            page.mouse.move(dial_box["x"] + dial_box["width"] / 2,
                            dial_box["y"] + dial_box["height"] / 2)
            page.mouse.wheel(0, 120)
            page.wait_for_timeout(400)
            v1 = knob_value(page, idx)
            p1 = page.evaluate("window.__brainSim.getParams()")[param_keys[idx]]
            check(f"usability knob {knob_names[idx]} wheel changes value+engine",
                  v1 != v0 and p1 != p0,
                  f"{knob_names[idx]}: {v0} -> {v1}, engine {param_keys[idx]}: {p0} -> {p1}")
            page.mouse.wheel(0, -120)  # restore approx.
            page.wait_for_timeout(200)

        # ---- Usability: pause / resume / reset via UI -----------------------
        page.locator("button:has-text('PLAY')").click()
        page.wait_for_timeout(300)
        u1 = sim_time(page)
        page.wait_for_timeout(1000)
        u2 = sim_time(page)
        check("usability PLAY pauses clock", u1 == u2, f"TIME {u1} -> {u2} s")
        page.locator("button:has-text('PLAY')").click()
        page.wait_for_timeout(1200)
        u3 = sim_time(page)
        check("usability PLAY resumes clock", u3 > u2, f"TIME {u2} -> {u3} s")
        page.locator("button:has-text('RESET')").click()
        page.wait_for_timeout(500)
        u4 = sim_time(page)
        params = page.evaluate("window.__brainSim.getParams()")
        check("usability RESET restores t~0 and defaults", u4 < 1.0
              and abs(params["g"] - 0.35) < 1e-9 and abs(params["c_ei"] - 4.0) < 1e-9,
              f"TIME {u4} s, params={params}")

        # ---- Usability: 978 px ----------------------------------------------
        page.set_viewport_size({"width": 978, "height": 800})
        page.wait_for_timeout(1000)
        overflow = page.evaluate(
            "document.documentElement.scrollWidth > document.documentElement.clientWidth")
        box2 = page.locator(".brain-scene").bounding_box()
        page.mouse.click(box2["x"] + box2["width"] / 2, box2["y"] + box2["height"] / 2 - 40)
        page.wait_for_timeout(600)
        sel978 = panel_sel(page)
        check("usability 978px click selects, no overflow",
              sel978 is not None and not overflow,
              f"selected=#{sel978}, horizontal overflow={overflow}")

        check("usability no console errors", len(errors) == 0, f"errors={errors[:3]}")
        browser.close()

    failed = [r for r in results if not r["ok"]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    (HERE / f"debug-round-r{ROUND}.json").write_text(
        json.dumps({"results": results, "observations": observations},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
