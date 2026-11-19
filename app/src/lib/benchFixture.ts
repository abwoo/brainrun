/**
 * Shared sphere-fixture loader for the bench (pictorial bench).
 *
 * Both ClosedLoopBench (acquisition) and PictorialHead (cap electrodes)
 * need the sphere head-model fixture; the fetch is cached module-level
 * so the JSON is fetched once no matter how many callers mount.
 * Returns null until loaded — callers show "not loaded yet" instead of
 * stale markers.
 */
import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import {
  validateSphereFixture, type SphereFixture,
} from './sphereForward';

let cachedFixture: Promise<SphereFixture> | null = null;

function loadFixture(): Promise<SphereFixture> {
  if (!cachedFixture) {
    cachedFixture = fetch(
      import.meta.env.BASE_URL + 'forward-assets/sphere-model.json',
    ).then(async (r) => {
      if (!r.ok) {
        throw new Error('sphere-model.json missing');
      }
      const loaded = (await r.json()) as SphereFixture;
      validateSphereFixture(loaded);
      return loaded;
    });
  }
  return cachedFixture;
}

export function useSphereFixture(): {
  fixture: SphereFixture | null;
  fixtureError: string | null;
} {
  const { locale } = useI18n();
  const [fixture, setFixture] = useState<SphereFixture | null>(null);
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadFixture()
      .then((loaded) => { if (!cancelled) setFixture(loaded); })
      .catch(() => {
        if (!cancelled) {
          setFixtureError(locale === 'zh-CN'
            ? '模型资源缺失：请先运行 scientific/forward/generate_sphere_model.py'
            : 'Model asset missing: run scientific/forward/generate_sphere_model.py first');
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { fixture, fixtureError };
}
