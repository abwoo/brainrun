"""Opt-in live fsaverage BEM EEG validation; NO web distribution of assets.

Run after:
python scientific/forward/generate_fsaverage_bem.py --download --sources-per-hemisphere 8 --montage 10-20 --output .local-assets/pr5/fsaverage-bem.json
python -m unittest discover -s tests/pr5 -p test_fsaverage_bem_live.py -v

Requires explicitly downloaded, licensed fsaverage inputs and real MNE BEM.
"""
import json
from pathlib import Path
import unittest
import numpy as np
import mne
from scipy.spatial import cKDTree

ROOT=Path(__file__).resolve().parents[2]
FILE=ROOT/".local-assets/pr5/fsaverage-bem.json"
SUBJECTS=Path.home()/"mne_data/MNE-fsaverage-data"

@unittest.skipUnless(FILE.is_file(),"Run the explicit opt-in BEM generator first")
class TestRealFsaverageBEM(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload=json.loads(FILE.read_text())
        cls.subject=SUBJECTS/"fsaverage"

    def test_geometry_has_real_anatomical_surfaces_in_head_frame(self):
        data=self.payload
        self.assertEqual(data["model_id"],"fsaverage-mne-three-layer-bem-v1")
        self.assertEqual(data["frame"],"HEAD_RAS_MM")
        self.assertEqual(data["license_status"],"REVIEW_REQUIRED_FREESURFER_DERIVED_ASSET")
        self.assertEqual(set(data["meshes"]),{"brain","skull","scalp","cortex"})
        for layer in ("brain","skull","scalp"):
            mesh=data["meshes"][layer]
            p=np.asarray(mesh["vertices_head_mm"])
            tri=np.asarray(mesh["triangles"])
            self.assertGreater(len(p),1000)
            self.assertGreater(len(tri),1000)
            self.assertTrue(np.isfinite(p).all())
            self.assertTrue((tri>=0).all() and (tri<len(p)).all())
        # Real head != a perfect spherical surface. Regressions cannot replace
        # the MRI scalp mesh with sphere geometry and still call it BEM.
        p=np.asarray(data["meshes"]["scalp"]["vertices_head_mm"])
        std=np.std(np.linalg.norm(p-p.mean(axis=0),axis=1))
        self.assertGreater(std,5.0)
        hemi=data["meshes"]["cortex"]
        for h in ("lh","rh"):
            self.assertGreater(len(hemi[h]["vertices_head_mm"]),1000)

    def test_electrode_head_coordinates_are_near_template_scalp(self):
        sensors=np.array([s["head_mm"] for s in self.payload["electrodes"]])
        scalp=np.array(self.payload["meshes"]["scalp"]["vertices_head_mm"])
        nearest=cKDTree(scalp).query(sensors)[0]
        # Template montage is approximately coregistered, not exactly "on" scalp.
        self.assertLess(np.median(nearest),15.,
            "Montage exceeds expected template scalp proximity")
        self.assertTrue(np.isfinite(nearest).all())
        self.assertEqual(len(sensors),19)

    def test_source_vertices_have_atlas_labels_and_hemisphere(self):
        pts=self.payload["source_positions"]
        self.assertEqual(len(pts),16)
        self.assertEqual({p["hemisphere"] for p in pts},{"lh","rh"})
        self.assertTrue(any(p["region"]!="unknown" for p in pts))
        for p in pts:
            self.assertEqual(p["atlas"],"aparc")
            self.assertEqual(len(p["head_mm"]),3)
            self.assertTrue(np.isfinite(p["head_mm"]).all())
            self.assertIsInstance(p["vertex"],int)

    def test_precomputed_bem_gain_matches_fresh_mne_solve(self):
        # Independently reconstruct a subset from the actual MNE BEM,
        # compare with serialized µV/(nA.m) forward. No synthetic sphere.
        from importlib.util import spec_from_file_location,module_from_spec
        f=ROOT/"scientific/forward/generate_fsaverage_bem.py"
        spec=spec_from_file_location("pr5_bem",f)
        mod=module_from_spec(spec);spec.loader.exec_module(mod)
        info=mod.registered_montage("10-20")
        pos=np.array([p["head_mm"] for p in self.payload["source_positions"][:2]])*.001
        bem=self.subject/"bem/fsaverage-5120-5120-5120-bem-sol.fif"
        actual=mod.gain_from_bem(bem,info,pos)
        stored=np.array(self.payload["gains_uV_per_nAm"])[:,:6]
        np.testing.assert_allclose(actual,stored,atol=1e-6,rtol=1e-4)

    def test_gain_direction_and_units(self):
        gain=np.asarray(self.payload["gains_uV_per_nAm"])
        self.assertEqual(gain.shape,(19,48))
        self.assertEqual(self.payload["gain_unit"],"uV_per_nA_m")
        self.assertTrue(np.isfinite(gain).all())
        self.assertGreater(np.linalg.norm(gain),0.1)
        self.assertEqual(self.payload["interpolation"].split(";")[0],"none")

if __name__=="__main__":
    unittest.main(verbosity=2)
