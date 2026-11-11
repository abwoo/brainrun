"""PR5: test registration/source selection and geometry without downloading fsaverage.

These tests NEVER pretend a synthetic mesh is a real BEM. Real BEM end-to-end
tests live in test_fsaverage_bem_live.py and require explicit --download.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest
import numpy as np
import mne
from mne.io.constants import FIFF

SRC=Path(__file__).resolve().parents[2]/"scientific/forward/generate_fsaverage_bem.py"
spec=importlib.util.spec_from_file_location("brainrun_fsaverage_bem",SRC)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class TestMriHeadRegistration(unittest.TestCase):
    def test_builtin_fsaverage_transform_frame_and_roundtrip(self):
        p=Path(mne.__file__).parent/"data/fsaverage/fsaverage-trans.fif"
        tx=mne.read_trans(p)
        mod.validate_mri_head_transform(tx)
        mri_to_head=mod.as_mri_to_head(tx)
        self.assertEqual(mri_to_head["from"],FIFF.FIFFV_COORD_MRI)
        self.assertEqual(mri_to_head["to"],FIFF.FIFFV_COORD_HEAD)
        pts=np.array([[0.02,0.0,0.06],[-.035,.024,-.011],[0,0,0]])
        head=mne.transforms.apply_trans(mri_to_head,pts)
        back=mne.transforms.apply_trans(mne.transforms.invert_transform(mri_to_head),head)
        np.testing.assert_allclose(back,pts,atol=1e-12)

    def test_reject_unproven_coordinate_frames(self):
        identity=np.eye(4)
        t=mne.transforms.Transform("head","mri",identity)
        mod.validate_mri_head_transform(t)
        t["to"]=FIFF.FIFFV_COORD_MNI_TAL if hasattr(
            FIFF,"FIFFV_COORD_MNI_TAL") else 99
        with self.assertRaisesRegex(ValueError,"HEAD"):
            mod.validate_mri_head_transform(t)
        t=mne.transforms.Transform("head","mri",identity)
        t["trans"][0,0]=0
        with self.assertRaisesRegex(ValueError,"Singular"):
            mod.validate_mri_head_transform(t)

    def test_synthetic_cortical_vertices_preserve_laterality_and_units(self):
        tx=mne.transforms.Transform("mri","head",np.eye(4))
        left={"coord_frame":FIFF.FIFFV_COORD_MRI,
              "vertno":np.array([0,2,4,6]),
              "nn":np.tile([0,0,1],(7,1)),
              "rr":np.array([[-.02,0,.02],[0,0,0],[-.03,.01,.02],[0,0,0],
                             [-.03,-.01,.03],[0,0,0],[-.04,.01,.025]])}
        right={"coord_frame":FIFF.FIFFV_COORD_MRI,
              "vertno":np.array([0,2,4,6]),
              "nn":np.tile([0,0,1],(7,1)),
              "rr":np.array([[.02,0,.02],[0,0,0],[.03,.01,.02],[0,0,0],
                            [.03,-.01,.03],[0,0,0],[.04,.01,.025]])}
        points,pos=mod.sources_from_src([left,right],tx,per_hemisphere=2)
        self.assertEqual(len(points),4)
        self.assertEqual(pos.shape,(4,3))
        for point in points:
            self.assertEqual(len(point['normal_head_unit']),3)
            self.assertAlmostEqual(np.linalg.norm(point['normal_head_unit']),1.,places=6)
        self.assertTrue(all(p["head_mm"][0]<0 for p in points[:2]))
        self.assertTrue(all(p["head_mm"][0]>0 for p in points[2:]))
        np.testing.assert_allclose(np.asarray(points[0]["head_mm"])/1000,pos[0],atol=1e-8)

    def test_triangles_reject_invalid_and_convert_meters_to_millimetres(self):
        tx=mne.transforms.Transform("mri","head",np.eye(4))
        vertices=np.array([[.01,0,0],[0,.02,0],[0,0,.03]])
        mesh=mod.head_mesh(tx,vertices,[[0,1,2]])
        self.assertEqual(mesh["vertices_head_mm"],[[10.,0.,0.],[0.,20.,0.],[0.,0.,30.]])
        with self.assertRaisesRegex(ValueError,"mesh"):
            mod.head_mesh(tx,vertices,[[0,1,3]])

    def test_1020_labels_come_from_mne_standardized_montage(self):
        info=mod.registered_montage("10-20")
        self.assertEqual(len(info["ch_names"]),19)
        self.assertIn("Cz",info["ch_names"])
        self.assertIn("O1",info["ch_names"])
        self.assertNotIn("Oz",info["ch_names"])
        info1005=mod.registered_montage("10-05")
        self.assertEqual(len(info1005["ch_names"]),343)
        for ch in info1005["chs"]:
            self.assertEqual(ch["coord_frame"],FIFF.FIFFV_COORD_HEAD)

    def test_correct_atlas_label_uses_surface_vertex_index(self):
        class Label:
            def __init__(self,name,hemi,vertices):
                self.name=name;self.hemi=hemi;self.vertices=np.asarray(vertices)
        labels=[Label("lh.precentral","lh",[0,2,4]),
                Label("rh.precentral","rh",[0,2,4])]
        self.assertEqual(mod.label_at_source_vertex(labels,"lh",2),"lh.precentral")
        self.assertEqual(mod.label_at_source_vertex(labels,"rh",4),"rh.precentral")
        self.assertEqual(mod.label_at_source_vertex(labels,"lh",99),"unknown")

if __name__=="__main__":
    unittest.main(verbosity=2)
