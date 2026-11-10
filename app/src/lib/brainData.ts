/**
 * 脑数据加载与查询（Phase 1）。
 *
 * 数据来源：TVB 示例数据，经 scripts/prepare-brain-data/prepare.py 预处理，
 * 生成的轻量资产位于 public/brain-assets/。顶点坐标为 TVB 原始值（mm 量级），
 * 本模块不做任何逐顶点修改；只在渲染层做整体居中（见 BrainScene）。
 * 引用：Sanz-Leon et al. 2013, Front. Neuroinform. 7:10.
 */

export interface Region {
  id: number;
  label: string;
  centre: [number, number, number];
  area_mm2: number;
  cortical: number;
}

export interface Connectivity {
  /** 76x76，权重单位 au；对角线已清零。 */
  weights: number[][];
  /** 76x76，长度单位 mm；只保留权重 > 0 的边，其余为 0。 */
  lengths: number[][];
}

export interface BrainData {
  /** Float32Array，16384 x 3，xyz（mm，TVB 原始坐标）。 */
  vertices: Float32Array;
  /** Uint32Array，32760 x 3，顶点索引 0-based。 */
  triangles: Uint32Array;
  /** Uint8Array，16384，每顶点脑区 id（0-75）。 */
  regionMap: Uint8Array;
  regions: Region[];
  connectivity: Connectivity;
}

export interface TopConnection {
  target: Region;
  weight: number;
  lengthMm: number;
}

async function fetchBin(path: string): Promise<ArrayBuffer> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`加载失败 ${path}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

export async function loadBrainData(
  base = `${import.meta.env.BASE_URL}brain-assets`,
): Promise<BrainData> {
  const [verticesBuf, trianglesBuf, regionMapBuf, regions, connectivity] =
    await Promise.all([
      fetchBin(`${base}/vertices.bin`),
      fetchBin(`${base}/triangles.bin`),
      fetchBin(`${base}/regionMap.bin`),
      fetch(`${base}/regions.json`).then((r) => {
        if (!r.ok) throw new Error(`加载失败 regions.json: HTTP ${r.status}`);
        return r.json() as Promise<Region[]>;
      }),
      fetch(`${base}/connectivity.json`).then((r) => {
        if (!r.ok) throw new Error(`加载失败 connectivity.json: HTTP ${r.status}`);
        return r.json() as Promise<Connectivity>;
      }),
    ]);

  const vertices = new Float32Array(verticesBuf);
  const triangles = new Uint32Array(trianglesBuf);
  const regionMap = new Uint8Array(regionMapBuf);

  if (vertices.length !== 16384 * 3) {
    throw new Error(`vertices.bin 长度异常: ${vertices.length}，期望 ${16384 * 3}`);
  }
  if (triangles.length !== 32760 * 3) {
    throw new Error(`triangles.bin 长度异常: ${triangles.length}，期望 ${32760 * 3}`);
  }
  if (regionMap.length !== 16384) {
    throw new Error(`regionMap.bin 长度异常: ${regionMap.length}，期望 16384`);
  }
  if (regions.length !== 76) {
    throw new Error(`regions.json 脑区数异常: ${regions.length}，期望 76`);
  }
  return { vertices, triangles, regionMap, regions, connectivity };
}

/** 取某脑区按权重排序的前 N 条主要连接（不含自连接，权重已清零）。 */
export function topConnections(
  data: BrainData,
  regionId: number,
  n = 5,
): TopConnection[] {
  const row = data.connectivity.weights[regionId];
  return row
    .map((weight, j) => ({ target: data.regions[j], weight, lengthMm: data.connectivity.lengths[regionId][j] }))
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n);
}
