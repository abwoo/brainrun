"""Direct MNE checks for the displayed scalp mesh."""
import json
from pathlib import Path
import unittest
import mne
import numpy as np

class ScalpForward(unittest.TestCase):
    def test_scalp_vertices_use_the_same_mne_forward_model(self):
        data=json.loads(Path("app/public/forward-assets/sphere-model.json").read_text())
        grid=data["scalp_field_grid"]
        indices=[0,20,200,len(grid["positions_mm"])-1]
        positions=np.asarray(grid["positions_mm"])[indices]
        np.testing.assert_allclose(np.linalg.norm(positions,axis=1),95,atol=1e-9)
        info=mne.create_info([f"P{i}" for i in indices],250,"eeg")
        origin=np.array([0,0,.04])
        for ch,p in zip(info["chs"],positions):
            ch["loc"][:3]=origin+p*.001
            ch["coord_frame"]=mne.io.constants.FIFF.FIFFV_COORD_HEAD
        sphere=mne.make_sphere_model(r0=origin,head_radius=.095,
           relative_radii=(.90,.92,.97,1),sigmas=(.33,1,.004,.33),verbose=False)
        source=np.array([16,16,16])
        dipoles=mne.Dipole(np.arange(3)*.001,np.repeat((origin+source*.001)[None],3,axis=0),
            np.ones(3)*1e-9,np.eye(3),np.ones(3))
        fwd,_=mne.make_forward_dipole(dipoles,sphere,info,verbose=False)
        axis=data["source_grid_axis_mm"]
        index=next(i for i,p in enumerate([(x,y,z) for x in axis for y in axis for z in axis]) if p==tuple(source))
        actual=np.asarray(grid["gain_uv_per_nAm"])[indices,index*3:index*3+3]
        np.testing.assert_allclose(actual,np.asarray(fwd["sol"]["data"])*1e-3,rtol=2e-5,atol=1e-7)
        faces=np.asarray(grid["triangles"]).reshape(-1,3)
        self.assertTrue(np.all(faces>=0) and np.all(faces<len(grid["positions_mm"])))
