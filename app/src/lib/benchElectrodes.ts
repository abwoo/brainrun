/**
 * Phase 2 — bench cap-electrode directions for the 3D overlay
 * (design §2, Phase 2 item 1).
 *
 * This module only turns sensor positions into unit directions. It does NOT
 * place electrodes on the TVB network mesh: there is no validated anatomical
 * registration between TVB region coordinates and the MNE head sphere (the
 * audit records this explicitly), so BrainScene draws each direction as a
 * marker on an enclosing shell around the network brain — a direction
 * sketch, never a claim that the electrode sits on that cortical spot.
 * The bench UI labels the overlay exactly that way.
 *
 * - Sphere: directions are the fixture sensors' `position_mm`
 *   (head-RAS, sphere-centred) normalised. The preset's labels come from
 *   `selectBenchCapChannels` (benchCap.ts); this module only maps labels
 *   to directions.
 * - Template BEM: directions are the registered model's electrodes'
 *   `head_mm` normalised about the HEAD-frame origin (the fiducial-defined
 *   head centre). The BEM brings its own electrodes and ignores the cap
 *   preset — same rule as the acquisition path (physicalProjection.ts).
 * - A missing source returns null instead of stale markers: sphere without
 *   a loaded fixture / cap selection, or BEM without a registered template
 *   model. In this tree the template asset
 *   `app/public/forward-assets/fsaverage-bem.json` is a gitignored local
 *   generation product and is absent, so `getTemplateModel()` is null until
 *   a model is loaded in LocalBEMLab (fetch of the same file, or upload);
 *   the bench then shows no BEM markers and says so.
 */
import type { LocalFsaverageBEM } from './fsaverageBEM.ts';
import type { SphereFixture } from './sphereForward.ts';
import type { BenchCapSelection } from './benchCap.ts';

export interface BenchElectrodeDirection {
  label: string;
  /** Unit vector of the sensor position, in the sensor frame's own coordinates. */
  direction: [number, number, number];
}

function unit(v: readonly number[]): [number, number, number] {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(n) || n === 0) {
    throw new RangeError('benchElectrodes: zero or non-finite sensor position');
  }
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Sphere: normalise the fixture sensor positions for the given labels. */
export function sphereElectrodeDirections(
  fixture: SphereFixture,
  labels: readonly string[],
): BenchElectrodeDirection[] {
  const byLabel = new Map(fixture.sensors.map((s) => [s.label, s]));
  return labels.map((label) => {
    const sensor = byLabel.get(label);
    if (!sensor) {
      throw new RangeError(`benchElectrodes: label ${label} has no sensor in the fixture`);
    }
    return { label, direction: unit(sensor.position_mm) };
  });
}

/** Template BEM: normalise the model's own electrodes' head_mm. */
export function bemElectrodeDirections(model: LocalFsaverageBEM): BenchElectrodeDirection[] {
  return model.electrodes.map((e) => ({ label: e.label, direction: unit(e.head_mm) }));
}

export type BenchElectrodeSource = 'sphere' | 'bem';

export interface BenchElectrodeSet {
  source: BenchElectrodeSource;
  electrodes: BenchElectrodeDirection[];
}

/**
 * Pick the electrode source for the bench overlay. Sphere uses the cap
 * preset's labels; BEM uses the template model's own electrodes. Returns
 * null when the source data is not loaded yet — the caller shows no markers
 * and says so, instead of showing stale or wrong electrodes.
 */
export function selectBenchElectrodes(args: {
  headModel: 'sphere' | 'bem';
  fixture: SphereFixture | null;
  capSelection: BenchCapSelection | null;
  bemModel: LocalFsaverageBEM | null;
}): BenchElectrodeSet | null {
  if (args.headModel === 'bem') {
    if (!args.bemModel) return null;
    return { source: 'bem', electrodes: bemElectrodeDirections(args.bemModel) };
  }
  if (!args.fixture || !args.capSelection) return null;
  return { source: 'sphere', electrodes: sphereElectrodeDirections(args.fixture, args.capSelection.labels) };
}
