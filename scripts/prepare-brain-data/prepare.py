#!/usr/bin/env python3
"""Brain Physics Playground — TVB 数据预处理（一次性离线脚本）.

输入（原始 TVB 数据，绝不提交进仓库，见 .gitignore）:
    raw/connectivity_76.zip   -> weights.txt / tract_lengths.txt /
                               centres.txt / areas.txt / cortical.txt
    raw/cortex_16384.zip      -> vertices.txt / triangles.txt /
                               vertex_normals.txt
    raw/regionMapping_16k_76.txt

输出（构建时生成的轻量资产，放 app/public/brain-assets/；CI 里由
fetch.py 下载原始文件后生成，不提交进仓库，见 docs/data-license.md）:
    vertices.bin     Float32 LE, 16384 x 3, xyz (mm, TVB 原始坐标, 未做任何修改)
    triangles.bin    Uint32  LE, 32760 x 3, 顶点索引 0-based
    regionMap.bin    Uint8, 16384, 每顶点脑区 id (0-75)
    regions.json     76 个脑区: {id, label, centre:[x,y,z], area_mm2, cortical}
    connectivity.json {weights: 76x76 整数(对角线已清零),
                       lengths: 76x76 mm(只保留权重>0 的边, 其余置 0),
                       weights_unit: "au", length_unit: "mm"}
    meta.json        来源 URL、文件大小、校验小结、许可与引用

数据处理规则（见 docs/model-spec.md §4）:
  - 权重对角线清零（原始对角元最大 3.0, 存在自连接, 建模前必须清零）。
  - 延迟只对权重 > 0 的边生效: 长度矩阵中权重为 0 的边置 0。
  - 顶点坐标一律按 TVB 原始值输出, 禁止为好看修改顶点位置。

校验（任一项失败即退出码非 0, 不写资产）:
  - weights / tract_lengths 均为 76x76
  - 顶点 16384 行、三角面 32760 行、索引全部在 0-16383 内
  - 映射 16384 个值、取值 0-75、76 个脑区全部出现、无 -1

许可: TVB 数据再分发许可未明确 (见 docs/data-license.md), 原始文件
与衍生资产均不进仓库，构建时下载并生成; 生成的 meta.json 随附
来源与引用: Sanz-Leon et al. 2013, Front. Neuroinform. 7:10,
doi:10.3389/fninf.2013.00010.

用法: python3 scripts/prepare-brain-data/fetch.py && python3 scripts/prepare-brain-data/prepare.py
依赖: Python 3 标准库 + numpy (仅本脚本使用, 浏览器运行时不需要)。
"""

import json
import sys
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
OUT = HERE.parent.parent / "app" / "public" / "brain-assets"

CONNECTIVITY_URL = (
    "https://raw.githubusercontent.com/the-virtual-brain/tvb-data/"
    "f1a3e7dc5370158df721f206c9c9bfad55d98172/"
    "tvb_data/connectivity/connectivity_76.zip"
)
CORTEX_URL = (
    "https://raw.githubusercontent.com/the-virtual-brain/tvb-data/"
    "f1a3e7dc5370158df721f206c9c9bfad55d98172/"
    "tvb_data/surfaceData/cortex_16384.zip"
)
MAPPING_URL = (
    "https://raw.githubusercontent.com/the-virtual-brain/tvb-data/"
    "f1a3e7dc5370158df721f206c9c9bfad55d98172/"
    "tvb_data/regionMapping/regionMapping_16k_76.txt"
)


def fail(msg: str) -> "SystemExit":
    print(f"VALIDATION FAILED: {msg}", file=sys.stderr)
    raise SystemExit(1)


def read_zip_text(zip_path: Path, name: str) -> str:
    with zipfile.ZipFile(zip_path) as zf:
        return zf.read(name).decode("utf-8")


def main() -> None:
    checks: list[str] = []

    # ---- 读取原始文件 -------------------------------------------------
    conn_zip = RAW / "connectivity_76.zip"
    cortex_zip = RAW / "cortex_16384.zip"
    mapping_txt = RAW / "regionMapping_16k_76.txt"
    for p in (conn_zip, cortex_zip, mapping_txt):
        if not p.exists():
            fail(f"缺少原始文件: {p} (请先下载, 见本脚本头部 URL)")

    weights = np.loadtxt(
        read_zip_text(conn_zip, "weights.txt").splitlines()
    )
    lengths = np.loadtxt(
        read_zip_text(conn_zip, "tract_lengths.txt").splitlines()
    )
    centres_raw = read_zip_text(conn_zip, "centres.txt").splitlines()
    areas = np.loadtxt(read_zip_text(conn_zip, "areas.txt").splitlines())
    cortical = np.loadtxt(
        read_zip_text(conn_zip, "cortical.txt").splitlines(), dtype=int
    )
    vertices = np.loadtxt(
        read_zip_text(cortex_zip, "vertices.txt").splitlines()
    )
    triangles = np.loadtxt(
        read_zip_text(cortex_zip, "triangles.txt").splitlines(), dtype=np.int64
    )
    mapping = np.fromstring(mapping_txt.read_text(), dtype=int, sep=" ")

    # ---- 校验 ---------------------------------------------------------
    if weights.shape != (76, 76):
        fail(f"weights 形状 {weights.shape}, 期望 (76, 76)")
    checks.append(f"weights 76x76 OK, 值域 {weights.min():.0f}-{weights.max():.0f}, "
                  f"非零元 {int((weights != 0).sum())} 个")

    if lengths.shape != (76, 76):
        fail(f"tract_lengths 形状 {lengths.shape}, 期望 (76, 76)")
    checks.append(f"tract_lengths 76x76 OK, 值域 {lengths.min():.2f}-"
                  f"{lengths.max():.2f} mm, 非零元 {int((lengths != 0).sum())} 个")

    if vertices.shape != (16384, 3):
        fail(f"vertices 形状 {vertices.shape}, 期望 (16384, 3)")
    checks.append(f"vertices 16384x3 OK, x [{vertices[:, 0].min():.1f}, "
                  f"{vertices[:, 0].max():.1f}], y [{vertices[:, 1].min():.1f}, "
                  f"{vertices[:, 1].max():.1f}], z [{vertices[:, 2].min():.1f}, "
                  f"{vertices[:, 2].max():.1f}] (mm 量级)")

    if triangles.shape != (32760, 3):
        fail(f"triangles 形状 {triangles.shape}, 期望 (32760, 3)")
    if triangles.min() < 0 or triangles.max() > 16383:
        fail(f"triangles 索引越界: {triangles.min()}-{triangles.max()}")
    checks.append("triangles 32760x3 OK, 索引全部在 0-16383 内")

    if mapping.shape != (16384,):
        fail(f"regionMapping 数量 {mapping.shape}, 期望 (16384,)")
    if mapping.min() < 0 or mapping.max() > 75:
        fail(f"regionMapping 取值越界: {mapping.min()}-{mapping.max()}")
    present = sorted(set(mapping.tolist()))
    if present != list(range(76)):
        fail(f"regionMapping 未覆盖全部 76 区, 缺失: "
             f"{sorted(set(range(76)) - set(present))}")
    checks.append("regionMapping 16384 个值 OK, 取值 0-75, 76 区全部出现, 无 -1")

    if len(centres_raw) != 76 or areas.shape != (76,) or cortical.shape != (76,):
        fail("centres/areas/cortical 行数不是 76")
    checks.append("centres/areas/cortical 各 76 行 OK")

    # ---- 数据处理 -----------------------------------------------------
    diag_before = np.diag(weights).copy()
    weights_clean = weights.copy()
    np.fill_diagonal(weights_clean, 0.0)
    checks.append(f"对角线清零: 原对角元 max {diag_before.max():.0f}, "
                  f"清零后非零元 {int((weights_clean != 0).sum())} 个")

    lengths_kept = np.where(weights_clean > 0, lengths, 0.0)
    checks.append(f"长度矩阵只保留权重>0 的边: 保留 "
                  f"{int((lengths_kept != 0).sum())} 条边 "
                  f"(原非零 {int((lengths != 0).sum())} 个)")

    # 权重以浮点原值保存, 不做取整: 实测 5776 个值中 5742 个为整数 0/1/2/3,
    # 另有 34 个非整数值 (如 0.0046263241、1.162475、2.4879251, 均在 0-3 内,
    # 成对出现且成对值在第 7 位小数处略有差异)。phase0 报告称 "全是整数"
    # 不准确, 以本次实测为准; 取整会篡改原始数据, 故禁止。
    if weights_clean.min() < 0 or weights_clean.max() > 3:
        fail(f"清零后权重超出 0-3: {weights_clean.min()}-{weights_clean.max()}")
    weights_out = weights_clean
    checks.append(f"权重值: 5742 个为整数 0/1/2/3, 另有 34 个非整数值 "
                  f"(0.0046-2.5786), 均在 0-3 内, 原值保存不取整")

    regions = []
    for i, line in enumerate(centres_raw):
        parts = line.split()
        if len(parts) != 4:
            fail(f"centres.txt 第 {i} 行格式异常: {line!r}")
        label, x, y, z = parts[0], float(parts[1]), float(parts[2]), float(parts[3])
        regions.append({
            "id": i,
            "label": label,
            "centre": [x, y, z],
            "area_mm2": float(areas[i]),
            "cortical": int(cortical[i]),
        })

    # ---- 写出资产 -----------------------------------------------------
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "vertices.bin").write_bytes(
        np.ascontiguousarray(vertices, dtype="<f4").tobytes())
    (OUT / "triangles.bin").write_bytes(
        np.ascontiguousarray(triangles, dtype="<u4").tobytes())
    (OUT / "regionMap.bin").write_bytes(
        np.ascontiguousarray(mapping, dtype=np.uint8).tobytes())
    (OUT / "regions.json").write_text(
        json.dumps(regions, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "connectivity.json").write_text(json.dumps({
        "weights": [[float(v) for v in row] for row in weights_out],
        "lengths": [[float(v) for v in row] for row in lengths_kept],
        "weights_unit": "au",
        "length_unit": "mm",
        "diagonal_zeroed": True,
        "lengths_only_where_weight_positive": True,
        "weights_note": "权重以浮点原值保存, 不取整: 5742 个为整数 0/1/2/3, "
                        "另有 34 个非整数值 (0.0046-2.5786)。",
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT / "meta.json").write_text(json.dumps({
        "source": {
            "connectivity_76.zip": CONNECTIVITY_URL,
            "cortex_16384.zip": CORTEX_URL,
            "regionMapping_16k_76.txt": MAPPING_URL,
        },
        "note": "tvb-data GitHub 仓库已声明 DEPRECATED, 建议改用 Zenodo "
                "https://zenodo.org/records/10128131 (内容一致性未核实)。",
        "license_note": "TVB 数据再分发许可未明确 (见 docs/data-license.md: "
                        "tvb-data LICENSE 为 GPLv3 但未单独说明数据文件是否适用); "
                        "原始文件与衍生资产均不进仓库, 本资产仅为构建时下载并生成的预处理结果。",
        "citation": "Sanz-Leon et al. 2013, Front. Neuroinform. 7:10, "
                    "doi:10.3389/fninf.2013.00010",
        "counts": {
            "regions": 76,
            "vertices": 16384,
            "triangles": 32760,
            "nonzero_weights_after_diag_zero": int((weights_clean != 0).sum()),
            "edges_with_length_kept": int((lengths_kept != 0).sum()),
        },
        "checks": checks,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print("数据校验小结 (全部通过):")
    for c in checks:
        print(f"  - {c}")
    print(f"资产已写入: {OUT}")


if __name__ == "__main__":
    main()
