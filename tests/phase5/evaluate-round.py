"""Decide one debug round's verdict from the JSON reports + step logs.

Pass criterion (matches docs/acceptance.md's own classification):
- build ok, phase3 16/16, phase4 23/23
- acceptance-test.py: every check ok EXCEPT the documented non-blocking
  "D1 first screen interactive (sim ready)" (SwiftShader first-screen time)
- retest.py: every check ok EXCEPT "D1 warm reload interactive"
- debug-round.py: every check ok
- compare.py: max |dE| and max |dI| over all scenarios < 1e-9
- cargo test: 8 passed, 0 failed
- node causal: "9/9 checks passed"

Anything else failing = round FAILED (fix it, restart counting from round 1).
Usage: python3 evaluate-round.py <N>. Exit 0 = round passed, 1 = failed.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PH5 = ROOT / "tests" / "phase5"
ROUND = sys.argv[1] if len(sys.argv) > 1 else "0"
LOGDIR = PH5 / "round-logs" / f"r{ROUND}"

verdicts = []


def verdict(name, ok, detail=""):
    verdicts.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def load_report(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return None, str(exc)
    if isinstance(data, dict) and "results" in data:
        return data["results"], ""
    return data, ""


def check_json(name, path, allow=()):
    rows, err = load_report(path)
    if rows is None:
        verdict(name, False, f"no report ({err})")
        return
    # note 行 ok is None：只是实测记录（D4/D7），不是失败，不计入。
    checks = [r for r in rows if r["ok"] is not None]
    bad = [r for r in checks if not r["ok"] and r["check"] not in allow]
    allowed_failed = [r["check"] for r in checks if not r["ok"] and r["check"] in allow]
    total = len(checks)
    verdict(name, not bad,
            f"{total - len([r for r in checks if not r['ok']])}/{total} ok"
            + (f"; allowed non-blocking failures: {allowed_failed}" if allowed_failed else "")
            + (f"; BLOCKING failures: {[r['check'] for r in bad]}" if bad else ""))


def main():
    check_json("phase3 browser (16)", ROOT / "tests/phase3/report.json")
    check_json("phase4 browser (23)", ROOT / "tests/phase4/report.json")
    check_json("phase5 acceptance", PH5 / "report.json",
               allow=("D1 first screen interactive (sim ready)",))
    check_json("phase5 retest", PH5 / "retest-report.json",
               allow=("D1 warm reload interactive",))
    check_json("debug-round (auth + usability)",
               PH5 / f"debug-round-r{ROUND}.json")

    # compare.py: max deviation over scenarios
    try:
        comp = json.loads((ROOT / "reference/python-model/outputs/compare.json").read_text())
        max_de = max(v["max_abs_dE"] for v in comp.values())
        max_di = max(v["max_abs_dI"] for v in comp.values())
        verdict("compare.py Python<->Rust", max_de < 1e-9 and max_di < 1e-9,
                f"max|dE|={max_de:.3e} max|dI|={max_di:.3e} (tolerance 1e-9)")
    except Exception as exc:  # noqa: BLE001
        verdict("compare.py Python<->Rust", False, str(exc))

    # cargo test log
    cargo_log = (LOGDIR / "cargo-test.log").read_text(errors="replace") if (LOGDIR / "cargo-test.log").exists() else ""
    m = re.search(r"test result: ok\. (\d+) passed; (\d+) failed", cargo_log)
    verdict("cargo test", bool(m) and int(m.group(1)) == 8 and int(m.group(2)) == 0,
            m.group(0) if m else "no test-result line in log")

    # node causal log
    node_log = (LOGDIR / "node-causal.log").read_text(errors="replace") if (LOGDIR / "node-causal.log").exists() else ""
    verdict("node causal 9/9", "9/9 checks passed" in node_log,
            "9/9 checks passed" if "9/9 checks passed" in node_log else node_log[-200:])

    # build log
    build_log = (LOGDIR / "build.log").read_text(errors="replace") if (LOGDIR / "build.log").exists() else ""
    verdict("npm run build", "built in" in build_log and "error" not in build_log.lower().split("built in")[0][-500:],
            "vite build succeeded" if "built in" in build_log else "no build success marker")

    failed = [v for v in verdicts if not v[1]]
    print(f"\nROUND {ROUND} VERDICT: {'PASS' if not failed else 'FAIL'} "
          f"({len(verdicts) - len(failed)}/{len(verdicts)} groups passed)")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
