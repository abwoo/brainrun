#!/usr/bin/env python3
"""Brain Physics Playground — 下载 TVB 示例数据（构建时步骤）.

把三个原始文件下载到 scripts/prepare-brain-data/raw/，并做 SHA-256 校验，
任一失败即非零退出（CI 构建应直接失败，而不是静默缺资产上线）。

下载源：tvb-data GitHub 仓库，URL 钉死提交
f1a3e7dc5370158df721f206c9c9bfad55d98172（该仓库已归档，该提交即 HEAD，
不会漂移）。SHA-256 已在 2026-11-11 与本地 raw/ 文件逐字节核对一致
（见 docs/data-license.md）。

用法: python3 scripts/prepare-brain-data/fetch.py
依赖: Python 3 标准库（urllib + hashlib），无第三方依赖。
已有文件且 SHA-256 一致时跳过下载（本地开发可反复跑）。
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"

PINNED_COMMIT = "f1a3e7dc5370158df721f206c9c9bfad55d98172"
BASE = (
    "https://raw.githubusercontent.com/the-virtual-brain/tvb-data/"
    f"{PINNED_COMMIT}/tvb_data"
)

# (文件名, URL, SHA-256)
FILES = [
    (
        "connectivity_76.zip",
        f"{BASE}/connectivity/connectivity_76.zip",
        "8b856d5fa80a8593e01dc18b95efff829ca98d2daf43cea38fd3309fed726b2e",
    ),
    (
        "cortex_16384.zip",
        f"{BASE}/surfaceData/cortex_16384.zip",
        "e07db0106a71313a2ef1948271c1ce84297b73745869d9f2f7a1e1719dcb2973",
    ),
    (
        "regionMapping_16k_76.txt",
        f"{BASE}/regionMapping/regionMapping_16k_76.txt",
        "e108b01017bfc4f8c3c0cedde711b2f54d18b7c05b232e297ba9d4b9528283a0",
    ),
]


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fail(msg: str) -> "SystemExit":
    print(f"FETCH FAILED: {msg}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for name, url, expected in FILES:
        dest = RAW / name
        if dest.exists() and sha256_of(dest) == expected:
            print(f"  - {name}: 已存在且 SHA-256 一致，跳过下载")
            continue
        print(f"  - {name}: 下载 {url}")
        try:
            urllib.request.urlretrieve(url, dest)
        except Exception as exc:  # noqa: BLE001 - 下载失败即构建失败
            fail(f"下载 {url} 失败: {exc}")
        actual = sha256_of(dest)
        if actual != expected:
            dest.unlink(missing_ok=True)
            fail(f"{name} SHA-256 不符: 期望 {expected}, 实际 {actual}")
        print(f"  - {name}: SHA-256 一致")
    print(f"原始文件就绪: {RAW}")


if __name__ == "__main__":
    main()
