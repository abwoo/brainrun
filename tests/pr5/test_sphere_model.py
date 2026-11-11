"""Independent scientific checks of MNE-generated PR5 spherical head lead field."""
import importlib.util
import json
from pathlib import Path
import unittest
import warnings

import mne
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
FILE=ROOT/'app/public/forward-assets/sphere-model.json'
SCRIPT=ROOT/'scientific/forward/generate_sphere_model.py'
spec=importlib.util.spec_from_file_location('pr5_sphere_generator',SCRIPT)
generator=importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)

class SpherePhysicsReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=json.loads(FILE.read_text())
        cls.names=[s['label'] for s in cls.data['sensors']]
        cls.info=mne.create_info(cls.names,250,'eeg')
        for ch,s in zip(cls.info['chs'],cls.data['sensors']):
            ch['loc'][:3]=(np.asarray(s['position_mm']) +
                np.asarray(cls.data['origin_in_head_mm']))*.001
            ch['coord_frame']=mne.io.constants.FIFF.FIFFV_COORD_HEAD
        cls.sphere=mne.make_sphere_model(
            r0=[0,0,.04],head_radius=.095,
            relative_radii=(.90,.92,.97,1.0),
            sigmas=(.33,1.,.004,.33),verbose=False)
        cls.gain=np.array(cls.data['gain_uv_per_nAm'])

    def direct_gain(self,p_mm):
        p=np.asarray(p_mm)*.001+np.array([0,0,.04])
        dip=mne.Dipole(np.array([0,.001,.002]),np.tile(p,(3,1)),
            np.ones(3)*1e-9,np.eye(3),np.ones(3))
        with warnings.catch_warnings():
            warnings.simplefilter('error',RuntimeWarning)
            fwd,_=mne.make_forward_dipole(
                dip,self.sphere,self.info,verbose=False)
        return np.asarray(fwd['sol']['data'])*.001

    def interpolate(self,p):
        axes=np.asarray(self.data['source_grid_axis_mm'])
        ij=[]
        for x in p:
            k=int(np.searchsorted(axes,x,side='left')-1)
            k=max(0,min(len(axes)-2,k))
            ij.append((k,(x-axes[k])/(axes[k+1]-axes[k])))
        out=np.zeros((len(self.names),3))
        for a in (0,1):
            for b in (0,1):
                for c in (0,1):
                    (i,wi),(j,wj),(k,wk)=ij
                    w=(wi if a else 1-wi)*(wj if b else 1-wj)*(wk if c else 1-wk)
                    idx=((i+a)*4+j+b)*4+k+c
                    out+=w*self.gain[:,3*idx:3*idx+3]
        return out

    def test_grid_output_matches_fresh_reference_mne_call(self):
        for position,index in [([-16,16,-16],(1*4+2)*4+1),
                               ([16,-16,16],(2*4+1)*4+2)]:
            actual=self.direct_gain(position)
            stored=self.gain[:,index*3:index*3+3]
            np.testing.assert_allclose(actual,stored,atol=1e-7,rtol=2e-5)

    def test_off_grid_interpolation_has_quantified_error_bound(self):
        # Regular grid is deliberately limited to [-48,48]^3 mm.
        # Error budget is ~3% L2 over the head-sensor lead field at
        # representative interior locations; should fail on regressions.
        for position in [[0,0,10],[10,10,10],[25,4,-20],
                         [33,33,33],[42,0,-42],[-40,23,17]]:
            exact=self.direct_gain(position)
            approx=self.interpolate(position)
            relative=np.linalg.norm(exact-approx)/np.linalg.norm(exact)
            self.assertLess(relative,.03,(position,relative))

    def test_sphere_conductivity_and_electrode_geometry_are_consistent(self):
        self.assertEqual(self.data['mne_version'],'1.11.0')
        self.assertEqual(len(self.names),345)
        self.assertEqual(self.gain.shape,(345,192))
        self.assertTrue(np.isfinite(self.gain).all())
        self.assertTrue(np.allclose(
            [np.linalg.norm(x['position_mm']) for x in self.data['sensors']],
            95,atol=1e-3))
        self.assertEqual(self.data['conductivities_S_m'],[.33,1.,.004,.33])
        self.assertEqual(self.data['montages']['10-20'][9],'Cz')

    def test_reference_and_linearity(self):
        target=np.array([10.,0.,0.])
        volt=self.interpolate([10,10,10])@target
        channels=[self.names.index(x) for x in self.data['montages']['10-20']]
        v=volt[channels]
        ref=v-v.mean()
        self.assertLess(abs(ref.sum()),1e-12)
        np.testing.assert_allclose(
            (self.interpolate([10,10,10])@(2*target))[channels]-2*v,
            np.zeros_like(v),atol=1e-10)

if __name__=='__main__':
    unittest.main(verbosity=2)
