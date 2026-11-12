#!/usr/bin/env python3
"""PR8-B 第一阶段补跑：978px 视口量测 + 无教程走查（不截图，只量测）。

背景：完整版 audit-layout.py 在第三轮因 SwiftShader GPU 进程饱和，
截图反复超时（已超 3 次，按止损规则停掉截图测试）；1920x1080 的量测
在三轮里结果完全一致、无需再跑。本脚本只补 978x800 的全部量测与
走查；截图只留走查的三张（单次尝试、10 秒超时，失败即记过）。
1920 的截图证据沿用第一/二轮 tests/pr8/layout-shots/ 已有的文件。
输出：tests/pr8/layout-audit-raw-978.json（随后并入 layout-audit-raw.json）。
"""
import importlib.util
import json
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BASE = "http://127.0.0.1:4174/"

spec = importlib.util.spec_from_file_location("audit_layout", os.path.join(HERE, "audit-layout.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def shot_once(page, name):
    p = os.path.join(mod.SHOTS, name + ".png")
    try:
        page.screenshot(path=p, timeout=10000, animations="disabled")
        print(f"  shot ok: {name}")
    except Exception as e:
        print(f"  shot skipped (env): {name}: {str(e)[:120]}")
        mod.RESULTS.setdefault("shot_failures", []).append(f"{name}: {str(e)[:200]}")


def main():
    # 978 视口：量测全跑，截图停掉
    mod.shot = lambda page, name: None
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=[
            "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl"])
        page = browser.new_page(viewport={"width": 978, "height": 800})
        page.on("pageerror", lambda e: mod.RESULTS["page_errors"].append(str(e)))
        page.on("console", lambda m: mod.RESULTS["page_errors"].append(f"console.error: {m.text}") if m.type == "error" else None)
        try:
            mod.audit_viewport(page, 978, 800)
            # 走查：恢复单次截图
            mod.shot = shot_once
            mod.walkthrough(page)
        finally:
            browser.close()
    out = os.path.join(ROOT, "tests", "pr8", "layout-audit-raw-978.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(mod.RESULTS, f, ensure_ascii=False, indent=2)
    print("slim results ->", out)
    print("page errors:", len(mod.RESULTS["page_errors"]))
    for e in mod.RESULTS["page_errors"][:10]:
        print("  ERR", e[:300])


if __name__ == "__main__":
    main()
