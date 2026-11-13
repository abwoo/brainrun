#!/usr/bin/env python3
"""Conforming P1 tetrahedral spherical conductor benchmark, SI internally.

Finite source/sink pair loads are deposited with P1 barycentric weights.
No analytic gain is used to construct the FEM result; MNE is a validation only.
"""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import splu

RADII_MM = np.array([10,20,30,40,50,60,70,80,85.5,87.4,92.15,95.0])
GRID_MM = [-16.0,16.0]
PAIR_M = 0.002
MODEL_ID = "p1-four-layer-spherical-fem-v1"


def icosphere(level):
    t = (1 + np.sqrt(5))/2
    vertices = [(-1,t,0),(1,t,0),(-1,-t,0),(1,-t,0),
                (0,-1,t),(0,1,t),(0,-1,-t),(0,1,-t),
                (t,0,-1),(t,0,1),(-t,0,-1),(-t,0,1)]
    vertices = [np.asarray(v)/np.linalg.norm(v) for v in vertices]
    faces = [(0,11,5),(0,5,1),(0,1,7),(0,7,10),(0,10,11),
             (1,5,9),(5,11,4),(11,10,2),(10,7,6),(7,1,8),
             (3,9,4),(3,4,2),(3,2,6),(3,6,8),(3,8,9),
             (4,9,5),(2,4,11),(6,2,10),(8,6,7),(9,8,1)]
    for _ in range(level):
        cache = {}
        def midpoint(a,b):
            key = tuple(sorted((a,b)))
            if key not in cache:
                p = vertices[a]+vertices[b]
                cache[key] = len(vertices)
                vertices.append(p/np.linalg.norm(p))
            return cache[key]
        refined = []
        for a,b,c in faces:
            ab,bc,ca = midpoint(a,b),midpoint(b,c),midpoint(c,a)
            refined.extend([(a,ab,ca),(b,bc,ab),(c,ca,bc),(ab,bc,ca)])
        faces = refined
    return np.asarray(vertices), np.asarray(faces,dtype=np.int64)


def mesh(level):
    unit,faces = icosphere(level)
    n = len(unit)
    points = np.vstack([np.zeros((1,3)), *[unit*r*1e-3 for r in RADII_MM]])
    tets,regions = [],[]
    for f in faces:
        tets.append([0,*(f+1)])
        regions.append(0)
    for ring in range(len(RADII_MM)-1):
        region = 0 if RADII_MM[ring+1]<=85.5 else 1 if RADII_MM[ring+1]<=87.4 else 2 if RADII_MM[ring+1]<=92.15 else 3
        for face in faces:
            a,b,c = np.sort(face)+1+ring*n
            A,B,C = a+n,b+n,c+n
            tets.extend([[a,b,c,C],[a,b,B,C],[a,A,B,C]])
            regions.extend([region]*3)
    return points,np.asarray(tets),np.asarray(regions),unit,faces


def geometry(points,tets):
    x = points[tets]
    J = np.transpose(x[:,1:]-x[:,:1],(0,2,1))
    det = np.linalg.det(J)
    assert np.min(np.abs(det))>1e-18, "Degenerate tetrahedron"
    inverse = np.linalg.inv(J)
    grad = np.concatenate([-inverse.sum(axis=1,keepdims=True),inverse],axis=1)
    volume = np.abs(det)/6
    return x[:,0],inverse,grad,volume


def stiffness(points,tets,regions,sigmas,geom):
    _,_,grad,volume = geom
    local = np.einsum("eik,ejk,e->eij",grad,grad,volume*np.asarray(sigmas)[regions])
    K = coo_matrix((local.ravel(),(np.repeat(tets,4,axis=1).ravel(),
                                 np.tile(tets,(1,4)).ravel())),
                   shape=(len(points),len(points))).tocsc()
    return K


def point_load(points,tets,geom,p):
    x0,inverse,_,_ = geom
    coordinates = np.einsum("eij,ej->ei",inverse,p-x0)
    weights = np.concatenate([1-coordinates.sum(axis=1,keepdims=True),coordinates],axis=1)
    candidates = np.flatnonzero(np.min(weights,axis=1)>=-1e-10)
    if not len(candidates):
        raise ValueError(f"Source outside mesh: {p}")
    j = candidates[0]
    out = np.zeros(len(points))
    out[tets[j]] = weights[j]
    return out


def rhs_for_sources(points,tets,geom,positions):
    columns = []
    for p in positions:
        for direction in np.eye(3):
            plus,minus = p+PAIR_M/2*direction,p-PAIR_M/2*direction
            assert max(np.linalg.norm(plus),np.linalg.norm(minus))<0.0855-0.001
            b = (point_load(points,tets,geom,plus)-point_load(points,tets,geom,minus))*(1e-9/PAIR_M)
            assert abs(b.sum())<1e-18, "Unbalanced current"
            assert np.linalg.norm(points.T@b-1e-9*direction)<1e-20, "Dipole moment not conserved"
            columns.append(b)
    return np.asarray(columns).T


def scalp_weights(points,faces,offset):
    vertices = points[offset:]
    tri = vertices[faces]
    areas = np.linalg.norm(np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]),axis=1)/2
    weights = np.zeros(len(vertices))
    for j in range(3):
        np.add.at(weights,faces[:,j],areas/3)
    return weights/weights.sum()


def solve(points,tets,regions,geom,sigmas,rhs,faces):
    K = stiffness(points,tets,regions,sigmas,geom)
    assert np.max(np.abs(K@np.ones(len(points))))<1e-12
    assert np.max(np.abs((K-K.T).data),initial=0)<1e-14
    factor = splu(K[1:,1:].tocsc(),permc_spec="MMD_AT_PLUS_A")
    values = np.vstack([np.zeros((1,rhs.shape[1])),factor.solve(rhs[1:])])
    offset = len(points)-(int(faces.max())+1)
    # Surface-area mean fixes only the additive Neumann gauge.
    values -= scalp_weights(points,faces,offset)@values[offset:]
    residual = np.linalg.norm(K@values-rhs)/np.linalg.norm(rhs)
    assert residual<1e-8, f"Linear solve residual {residual}"
    assert np.all(np.sum(rhs*values,axis=0)>0), "Nonpositive energy"
    reciprocal = rhs.T@values
    reciprocity = np.linalg.norm(reciprocal-reciprocal.T)/np.linalg.norm(reciprocal)
    assert reciprocity<1e-9
    return values,{"relative_residual":float(residual),"reciprocity_error":float(reciprocity)}



def project_sensors(unit,faces,directions):
    # Intersect each radial ray with the actual polyhedral FEM boundary.
    inv = np.linalg.inv(np.transpose(unit[faces],(0,2,1)))
    result,weights,indices = [],[],[]
    for direction in directions:
        c = inv@direction
        choices = np.flatnonzero(np.min(c,axis=1)>=-1e-10)
        assert len(choices), "No boundary facet intersection"
        i = choices[0]
        w = c[i]/c[i].sum()
        result.append(w@unit[faces[i]]*0.095)
        weights.append(w)
        indices.append(faces[i])
    return np.asarray(result),np.asarray(weights),np.asarray(indices)


def central_layered_sphere(sensor_positions,sigmas):
    # Exact l=1 interface solution. Normalize radii to avoid an ill-scaled SI matrix.
    radii=[.90,.92,.97]
    A=np.zeros((7,7));b=np.zeros(7)
    def row(layer,r,flux=False):
        v=np.zeros(7)
        if layer==0:
            v[0]=sigmas[0] if flux else r
            known=-2*sigmas[0]/r**3 if flux else 1/r**2
        else:
            j=2*layer-1
            v[j]=sigmas[layer] if flux else r
            v[j+1]=-2*sigmas[layer]/r**3 if flux else 1/r**2
            known=0.
        return v,known
    for i,r in enumerate(radii):
        for flux in [False,True]:
            j=2*i+int(flux)
            left,lc=row(i,r,flux);right,rc=row(i+1,r,flux)
            A[j]=left-right;b[j]=rc-lc
    A[6,5]=1;A[6,6]=-2
    coefficients=np.linalg.solve(A,b)
    amplitude=(coefficients[5]+coefficients[6])*1e-9/(4*np.pi*sigmas[0]*.095**2)*1e6
    directions=sensor_positions/np.linalg.norm(sensor_positions,axis=1,keepdims=True)
    return directions*amplitude


def mne_reference(positions,sensor_positions,sigmas):
    central=np.linalg.norm(positions,axis=1)<1e-14
    if central.any():
        out=np.zeros((len(sensor_positions),len(positions)*3))
        if (~central).any():
            noncentral=mne_reference(positions[~central],sensor_positions,sigmas)
            out.reshape(len(sensor_positions),-1,3)[:,~central,:]=noncentral.reshape(len(sensor_positions),-1,3)
        out.reshape(len(sensor_positions),-1,3)[:,central,:]=central_layered_sphere(sensor_positions,sigmas)[:,None,:]
        return out
    import mne
    assert mne.__version__=="1.11.0"
    origin = np.array([0.,0.,0.04])
    info = mne.create_info([f"S{i}" for i in range(len(sensor_positions))],250,"eeg")
    for ch,p in zip(info["chs"],sensor_positions):
        ch["loc"][:3] = p+origin
        ch["coord_frame"] = mne.io.constants.FIFF.FIFFV_COORD_HEAD
    sphere = mne.make_sphere_model(r0=origin,head_radius=.095,
        relative_radii=(.90,.92,.97,1),sigmas=sigmas,verbose=False)
    dipoles = mne.Dipole(np.arange(len(positions)*3)*.001,
        np.repeat(positions+origin,3,axis=0),np.full(len(positions)*3,1e-9),
        np.tile(np.eye(3),(len(positions),1)),np.ones(len(positions)*3))
    fwd,_ = mne.make_forward_dipole(dipoles,sphere,info,verbose=False)
    result=np.asarray(fwd["sol"]["data"])*1e-3
    assert np.isfinite(result).all(), "Nonfinite independent reference"
    return result


def build(level=3,skull=.004):
    start=time.monotonic()
    points,tets,regions,unit,faces=mesh(level)
    geom=geometry(points,tets)
    positions=np.array([(x,y,z) for x in GRID_MM for y in GRID_MM for z in GRID_MM])*1e-3
    rhs=rhs_for_sources(points,tets,geom,positions)
    sigmas=[.33,1,skull,.33]
    values,metrics=solve(points,tets,regions,geom,sigmas,rhs,faces)
    surface=values[-len(unit):]*1e6
    reference=mne_reference(positions,unit*.095,sigmas)
    field=surface-surface.mean(axis=0)
    reference-=reference.mean(axis=0)
    errors=np.linalg.norm(field-reference,axis=0)/np.linalg.norm(reference,axis=0)
    metrics.update(level=level,nodes=len(points),tetrahedra=len(tets),
        max_mne_relative_l2=float(errors.max()),
        rms_mne_relative_l2=float(np.linalg.norm(field-reference)/np.linalg.norm(reference)),
        seconds=round(time.monotonic()-start,2))
    print(json.dumps(metrics),flush=True)
    return points,tets,regions,unit,faces,positions,values,metrics


def offgrid_errors(surface,unit,sigmas):
    positions=np.array([[0,0,0],[15,-15,15],[-12,4,8],[5,9,-7]],dtype=float)*1e-3
    columns=[]
    for p in positions*1e3:
        weight=(p+16)/32
        result=np.zeros((len(unit),3))
        for x in range(2):
            for y in range(2):
                for z in range(2):
                    w=np.prod([weight[k] if j else 1-weight[k] for k,j in enumerate([x,y,z])])
                    result+=surface[:,3*(x*4+y*2+z):3*(x*4+y*2+z)+3]*w
        columns.append(result)
    actual=np.concatenate(columns,axis=1)
    reference=mne_reference(positions,unit*.095,sigmas)
    actual-=actual.mean(axis=0)
    reference-=reference.mean(axis=0)
    error=np.linalg.norm(actual-reference,axis=0)/np.linalg.norm(reference,axis=0)
    return float(error.max())


def fixture(level=4,skull=.004):
    import mne
    import scipy
    points,tets,regions,unit,faces,positions,values,metrics=build(level,skull)
    assert metrics["max_mne_relative_l2"]<.05, "Solved-node error exceeds declared 5% tolerance"
    surface=values[-len(unit):]*1e6
    sigmas=[.33,1,skull,.33]
    offgrid=offgrid_errors(surface,unit,sigmas)
    assert offgrid<.05, "Off-grid example error exceeds declared 5% tolerance"
    origin=np.array([0.,0.,.04])
    names_by_montage={}
    originals={}
    for key,name in [("10-10","standard_1020"),("10-05","standard_1005")]:
        montage=mne.channels.make_standard_montage(name)
        info=mne.create_info(montage.ch_names,250,"eeg")
        info.set_montage(montage)
        names_by_montage[key]=montage.ch_names
        for ch in info["chs"]:
            originals[ch["ch_name"]]=ch["loc"][:3].copy()
    names_by_montage["10-20"]="Fp1 Fp2 F7 F3 Fz F4 F8 T7 C3 Cz C4 T8 P7 P3 Pz P4 P8 O1 O2".split()
    names=list(dict.fromkeys(names_by_montage["10-05"]+names_by_montage["10-10"]))
    directions=np.array([originals[n]-origin for n in names])
    directions/=np.linalg.norm(directions,axis=1,keepdims=True)
    sensor_positions,weights,indices=project_sensors(unit,faces,directions)
    sensor_gain=np.einsum("ij,ijk->ik",weights,surface[indices])
    digest=hashlib.sha256()
    for data,dtype in [(points,"<f8"),(tets,"<i8"),(regions,"<i8")]:
        digest.update(data.astype(dtype).tobytes())
    numerics={
        "solver":"P1-tetrahedral-conductivity","mesh_sha256":digest.hexdigest(),
        "nodes":len(points),"tetrahedra":len(tets),"surface_vertices":len(unit),
        "pair_separation_mm":PAIR_M*1e3,"source_load":"barycentric-current-balanced-Cartesian-pairs",
        "boundary":"insulating-Neumann","datum":"surface-area-mean-zero",
        "relative_residual":metrics["relative_residual"],
        "reciprocity_error":metrics["reciprocity_error"],
        "max_mne_relative_l2":metrics["max_mne_relative_l2"],
        "offgrid_max_mne_relative_l2":offgrid,
        "validation_scope":"24 solved Cartesian fields and 12 off-grid example fields; average-referenced whole-field L2; not a global spatial or per-electrode error bound",
        "numpy_version":np.__version__,"scipy_version":scipy.__version__,
    }
    result={
        "model_id":MODEL_ID+("" if skull==.004 else f"-skull-{skull:.3f}"),
        "coordinate_frame":"head-RAS-sphere-centered","mne_version":mne.__version__,
        "origin_in_head_mm":[0.,0.,40.],"radius_mm":95.,"brain_inner_radius_mm":85.5,
        "relative_radii":[.9,.92,.97,1.],"conductivities_S_m":sigmas,
        "source_grid_axis_mm":GRID_MM,"source_moment_axes":["x","y","z"],
        "gain_units":"microvolts_per_nanoampere_metre",
        "method":"P1 tetrahedral conductivity-weighted FEM; SciPy sparse LU; no analytic gains used in assembly",
        "limitations":"Concentric faceted spherical geometry, not anatomical MRI/FEM. Source positions limited to a deep +/-16 mm cube. Cartesian 2 mm current-pair basis, not exact point dipoles. Browser uses bounded trilinear source interpolation and boundary P1 sensor interpolation. Unreferenced coefficients use a surface-area-zero-mean computational gauge, not a measured infinity reference. No fitted amplitude scaling or physiological calibration.",
        "fem":numerics,"montages":names_by_montage,
        "sensors":[{"label":n,"position_mm":(p*1e3).tolist(),"original_head_mm":(originals[n]*1e3).tolist()}
                   for n,p in zip(names,sensor_positions)],
        "gain_uv_per_nAm":np.round(sensor_gain,9).tolist(),
        "scalp_field_grid":{"positions_mm":(unit*95).tolist(),"triangles":faces.ravel().tolist(),
            "gain_uv_per_nAm":np.round(surface,9).tolist(),
            "method":"FEM nodal scalp solutions; piecewise-linear boundary field, not smoothing of montage electrodes"},
    }
    print(json.dumps({"model":result["model_id"],"fem":numerics}),flush=True)
    return result


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--levels",nargs="+",type=int,default=[2,3,4])
    parser.add_argument("--report",type=Path,default=Path("fem-report.json"))
    parser.add_argument("--output-dir",type=Path)
    args=parser.parse_args()
    if args.output_dir:
        args.output_dir.mkdir(parents=True,exist_ok=True)
        reports=[]
        for skull in [.002,.004,.008]:
            result=fixture(4,skull)
            name="fem-model.json" if skull==.004 else f"fem-skull-{skull:.3f}.json"
            (args.output_dir/name).write_text(json.dumps(result,separators=(",",":"),allow_nan=False))
            reports.append({"model_id":result["model_id"],**result["fem"]})
        args.report.write_text(json.dumps({"status":"spherical-benchmark-not-anatomical-FEM","threshold":.05,"models":reports},indent=2))
    else:
        reports=[]
        for level in args.levels:
            *_,report=build(level)
            reports.append(report)
        args.report.write_text(json.dumps({"threshold":.05,"meshes":reports},indent=2))
        assert reports[-1]["max_mne_relative_l2"]<.05, "FEM benchmark exceeds predeclared 5% field L2 tolerance"
        if len(reports)>1:
            assert reports[-1]["rms_mne_relative_l2"]<reports[0]["rms_mne_relative_l2"], "Refinement did not improve the field"


if __name__=="__main__":
    main()
