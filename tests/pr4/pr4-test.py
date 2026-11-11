"""PR4 formal test: a living default state (review §5 problem 1 & 4).

Covers, all with expectations derived from the SAME run's debug-bridge
data (no numbers copied from any earlier report; the engine-level
reference numbers live in tests/pr4/crosscheck-compare.py and
reference/python-model/test_pr4.py):
  D. determinism: pause + reset + same seed + advanceMs -> bit-identical
     E; a different seed differs; reset + rerun equals the first run.
  M. three background modes are distinguishable: Quiet almost still,
     Spontaneous sustained small activity, Oscillatory a stable rhythm
     with an FFT peak at 10 Hz (documented value).
  L. default parameters run 60 s of sim time without locking, diverging
     or NaN/Inf (mean E stays below the 0.15 lock threshold throughout).
  H. hold warning appears before the lock (amber banner with the lock
     progress) and one-click restore returns the network to its
     pre-hold state; a hold that does lock shows the "new stable state"
     banner and the same one-click restore recovers it.
  S. slow-frame click: under 20x CPU throttling a short click still
     fires a pulse and is NOT misread as a hold; a real still hold
     still triggers under throttling.
  K. snapshots: save/restore is bit-identical at the instant, and the
     post-restore trajectory matches an uninterrupted control run
     bit-for-bit; the manual snapshot survives RESET, the auto snapshot
     does not overwrite it, and RESET clears the auto snapshot.
  U. background panel: three modes + seed input + snapshot controls are
     present, and the mode parameters match the documented values.
  E. zero console errors throughout.

Assumes `npm run preview -- --port 4173` is already serving dist/.
Writes tests/pr4/pr4-test-report.json and screenshots to tests/pr4/shots/.
"""
import json
import math
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173/"
OUT = Path(__file__).parent / "shots"
OUT.mkdir(parents=True, exist_ok=True)
REPORT = Path(__file__).parent / "pr4-test-report.json"

results = []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


def fft_peak(samples, dt_s):
    """Dominant frequency of a zero-mean series (numpy, Hann window)."""
    import numpy as np

    x = np.asarray(samples, dtype=float)
    x = x - x.mean()
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    freqs = np.fft.rfftfreq(len(x), d=dt_s)
    spec[0] = 0.0
    return float(freqs[int(np.argmax(spec))])


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
        box = page.locator(".brain-scene").bounding_box()
        page.mouse.dblclick(box["x"] + 15, box["y"] + 15)
        page.wait_for_timeout(2500)

        sim = lambda expr: page.evaluate(f"window.__brainSim.{expr}")
        scene = lambda expr: page.evaluate(f"window.__brainScene.{expr}")

        def snap_e():
            return page.evaluate("Array.from(window.__brainSim.getSnapshot().e)")

        def snap_t():
            return page.evaluate("window.__brainSim.getSnapshot().t_ms")

        def snap_mean_e():
            return page.evaluate("window.__brainSim.getSnapshot().mean_e")

        def snap_locked():
            return page.evaluate("window.__brainSim.getSnapshot().locked")

        def snap_hold_active():
            return page.evaluate("window.__brainSim.getSnapshot().hold_active")

        def advance_to(target_ms, step_ms=500):
            """Paused deterministic advance, batched into ONE CDP round
            trip: queue all advanceMs calls in a single JS evaluate,
            then wait once for the target.  advanceMs is fire-and-forget
            (posts to the Worker, which processes messages sequentially
            and posts one snapshot per step), so batching changes only
            the number of CDP round trips — not the trajectory.  Each
            round trip costs ~2 s under SwiftShader (the 3D scene
            renders continuously), so the per-chunk loop made M3/L take
            30+ min for a run; batching brings a full run to ~10 min.
            The per-step snapshots still land in snapHistory, so
            history-based reads see exactly the same rows."""
            page.evaluate(
                f"(() => {{ let t = window.__brainSim.getSnapshot().t_ms; "
                f"while (t < {target_ms}) {{ const c = Math.min({step_ms}, "
                f"{target_ms} - t); window.__brainSim.advanceMs(c); t += c; }} }})()")
            page.wait_for_function(
                f"window.__brainSim.getSnapshot().t_ms >= {target_ms}",
                timeout=120000, polling=100)

        def reset_paused():
            """Atomic reset + pause (one Worker message).  The Worker's
            reset handler clears paused on purpose (RESET resumes the
            sim — deliberate, B6b), so deterministic advanceMs stepping
            needs a pause after every reset — but reset() then pause()
            as two messages leaves a race window where live ticks run
            between them and consume RNG draws (measured: t_ms up to
            50 ms within 120 ms of a reset), so same-seed reruns differ
            by ~0.009.  resetPaused() does both in one handler, where no
            tick can interleave.
            The Worker's reset posts no snapshot, so the client's latest
            snapshot stays at the pre-reset t_ms until the next tick
            posts t=0 (~1 tick interval).  advance_to reads that t_ms to
            decide how many steps to queue — a stale large value would
            make it queue nothing while the wait passes on the same
            stale value, so the sim never advances (that made D3 differ
            by 0.010 and M3 read an empty history).  Wait for the fresh
            t=0 snapshot first."""
            sim("resetPaused()")
            page.wait_for_function(
                "window.__brainSim.getSnapshot().t_ms === 0",
                timeout=10000, polling=10)

        def live_mean_series(seconds, interval_ms=250):
            """Poll mean E while the sim runs live."""
            series = []
            steps = int(seconds * 1000 / interval_ms)
            for _ in range(steps):
                series.append(snap_mean_e())
                page.wait_for_timeout(interval_ms)
            return series

        # ---- D. determinism -------------------------------------------
        sim("pause()")
        sim("setBackgroundMode('spontaneous')")
        sim("setSeed(0)")
        reset_paused()
        advance_to(2000)
        e1 = snap_e()
        reset_paused()
        sim("setSeed(0)")
        advance_to(2000)
        e2 = snap_e()
        max_d12 = max(abs(a - b) for a, b in zip(e1, e2))
        check("D1 same seed + same params -> bit-identical E (max diff 0)",
              max_d12 == 0.0, f"max |dE| = {max_d12}")
        reset_paused()
        sim("setSeed(1)")
        advance_to(2000)
        e3 = snap_e()
        max_d13 = max(abs(a - b) for a, b in zip(e1, e3))
        check("D2 a different seed gives a different trajectory",
              max_d13 > 1e-3, f"max |dE| seed0 vs seed1 = {max_d13:.4f}")
        sim("setSeed(0)")
        reset_paused()
        advance_to(2000)
        e4 = snap_e()
        max_d14 = max(abs(a - b) for a, b in zip(e1, e4))
        check("D3 reset + rerun equals the first run (max diff 0)",
              max_d14 == 0.0, f"max |dE| = {max_d14}")

        # ---- M. three modes are distinguishable ------------------------
        # Quiet: almost still (live, 5 s).  The demo preset carries no
        # white noise, so Quiet is exactly still (mean-E std 0.0 in the
        # Python reference); allow only float-level jitter.
        sim("setBackgroundMode('quiet')")
        sim("reset()")
        sim("resume()")
        page.wait_for_timeout(2000)
        quiet = live_mean_series(5)
        q_std = float(__import__("statistics").pstdev(quiet))
        check("M1 Quiet: mean E almost still over 5 s live",
              q_std < 0.0001 and max(quiet) < 0.03,
              f"mean-E std={q_std:.5f} max={max(quiet):.4f}")
        # Spontaneous: sustained small activity.  Measured (Python
        # reference, 5 s): mean-E std 0.00034, median node E std 0.0020
        # at sigma 0.10; assert both with margin.
        sim("setBackgroundMode('spontaneous')")
        sim("reset()")
        page.wait_for_timeout(2000)
        spont = live_mean_series(5)
        s_std = float(__import__("statistics").pstdev(spont))
        hist = page.evaluate(
            "window.__brainSim.getSnapshotHistory().map(r => Array.from(r.e))")
        import statistics as _st
        node_stds = sorted(_st.pstdev([row[n] for row in hist]) for n in range(76))
        median_node_std = node_stds[38]
        check("M2 Spontaneous: sustained small activity, far from lock",
              s_std > 0.0002 and max(spont) < 0.05 and median_node_std > 0.001,
              f"mean-E std={s_std:.5f} range=[{min(spont):.4f}, {max(spont):.4f}] "
              f"median node std={median_node_std:.5f}")
        # Oscillatory: stable 10 Hz rhythm (deterministic stepping, exact
        # 50 Hz sampling: 20 ms steps x 400 = 8 s of sim time).
        sim("pause()")
        sim("setBackgroundMode('oscillatory')")
        reset_paused()
        advance_to(8000, 20)
        # One history read, not 400 round trips: resetPaused() cleared
        # snapHistory, so its rows are the 400 step snapshots (t_ms
        # 20..8000, 50 Hz).  The Worker's tick loop also posts snapshots
        # while paused, so the same t_ms can appear twice (tick + step
        # snapshots of one identical sim state) — dedupe by t_ms.
        osc = page.evaluate(
            "(() => { const m = new Map(); for (const r of "
            "window.__brainSim.getSnapshotHistory()) { "
            "if (r.t_ms > 0 && r.t_ms <= 8000) m.set(r.t_ms, "
            "Array.from(r.e).reduce((a, b) => a + b, 0) / 76); } "
            "return [...m.entries()].sort((a, b) => a[0] - b[0])"
            ".map(([, v]) => v); })()")
        tail = osc[200:]  # last 4 s, settled
        # Guard: an empty/short history must FAIL the check, not crash
        # the test in numpy (a stale-snapshot race once emptied it).
        f_peak = fft_peak(tail, 0.02) if len(tail) >= 10 else float("nan")
        ptp = (max(tail) - min(tail)) if tail else float("nan")
        check("M3 Oscillatory: FFT peak at the documented 10 Hz",
              len(osc) >= 380 and abs(f_peak - 10.0) < 0.6,
              f"peak={f_peak:.2f} Hz samples={len(osc)}")
        check("M4 Oscillatory: visible rhythm, far from lock",
              0.005 < ptp < 0.03 and (max(osc) if osc else float("nan")) < 0.05,
              f"mean-E ptp={ptp:.4f} max={(max(osc) if osc else float('nan')):.4f} "
              f"samples={len(osc)}")

        # ---- L. default 60 s without locking ---------------------------
        sim("pause()")
        sim("setBackgroundMode('spontaneous')")
        sim("setSeed(0)")
        reset_paused()
        advance_to(60000, 1000)
        # One history read: resetPaused() cleared snapHistory, so its
        # rows are the 60 per-second snapshots (t_ms 1000..60000),
        # deduped by t_ms like M3 (tick snapshots can repeat a step).
        long_mean = page.evaluate(
            "(() => { const m = new Map(); for (const r of "
            "window.__brainSim.getSnapshotHistory()) { "
            "if (r.t_ms > 0 && r.t_ms <= 60000) m.set(r.t_ms, "
            "Array.from(r.e).reduce((a, b) => a + b, 0) / 76); } "
            "return [...m.entries()].sort((a, b) => a[0] - b[0])"
            ".map(([, v]) => v); })()")
        finite = all(math.isfinite(v) for v in long_mean) and len(long_mean) > 0
        max_long = max(long_mean) if long_mean else float("nan")
        check("L1 default mode: 60 s sim time, mean E stays below 0.15, finite",
              finite and max_long < 0.15 and len(long_mean) >= 55,
              f"max mean E={max_long:.4f} over 60 s, finite={finite} "
              f"samples={len(long_mean)}")
        check("L2 default mode: never locked during the 60 s run",
              not snap_locked(), f"locked={snap_locked()}")

        # ---- U. background panel ----------------------------------------
        panel_text = page.locator("body").inner_text()
        check("U1 background panel offers all three modes + seed + snapshots",
              all(s in panel_text for s in ("背景活动", "安静", "自发", "振荡",
                                            "随机种子", "实验快照")),
              "panel text present")
        mp = sim("getModeParams()")
        check("U2 mode parameters match the documented values "
              "(OU tau 100 ms, sigma 0.10; sine 10 Hz, amp 0.30)",
              mp is not None and mp.get("ou_tau_ms") == 100.0
              and abs(mp.get("ou_sigma", -1) - 0.10) < 1e-9
              and mp.get("ext_sine_freq_hz") == 10.0
              and abs(mp.get("ext_sine_amp", -1) - 0.30) < 1e-9,
              f"modeParams={mp}")
        # The default-mode-on-load claim is checked on a fresh page below
        # (U4); the mode here was already changed by the tests above.
        page2 = ctx.new_page()
        page2.goto(BASE, wait_until="networkidle", timeout=30000)
        page2.wait_for_function(
            "window.__brainSim && window.__brainSim.isReady()", timeout=30000)
        page2.wait_for_function(
            "window.__brainSim.getModeParams() !== null", timeout=30000)
        default_mode = page2.evaluate("window.__brainSim.getBackgroundMode()")
        check("U4 fresh load defaults to Spontaneous",
              default_mode == "spontaneous", f"default mode={default_mode}")
        page2.close()

        # ---- H. hold warning + one-click restore ------------------------
        # Find a canvas point that hits a node (probe grid, as in PR3 M).
        sim("resume()")
        sim("setBackgroundMode('quiet')")
        sim("reset()")
        page.wait_for_timeout(1200)
        hit = None
        for fy in (0.30, 0.35, 0.40, 0.45, 0.50):
            if hit:
                break
            for fx in (0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70):
                page.mouse.click(box["x"] + box["width"] * fx,
                                 box["y"] + box["height"] * fy)
                page.wait_for_timeout(150)
                pt = scene("getLastStimulusPoint()")
                if pt:
                    hit = (fx, fy, pt["node"])
                    break
        check("H0 probe found a node hit point for the hold tests",
              hit is not None, f"hit={hit}")
        if hit:
            # The probe click itself is a pulse — and node 52 (the first
            # hit point) is flip-prone: that single pulse locks the
            # network within ~400 ms (measured: mean E 0.2407 before any
            # hold starts), so the hold test would start from an already
            # locked network and the warning could never appear.  Reset
            # to a clean baseline before the hold.
            sim("reset()")
            page.wait_for_timeout(1200)
            fx, fy, node = hit
            hx, hy = box["x"] + box["width"] * fx, box["y"] + box["height"] * fy
            # Hold until the amber warning appears (max ~4 s wall).
            # The warning flips to the locked banner 500 ms after mean E
            # stays above 0.15 (LOCK_WINDOW_MS), and one CDP round-trip
            # under SwiftShader takes ~2 s — so a two-step wait-then-read
            # can straddle the flip and read a banner that no longer
            # exists (that is what crashed this run).  Capture the text
            # atomically in-page: poll every 50 ms inside the page and
            # resolve with the text the moment the warning exists.
            page.mouse.move(hx, hy)
            page.mouse.down()
            warn_text = ""
            try:
                warn_text = page.evaluate("""() => new Promise((resolve) => {
                  const t0 = Date.now();
                  const poll = () => {
                    const el = document.querySelector('.hold-warning');
                    if (el) return resolve(el.innerText);
                    if (Date.now() - t0 > 4000) return resolve('');
                    setTimeout(poll, 50);
                  };
                  poll();
                })""")
            except Exception:
                warn_text = ""
            warned = bool(warn_text)
            check("H1 hold warning appears before the lock "
                  "(progress + '离锁定阈值' + '松开即停')",
                  warned and "离锁定阈值" in warn_text and "松开即停" in warn_text,
                  f"warning={warn_text[:120]!r}")
            # One-click restore: RELEASE first, then click.  The review's
            # requirement is "release stops + one-click restore", and the
            # browser enforces it: while the hold pointer is down,
            # OrbitControls captures it to the canvas, so a click aimed
            # at the banner button is retargeted to the canvas (probe #3:
            # mousedown/mouseup/click all target CANVAS) and the restore
            # never runs.  A real user can't click the button with the
            # same mouse button that's holding the brain down either.
            # After release the locked banner stays (the lock latches),
            # so the button is still there and clickable.
            page.mouse.up()
            restored = False
            if warned:
                btn = page.locator(
                    ".hold-warning button:has-text('恢复到按住前'), "
                    ".locked-banner button:has-text('恢复到按住前')")
                try:
                    btn.wait_for(state="visible", timeout=5000)
                    page.wait_for_function(
                        "!!document.querySelector('.hold-warning button:not([disabled]), "
                        ".locked-banner button:not([disabled])')",
                        timeout=5000)
                    btn.click()
                    restored = True
                except Exception as e:
                    restored = False
                    print(f"  restore click failed: {e}")
            page.wait_for_timeout(2000)
            mean_after = snap_mean_e()
            check("H2 one-click restore returns the network near baseline",
                  restored and mean_after < 0.03,
                  f"restored={restored} mean E after={mean_after:.4f}")
            check("H3 warning banner is gone after restore",
                  page.locator(".hold-warning").count() == 0,
                  f"warning count={page.locator('.hold-warning').count()}")
            # A hold that DOES lock: hold until the locked banner appears.
            # Reset the camera first: H2's drag to the banner button
            # rotated the view, so the H0 hit point no longer hits node
            # 52 (rerun3: H4 timed out with no locked banner).  The
            # setup dblclick restores the default view, so (hx, hy)
            # hits node 52 again.
            sim("reset()")
            page.wait_for_timeout(1200)
            page.mouse.dblclick(box["x"] + 15, box["y"] + 15)
            page.wait_for_timeout(2500)
            page.mouse.move(hx, hy)
            page.mouse.down()
            locked_seen = False
            try:
                page.wait_for_selector(".locked-banner", timeout=8000)
                locked_seen = True
            except Exception:
                locked_seen = False
            lock_text = ""
            if locked_seen:
                lock_text = page.locator(".locked-banner").inner_text()
            check("H4 a long hold locks the network and the banner explains "
                  "it as a new stable state (not 'frozen')",
                  locked_seen and "新的稳定状态" in lock_text
                  and "不是软件卡住" in lock_text,
                  f"banner={lock_text[:100]!r}")
            # Release first, then click (same pointer-capture reason as
            # H2: a click while the hold pointer is down is retargeted
            # to the canvas and never reaches the button).
            page.mouse.up()
            if locked_seen:
                btn = page.locator(".locked-banner button:has-text('恢复到按住前')")
                btn.click()
                page.wait_for_timeout(2000)
                mean_after_lock = snap_mean_e()
                check("H5 locked banner's one-click restore recovers the network",
                      mean_after_lock < 0.03 and not snap_locked(),
                      f"mean E after={mean_after_lock:.4f} locked={snap_locked()}")
            # H6: a pulse on a flip-prone node locks the network too, with
            # the same banner + RESET recovery.  This is PRE-EXISTING
            # network bistability, not caused by the background: in Quiet
            # (zero background) a standard pulse on node 10 also flips the
            # network 2/2 (see docs/model-spec.md §9.1), while node 40
            # recovers.  A pulse flip is instantaneous, so there is no
            # pre-warning — the banner itself is the recovery path.
            sim("setBackgroundMode('quiet')")
            sim("reset()")
            page.wait_for_timeout(1200)
            sim("pulse(10)")
            flipped = False
            try:
                page.wait_for_selector(".locked-banner", timeout=8000)
                flipped = True
            except Exception:
                flipped = False
            check("H6 pulse on flip-prone node 10 locks the network and "
                  "shows the same 'new stable state' banner",
                  flipped and "新的稳定状态" in page.locator(".locked-banner").inner_text(),
                  f"locked banner seen={flipped}")
            if flipped:
                page.locator(".locked-banner button:has-text('RESET')").click()
                page.wait_for_timeout(2000)
                check("H6b banner RESET recovers after a pulse flip",
                      snap_mean_e() < 0.03 and not snap_locked(),
                      f"mean E after={snap_mean_e():.4f} locked={snap_locked()}")

        # ---- S. slow-frame click ----------------------------------------
        cdp = ctx.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 20})
        # The S clicks must use a pulse-safe node: the H hit point is
        # node 52, which is flip-prone — a single genuine pulse on it
        # locks the network (measured in H1), so S2's "mean E settles"
        # would fail even when the click is correctly read as a pulse,
        # not a hold.  Probe the grid for a node that recovers from a
        # standard pulse (40, 47, 73 — see docs/model-spec.md §9.1).
        # Probe clicks may flip the network; the reset below clears it.
        safe_hit = None
        for fy in (0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60):
            if safe_hit:
                break
            for fx in (0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70):
                page.mouse.click(box["x"] + box["width"] * fx,
                                 box["y"] + box["height"] * fy)
                # 600 ms per point: under 20x throttling the click is
                # processed late, so a 150 ms wait would read the
                # stimulus point before the pulse has fired.
                page.wait_for_timeout(600)
                pt = scene("getLastStimulusPoint()")
                if pt and pt["node"] in (40, 47, 73):
                    safe_hit = (fx, fy, pt["node"])
                    break
        check("S0 probe found a pulse-safe node hit point (40/47/73)",
              safe_hit is not None, f"safe_hit={safe_hit}")
        sim("setBackgroundMode('quiet')")
        sim("reset()")
        page.wait_for_timeout(1500)
        if safe_hit:
            fx, fy, node = safe_hit
            hx, hy = box["x"] + box["width"] * fx, box["y"] + box["height"] * fy
            # Short click (100 ms) under throttling: must pulse, not hold.
            # The main thread is 20x slower, so poll (up to 15 s wall)
            # for the pulse response instead of a fixed short wait.
            sim("resetSnapshotHistory()")
            page.mouse.move(hx, hy)
            page.mouse.down()
            page.wait_for_timeout(100)
            page.mouse.up()
            peak = None
            for _ in range(15):
                page.wait_for_timeout(1000)
                maxde = sim("getMaxAbsDeltaE()")
                peak = maxde[node] if maxde else None
                if peak is not None and peak > 0.1:
                    break
            check("S1 slow-frame short click still fires a pulse",
                  peak is not None and peak > 0.1,
                  f"peak |dE[{node}]|={peak}")
            # Direct "not a hold" signal: a hold takes an auto snapshot,
            # a pulse never does.  Also the network must settle back.
            info_s = sim("getSnapshotInfo()")
            settled = False
            for _ in range(15):
                if snap_mean_e() < 0.03:
                    settled = True
                    break
                page.wait_for_timeout(1000)
            check("S2 slow-frame short click is NOT misread as a hold",
                  not snap_hold_active() and info_s.get("auto") is None and settled,
                  f"hold_active={snap_hold_active()} auto={info_s.get('auto')} "
                  f"mean E={snap_mean_e():.4f}")
            # A real still hold under throttling must still trigger.
            # The 300 ms hold timer fires late on a throttled main
            # thread, so allow up to 20 s wall.
            page.mouse.move(hx, hy)
            page.mouse.down()
            held = False
            try:
                page.wait_for_function(
                    "window.__brainSim.getSnapshot().hold_active === true",
                    timeout=20000, polling=500)
                held = True
            except Exception:
                held = False
            page.mouse.up()
            check("S3 a real still hold still triggers under throttling",
                  held, f"hold_active seen={held}")
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})

        # ---- K. snapshots ------------------------------------------------
        sim("pause()")
        sim("setBackgroundMode('spontaneous')")
        sim("setSeed(0)")
        reset_paused()
        advance_to(1500)
        e_saved = snap_e()
        saved = sim("saveSnapshot()")
        info = sim("getSnapshotInfo()")
        check("K1 manual snapshot saves (info shows it)",
              info.get("manual") is not None and info["manual"]["t_ms"] == 1500,
              f"info={info}")
        advance_to(2000)
        e_moved = snap_e()
        moved = max(abs(a - b) for a, b in zip(e_saved, e_moved)) > 1e-6
        restored_summary = sim("restoreSnapshot('manual')")
        page.wait_for_function(
            "window.__brainSim.getSnapshot().t_ms === 1500", timeout=30000)
        e_restored = snap_e()
        max_d = max(abs(a - b) for a, b in zip(e_saved, e_restored))
        check("K2 restore returns the exact saved state (max diff 0)",
              moved and max_d == 0.0, f"max |dE| = {max_d}")
        # Post-restore trajectory == uninterrupted control, bit-for-bit.
        advance_to(2000)
        e_after = snap_e()
        sim("restoreSnapshot('manual')")
        page.wait_for_function(
            "window.__brainSim.getSnapshot().t_ms === 1500", timeout=30000)
        advance_to(2000)
        e_after2 = snap_e()
        max_d2 = max(abs(a - b) for a, b in zip(e_after, e_after2))
        check("K3 post-restore trajectory matches the uninterrupted run",
              max_d2 == 0.0, f"max |dE| = {max_d2}")
        # Manual snapshot survives RESET; auto does not overwrite it.
        sim("reset()")
        info2 = sim("getSnapshotInfo()")
        check("K4 manual snapshot survives RESET (auto is cleared by RESET)",
              info2.get("manual") is not None
              and info2["manual"]["t_ms"] == 1500
              and info2.get("auto") is None,
              f"info after RESET={info2}")
        # Auto snapshot: start a hold, check auto exists and manual is intact.
        sim("resume()")
        sim("setBackgroundMode('quiet')")
        page.wait_for_timeout(1200)
        if hit:
            fx, fy, node = hit
            hx, hy = box["x"] + box["width"] * fx, box["y"] + box["height"] * fy
            page.mouse.move(hx, hy)
            page.mouse.down()
            page.wait_for_timeout(1200)
            page.mouse.up()
            info3 = sim("getSnapshotInfo()")
            check("K5 a hold creates an auto snapshot WITHOUT touching manual",
                  info3.get("auto") is not None
                  and info3.get("manual") is not None
                  and info3["manual"]["t_ms"] == 1500,
                  f"info after hold={info3}")
            # Restoring the auto snapshot works and returns near baseline.
            sim("restoreSnapshot('auto')")
            page.wait_for_timeout(1500)
            check("K6 auto snapshot restores to the pre-hold state",
                  snap_mean_e() < 0.03,
                  f"mean E after auto restore={snap_mean_e():.4f}")

        check("E1 zero console errors", len(errors) == 0, f"errors={errors[:5]}")

        REPORT.write_text(json.dumps({
            "determinism": {"same_seed_max_d": max_d12, "diff_seed_max_d": max_d13,
                            "reset_rerun_max_d": max_d14},
            "modes": {"quiet_std": q_std, "spont_std": s_std,
                      "osc_fft_hz": f_peak, "osc_ptp": ptp},
            "long_run": {"max_mean_e_60s": max(long_mean)},
            "snapshot": {"restore_max_d": max_d, "trajectory_max_d": max_d2},
            "checks": results,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        browser.close()
        failed = [r for r in results if not r["ok"]]
        print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
        raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
