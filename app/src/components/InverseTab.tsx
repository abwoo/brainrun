import Dropdown from './ui/Dropdown';
/**
 * PR-12 源定位 tab（B3）。
 *
 * Props 约定（设计稿 §1.3，壳 EegAnalysisLab.tsx 传什么就接什么）：
 * `{ recording, fixture }`（fixture 指球形 lead-field，供逆解用）。
 *
 * 两种模式：
 * - 盲测演示（Ground Truth vs Estimated）：真源由下方控件给定，只用来
 *   合成正向 EEG 与事后算误差；`dipoleFit` / `mneInverse` 收到的只有
 *   数据 + lead-field，函数签名里没有真值参数（测试卡住这一点）。
 *   报告定位误差（mm）与分布范围（MNE spread，mm）。
 * - 对当前记录：取记录中全通道 RMS 最大的采样点为实测向量，做偶极子
 *   拟合 + MNE 逆解；没有真值，只报告估计位置、残差 RMS 与分布范围，
 *   不编造误差。
 *
 * 方法与默认值（与 sourceLocalization.ts 一致）：
 * - 偶极子拟合：64 点源网格逐个最小二乘，取残差 RMS 最小者；
 * - MNE：s = Lᵀ(LLᵀ + λ²σ²I)⁻¹V，R = I（无深度加权），C = σ²I，
 *   λ² 默认 1/9（MNE 默认 SNR = 3），σ 默认 1.0 µV。
 * 诚实说明：无深度加权的 MNE 在这张 64 点粗网格上是差的峰值定位器
 * （深部/切向源峰值误差 32–64 mm 无噪声、~100 mm 有噪声），只有
 * 表浅径向源能准确定位；偶极子拟合在单偶极子模型正确时无噪声精确
 * 恢复。详见 docs/pr6-topo-inverse.md。
 */
import { useMemo, useState } from 'react';
import type { EegRecording } from '../lib/eegData';
import {
  buildLeadField,
  dipoleFit,
  mneInverse,
  blindTest,
  MNE_LAMBDA2_DEFAULT,
  MNE_NOISE_RMS_UV_DEFAULT,
} from '../lib/sourceLocalization';
import type { MontageKey, SphereFixture } from '../lib/sphereForward';
import type { Vec3Mm } from '../lib/volumeConduction';

export interface InverseTabProps {
  recording: EegRecording | null;
  fixture: SphereFixture | null;
}

function fmtVec(v: Vec3Mm): string {
  return `[${v.map((x) => x.toFixed(1)).join(', ')}]`;
}

export default function InverseTab({ recording, fixture }: InverseTabProps) {
  const [truePos, setTruePos] = useState<Vec3Mm>([16, 16, 16]);
  const [trueAxis, setTrueAxis] = useState<'X' | 'Y' | 'Z'>('Y');
  const [trueMoment, setTrueMoment] = useState(10);
  const [montage, setMontage] = useState<MontageKey>('10-20');
  const [noiseRmsUv, setNoiseRmsUv] = useState(0);
  const [lambda2, setLambda2] = useState(MNE_LAMBDA2_DEFAULT);
  const [mneNoiseRmsUv, setMneNoiseRmsUv] = useState(MNE_NOISE_RMS_UV_DEFAULT);

  const trueMomentVec: Vec3Mm = useMemo(
    () => (trueAxis === 'X' ? [trueMoment, 0, 0] : trueAxis === 'Y' ? [0, trueMoment, 0] : [0, 0, trueMoment]),
    [trueAxis, trueMoment],
  );

  const blind = useMemo(() => {
    if (!fixture) return null;
    try {
      return blindTest(fixture, montage, truePos, trueMomentVec, {
        noiseRmsUv,
        seed: 7,
        lambda2,
        mneNoiseRmsUv,
      });
    } catch {
      return null;
    }
  }, [fixture, montage, truePos, trueMomentVec, noiseRmsUv, lambda2, mneNoiseRmsUv]);

  // 对当前记录：全通道 RMS 最大的采样点。
  const onRecording = useMemo(() => {
    if (!recording || !fixture || recording.channels.length < 3) return null;
    try {
      const nT = recording.timesMs.length;
      let bestJ = 0;
      let bestRms = -1;
      for (let j = 0; j < nT; j++) {
        let ss = 0;
        for (let c = 0; c < recording.channels.length; c++) ss += recording.dataUv[c][j] ** 2;
        const rms = Math.sqrt(ss / recording.channels.length);
        if (rms > bestRms) {
          bestRms = rms;
          bestJ = j;
        }
      }
      const dataUv = recording.channels.map((_, c) => recording.dataUv[c][bestJ]);
      const lf = buildLeadField(fixture, recording.montage, recording.reference);
      const fit = dipoleFit(lf, dataUv);
      const inv = mneInverse(lf, dataUv, { lambda2, noiseRmsUv: mneNoiseRmsUv });
      return {
        atTimeMs: recording.timesMs[bestJ],
        rmsUv: bestRms,
        fit,
        inv,
        nCh: recording.channels.length,
      };
    } catch {
      return null;
    }
  }, [recording, fixture, lambda2, mneNoiseRmsUv]);

  return (
    <div>
      <h3>源定位——偶极子拟合 + MNE 逆解</h3>
      <p className="panel-text">
        正向模型：MNE 四层球形头 lead-field（64 点源网格，轴 −48–48 mm）。
        逆解只读 lead-field + 电位数据，真值标签绝不进逆解函数；真值只在盲测演示里用来合成数据与事后算误差。
      </p>
      {!fixture && <p className="panel-text" role="alert">球形 lead-field 未传入（fixture 为空），逆解不可用。</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="conn-title">盲测演示（Ground Truth vs Estimated）</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label>
              真源 X：
              <input type="number" value={truePos[0]} min={-48} max={48} step={16} onChange={(e) => setTruePos([+e.target.value, truePos[1], truePos[2]])} style={{ width: 64 }} />
            </label>
            <label>
              真源 Y：
              <input type="number" value={truePos[1]} min={-48} max={48} step={16} onChange={(e) => setTruePos([truePos[0], +e.target.value, truePos[2]])} style={{ width: 64 }} />
            </label>
            <label>
              真源 Z：
              <input type="number" value={truePos[2]} min={-48} max={48} step={16} onChange={(e) => setTruePos([truePos[0], truePos[1], +e.target.value])} style={{ width: 64 }} />
            </label>
            <label>
              真源矩方向：
              <Dropdown value={trueAxis} onChange={(e) => setTrueAxis(e.target.value as 'X' | 'Y' | 'Z')}>
                <option value="X">X</option>
                <option value="Y">Y</option>
                <option value="Z">Z</option>
              </Dropdown>
            </label>
            <label>
              真源矩（nA·m）：
              <input type="range" min={-30} max={30} step={0.5} value={trueMoment} onChange={(e) => setTrueMoment(+e.target.value)} aria-label="真源矩" />
              {trueMoment}
            </label>
            <label>
              导联：
              <Dropdown value={montage} onChange={(e) => setMontage(e.target.value as MontageKey)}>
                <option value="10-20">10-20（19 导）</option>
                <option value="10-10">10-10（94 导）</option>
                <option value="10-05">10-05（343 导）</option>
              </Dropdown>
            </label>
            <label>
              附加噪声 RMS（µV）：
              <input type="range" min={0} max={2} step={0.1} value={noiseRmsUv} onChange={(e) => setNoiseRmsUv(+e.target.value)} aria-label="附加噪声" />
              {noiseRmsUv.toFixed(1)}
            </label>
            <label>
              λ²：
              {/* PR8-LAYOUT L-02：框内只显示 3 位小数（0.111），与下方对照表
                  “MNE（λ² = 0.111）”口径一致；状态里仍存完整浮点数，不改计算。 */}
              <input type="number" value={lambda2.toFixed(3)} min={0.001} max={1} step={0.01} onChange={(e) => setLambda2(+e.target.value)} style={{ width: 72 }} />
            </label>
            <label>
              MNE 噪声 σ（µV）：
              <input type="number" value={mneNoiseRmsUv} min={0.1} max={10} step={0.1} onChange={(e) => setMneNoiseRmsUv(+e.target.value)} style={{ width: 64 }} />
            </label>
          </div>
          {blind ? (
            <table style={{ borderCollapse: 'collapse', marginTop: 8, width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #335', padding: 4 }}>方法</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #335', padding: 4 }}>估计位置（mm）</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #335', padding: 4 }}>定位误差</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #335', padding: 4 }}>其他</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: 4 }}>真源</td>
                  <td style={{ padding: 4 }}>{fmtVec(truePos)}</td>
                  <td style={{ padding: 4 }}>—</td>
                  <td style={{ padding: 4 }}>矩 {fmtVec(trueMomentVec)} nA·m</td>
                </tr>
                <tr>
                  <td style={{ padding: 4 }}>偶极子拟合</td>
                  <td style={{ padding: 4 }}>{fmtVec(blind.dipole.estimatedPositionMm)}</td>
                  <td style={{ padding: 4 }}><b>{blind.dipole.localizationErrorMm.toFixed(1)} mm</b></td>
                  <td style={{ padding: 4 }}>残差 RMS {blind.dipole.residualRmsUv.toFixed(3)} µV；矩 {fmtVec(blind.dipole.estimatedMomentNAm)} nA·m</td>
                </tr>
                <tr>
                  <td style={{ padding: 4 }}>MNE（λ² = {lambda2.toFixed(3)}）</td>
                  <td style={{ padding: 4 }}>{fmtVec(blind.mne.estimatedPositionMm)}</td>
                  <td style={{ padding: 4 }}><b>{blind.mne.localizationErrorMm.toFixed(1)} mm</b></td>
                  <td style={{ padding: 4 }}>峰值 {blind.mne.peakValue.toFixed(2)} nA·m（正则化压缩过，不是真值幅度）；分布范围 {blind.mne.spreadMm.toFixed(1)} mm</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="panel-text">盲测算不出来（fixture 未加载或真源越界：位置须在 ±48 mm 内）。</p>
          )}
          <p className="panel-text">
            读法：偶极子拟合无噪声、源在网格点上时误差 0.0 mm；MNE 无深度加权，深部/切向源峰值误差 32–64 mm 乃至更大，
            只有表浅径向源能准确定位——这是最小范数估计的深度偏置，不是正向模型的错。噪声 0.5 µV 时偶极子拟合误差 32–55 mm（19 导），
            残差 RMS ≈ 噪声水平。
          </p>
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="conn-title">对当前记录（无真值，不编造误差）</div>
          {!recording && <p className="panel-text">还没有 EEG 记录。请先在 EEG tab 里运行实验。</p>}
          {recording && !onRecording && <p className="panel-text">该记录的逆解算不出来（fixture 未加载或导联与 fixture 不符）。</p>}
          {recording && onRecording && (
            <>
              <p className="panel-text">
                取全通道 RMS 最大的采样点（{onRecording.atTimeMs.toFixed(0)} ms，RMS {onRecording.rmsUv.toFixed(2)} µV，
                {onRecording.nCh} 导，导联 {recording.montage}）为实测向量。
              </p>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: 4 }}>偶极子拟合估计位置</td>
                    <td style={{ padding: 4 }}>{fmtVec(onRecording.fit.estimatedPositionMm)} mm</td>
                  </tr>
                  <tr>
                    <td style={{ padding: 4 }}>偶极子拟合估计矩</td>
                    <td style={{ padding: 4 }}>{fmtVec(onRecording.fit.estimatedMomentNAm)} nA·m</td>
                  </tr>
                  <tr>
                    <td style={{ padding: 4 }}>偶极子拟合残差 RMS</td>
                    <td style={{ padding: 4 }}>{onRecording.fit.residualRmsUv.toFixed(3)} µV（残差远大于噪声水平时，单偶极子模型不够用）</td>
                  </tr>
                  <tr>
                    <td style={{ padding: 4 }}>MNE 峰值位置</td>
                    <td style={{ padding: 4 }}>{fmtVec(onRecording.inv.estimatedPositionMm)} mm</td>
                  </tr>
                  <tr>
                    <td style={{ padding: 4 }}>MNE 峰值 / 分布范围</td>
                    <td style={{ padding: 4 }}>{onRecording.inv.peakValue.toFixed(2)} nA·m / {onRecording.inv.spreadMm.toFixed(1)} mm</td>
                  </tr>
                </tbody>
              </table>
              <p className="panel-text">
                注意：此处没有真值，无法报告定位误差；两种方法位置不一致时，优先信残差小的那个，
                并看 MNE 的分布范围——分布越散，峰值位置越不可信。
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
