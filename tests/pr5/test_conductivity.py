import json
import unittest
from pathlib import Path
import numpy as np
import mne
ROOT=Path(__file__).resolve().parents[2]
class TestConductivity(unittest.TestCase):
    def test_selected_skull_conductivity_is_the_actual_mne_model(self):
        for sigma in (.002,.008):
            f=json.loads((ROOT/f"app/public/forward-assets/sphere-skull-{sigma:.3f}.json").read_text())
            sphere=mne.make_sphere_model(r0=(0.,0.,.04),head_radius=.095,
                relative_radii=(.9,.92,.97,1.),sigmas=(.33,1.,sigma,.33),verbose=False)
            info=mne.create_info(["Cz"],250.,["eeg"])
            sensor=next(s for s in f["sensors"] if s["label"]=="Cz")
            info["chs"][0]["loc"][:3]=np.asarray(sensor["position_mm"])*.001+np.array([0,0,.04])
            info["chs"][0]["coord_frame"]=mne.io.constants.FIFF.FIFFV_COORD_HEAD
            # Source grid layout is x-major, z-minor.
            dip=mne.Dipole(times=np.array([0.]),pos=np.array([[.016,.016,.056]]),
                amplitude=np.array([1e-9]),ori=np.array([[0.,0.,1.]]),gof=np.array([1.]))
            forward,_=mne.make_forward_dipole(dip,sphere,info,verbose=False)
            actual=float(forward["sol"]["data"][0,0])*1e-3
            stored=f["gain_uv_per_nAm"][f["sensors"].index(sensor)][(2*16+2*4+2)*3+2]
            self.assertAlmostEqual(actual,stored,places=8)
            self.assertEqual(f["conductivities_S_m"][2],sigma)
