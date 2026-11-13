"""Focused invariants and independent checks; no human/physiological validation."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location("spherical_fem",Path(__file__).resolve().parents[2]/"scientific/forward/spherical_fem.py")
fem=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fem)

class SphericalFemTest(unittest.TestCase):
    def test_conforming_mesh_and_independent_scikit_fem_assembly(self):
        from skfem import MeshTet, Basis, ElementTetP1, asm
        from skfem.models.poisson import laplace
        points,tets,regions,unit,faces=fem.mesh(1)
        geom=fem.geometry(points,tets)
        facets=np.concatenate([tets[:,i] for i in ([0,1,2],[0,1,3],[0,2,3],[1,2,3])])
        unique,counts=np.unique(np.sort(facets,axis=1),axis=0,return_counts=True)
        self.assertTrue(np.isin(counts,[1,2]).all())
        expected=np.sort(faces+len(points)-len(unit),axis=1)
        self.assertEqual(set(map(tuple,unique[counts==1])),set(map(tuple,expected)))
        surface=points[-len(unit):][faces]
        outer_volume=abs(np.einsum("ij,ij->i",surface[:,0],np.cross(surface[:,1],surface[:,2])).sum())/6
        self.assertAlmostEqual(float(geom[3].sum()/outer_volume),1.,places=12)
        K=fem.stiffness(points,tets,regions,[.33]*4,geom)
        independent=asm(laplace,Basis(MeshTet(points.T,tets.T),ElementTetP1()))*.33
        error=np.linalg.norm((K-independent).toarray())/np.linalg.norm(independent.toarray())
        self.assertLess(error,1e-12)
        print(f"Independent scikit-fem stiffness relative error: {error:.3e}")

    def test_homogeneous_sphere_central_source_and_superposition(self):
        points,tets,regions,unit,faces=fem.mesh(3)
        geom=fem.geometry(points,tets)
        rhs=fem.rhs_for_sources(points,tets,geom,np.zeros((1,3)))
        values,_=fem.solve(points,tets,regions,geom,[.33]*4,rhs,faces)
        field=values[-len(unit):]*1e6
        analytic=3e-3*unit/(4*np.pi*.33*95**2*1e-6)
        field-=field.mean(axis=0)
        analytic-=analytic.mean(axis=0)
        error=np.linalg.norm(field-analytic)/np.linalg.norm(analytic)
        self.assertLess(error,.05)
        # Reuse an independent combined RHS solve, rather than asserting a JS sum equals itself.
        joint,_=fem.solve(points,tets,regions,geom,[.33]*4,
                          np.column_stack([rhs[:,0]+2*rhs[:,2],-rhs[:,0]]),faces)
        np.testing.assert_allclose(joint[:,0],values[:,0]+2*values[:,2],rtol=1e-8,atol=1e-13)
        np.testing.assert_allclose(joint[:,1],-values[:,0],rtol=1e-8,atol=1e-13)
        print(f"Homogeneous central finite-pair vs ideal-dipole analytic relative error: {error:.5f}")

if __name__=="__main__":
    unittest.main(verbosity=2)
