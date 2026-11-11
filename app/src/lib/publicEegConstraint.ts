/**
 * PR5: public EEG constraint reference values for frontend display.
 *
 * Measured from OpenNeuro ds003061 (CC0), sub-001 run-1, auditory oddball,
 * eyes closed, with MNE 1.11.0 (0.5-40 Hz, average reference). Model
 * predictions push the WC / JR q(t) fixtures through the four-layer
 * spherical-head lead field at Pz (central gain 0.160 uV/(nA.m)).
 *
 * These numbers are a falsification check on order of magnitude and shape,
 * NOT a calibration. The amplitude rescale factors below rescale the
 * product N x coherence x per-neuron current x source-sink length only;
 * that product is structurally non-identifiable from EEG amplitude, so no
 * rescale factor here certifies a cell count or a synchrony fraction.
 * Full method, tolerances and verdicts:
 * docs/pr5-public-eeg-constraint.md and
 * scientific/forward/public_eeg_reference_values.json.
 */

export interface PublicEegConstraint {
  /** OpenNeuro dataset id. */
  datasetId: string;
  /** Dataset DOI. */
  doi: string;
  /** Dataset licence, verified from dataset_description.json. */
  license: string;
  /** Measured P300-window peak at Pz, oddball ERP, uV. */
  p300PeakUvAtPz: number;
  /** Latency of that peak, ms after stimulus. */
  p300PeakLatencyMs: number;
  /** Measured oddball-minus-standard difference-wave peak at Pz, uV. */
  differencePeakUvAtPz: number;
  /** Measured pre-stimulus baseline RMS at Pz, uV. */
  baselineRmsUvAtPz: number;
  /** Measured alpha-band (4-13 Hz) PSD peak at Pz, Hz. */
  alphaPeakHzAtPz: number;
  /** Measured alpha-band PSD peak at Oz, Hz. */
  alphaPeakHzAtOz: number;
  /** Wilson-Cowan route: model peak pushed to Pz, uV. */
  wilsonCowanPeakUvAtPz: number;
  /** Wilson-Cowan route: product rescale needed to match the P300 peak. */
  wilsonCowanRescaleNeeded: number;
  /** Jansen-Rit route: model peak pushed to Pz, uV. */
  jansenRitPeakUvAtPz: number;
  /** Jansen-Rit route: product rescale needed to match the P300 peak. */
  jansenRitRescaleNeeded: number;
  /** Both routes fail amplitude, morphology, baseline and frequency. */
  verdict: 'FAIL';
}

export const PUBLIC_EEG_CONSTRAINT: Readonly<PublicEegConstraint> = Object.freeze({
  datasetId: 'ds003061',
  doi: '10.18112/openneuro.ds003061.v1.1.2',
  license: 'CC0',
  p300PeakUvAtPz: 8.89,
  p300PeakLatencyMs: 410,
  differencePeakUvAtPz: 9.14,
  baselineRmsUvAtPz: 6.07,
  alphaPeakHzAtPz: 10.0,
  alphaPeakHzAtOz: 9.25,
  wilsonCowanPeakUvAtPz: 0.71,
  wilsonCowanRescaleNeeded: 12.6,
  jansenRitPeakUvAtPz: 0.17,
  jansenRitRescaleNeeded: 53.8,
  verdict: 'FAIL',
});

export const PUBLIC_EEG_CONSTRAINT_LIMITATION =
  '公开 EEG 约束是数量级与形态的证伪检验，不是校准：幅度差距只说明 ' +
  'N×coherence×pA×mm 乘积需放大 12.6 倍（WC）/ 53.8 倍（JR）才能对上 ' +
  'P300 峰值，该乘积不可辨识，放大不等于证实了细胞数或同步性；两条路线 ' +
  '在 300–500 ms 窗口内基本无响应、且无持续静息节律。';
