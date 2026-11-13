#!/usr/bin/env python3
"""Opt-in fsaverage MRI/BEM EEG forward reference build for BrainRun PR5.

This is a genuine human TEMPLATE MRI/BEM model, not the earlier concentric
sphere. Do not publish generated FreeSurfer-derived assets without explicit
license review: the filesystem output is gitignored and never deployed by
default. This program does not claim a validated cognitive/neural-mass mapping.

Requirements: mne==1.11.0, numpy; fsaverage can be fetched by --download.
The HEAD and MRI coordinates are rigorously related via the explicit
fsaverage head->MRI transform included with MNE-Python. BEM forward solutions
are evaluated at selected MRI source-space cortical vertices. Head positions
are millimetres, dipole moments nA.m, forward gain µV/(nA.m).

Typical first trial (outside the public asset pipeline):
  python scientific/forward/generate_fsaverage_bem.py --download \
    --sources-per-hemisphere 8 --montage 10-20
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import mne
from mne.io.constants import FIFF
import numpy as np

MNE_PIN = "1.11.0"
MONTAGES = ("10-20", "10-10", "10-05")
CORE_1020 = (
    "Fp1 Fp2 F7 F3 Fz F4 F8 T7 C3 Cz C4 T8 "
    "P7 P3 Pz P4 P8 O1 O2"
).split()
# Matches the previously verified sphere montage name sets.
MNE_MONTAGE = {"10-20": "standard_1020", "10-10": "standard_1020",
               "10-05": "standard_1005"}

def require_version() -> None:
    if mne.__version__ != MNE_PIN:
        raise RuntimeError(f"Require MNE {MNE_PIN}, got {mne.__version__}")

def validate_mri_head_transform(trans: dict) -> None:
    frames = {trans["from"], trans["to"]}
    if frames != {FIFF.FIFFV_COORD_HEAD, FIFF.FIFFV_COORD_MRI}:
        raise ValueError("Expected explicit HEAD<->MRI transform, not MNI/Talairach")
    matrix = np.asarray(trans["trans"], dtype=float)
    if matrix.shape != (4, 4) or not np.isfinite(matrix).all():
        raise ValueError("Bad HEAD/MRI affine")
    if not np.allclose(matrix[3], [0, 0, 0, 1], atol=1e-10):
        raise ValueError("Invalid homogeneous affine bottom row")
    if abs(np.linalg.det(matrix[:3, :3])) < 1e-8:
        raise ValueError("Singular HEAD/MRI affine")

def as_mri_to_head(trans: dict) -> dict:
    validate_mri_head_transform(trans)
    if trans["from"] == FIFF.FIFFV_COORD_MRI:
        return trans
    return mne.transforms.invert_transform(trans)

def sources_from_src(src, mri_to_head, per_hemisphere: int):
    if len(src) != 2:
        raise ValueError("Expected two fsaverage surface hemispheres")
    if per_hemisphere < 2:
        raise ValueError("At least two vertices per hemisphere needed")
    sources=[]
    coords=[]
    for hemi_index,hemisphere in enumerate(("lh","rh")):
        s=src[hemi_index]
        if s["coord_frame"] != FIFF.FIFFV_COORD_MRI:
            raise ValueError("fsaverage source vertices were not MRI coordinates")
        vertno=np.asarray(s["vertno"],dtype=int)
        if len(vertno)<per_hemisphere:
            raise ValueError("Not enough vertices in source space")
        chosen=vertno[np.linspace(0,len(vertno)-1,per_hemisphere,dtype=int)]
        mri_m=np.asarray(s["rr"])[chosen]
        head_m=mne.transforms.apply_trans(mri_to_head,mri_m)
        # MNE source space 'nn' is the MRI cortical surface normal.
        # Apply the rotation only (NO translation) to the HEAD RAS frame.
        # The resulting normal is a physical ORIENTATION assumption for
        # aligned cortical pyramidal cells, not a validated current sign.
        normals_mri=np.asarray(s["nn"],dtype=float)[chosen]
        rotation=np.asarray(mri_to_head["trans"],dtype=float)[:3,:3]
        normal_head=normals_mri @ rotation.T
        lengths=np.linalg.norm(normal_head,axis=1)
        if np.any(~np.isfinite(lengths)) or np.min(lengths)<1e-10:
            raise ValueError("Invalid cortical source surface normal")
        normal_head=normal_head/lengths[:,None]
        if not np.isfinite(head_m).all():
            raise ValueError("Nonfinite source coordinates")
        for v,p,n in zip(chosen,head_m,normal_head):
            sources.append({
                "hemisphere":hemisphere,
                "vertex":int(v),
                "head_mm":np.round(p*1000,5).tolist(),
                "normal_head_unit":np.round(n,8).tolist(),
            })
            coords.append(p)
    return sources,np.asarray(coords)

def registered_montage(montage_name: str):
    if montage_name not in MONTAGES:
        raise ValueError("Unknown montage")
    mne_name=MNE_MONTAGE[montage_name]
    montage=mne.channels.make_standard_montage(mne_name)
    if montage_name=="10-20":
        names=CORE_1020
    elif montage_name=="10-10":
        names=montage.ch_names
    else:
        names=mne.channels.make_standard_montage("standard_1005").ch_names
    if any(name not in montage.ch_names for name in names):
        raise ValueError("Montage missing electrode")
    info=mne.create_info(names,sfreq=250.,ch_types="eeg")
    info.set_montage(montage)
    for ch in info["chs"]:
        if ch["coord_frame"] != FIFF.FIFFV_COORD_HEAD:
            raise ValueError("EEG montage sensor must be in HEAD coordinates")
        if not np.isfinite(ch["loc"][:3]).all():
            raise ValueError("Invalid sensor location")
    return info

def gain_from_bem(bem_file:Path, info, positions_head_m:np.ndarray):
    """Three Cartesian unit moments per vertex, via real boundary element forward."""
    # MNE expects source dipole positions and orientations in the HEAD frame.
    count=len(positions_head_m)
    pos=np.repeat(positions_head_m,3,axis=0)
    moment_axes=np.tile(np.eye(3), (count,1))
    dipoles=mne.Dipole(
        times=np.arange(len(pos),dtype=float)*0.001,
        pos=pos,
        amplitude=np.full(len(pos),1e-9),
        ori=moment_axes,
        gof=np.ones(len(pos)),
    )
    fwd,_=mne.make_forward_dipole(
        dipoles,bem=str(bem_file),info=info,trans="fsaverage",
        n_jobs=1,on_inside="raise",verbose=False,
    )
    gain=np.asarray(fwd["sol"]["data"],dtype=float)*1e-3
    if gain.shape!=(len(info["ch_names"]),count*3):
        raise ValueError(f"Unexpected EEG BEM lead-field shape: {gain.shape}")
    if not np.isfinite(gain).all():
        raise ValueError("BEM lead-field has NaN/Infinity")
    if np.max(np.abs(gain)) <= 1e-12:
        raise ValueError("BEM lead-field is identically zero")
    return gain

def head_mesh(mri_to_head, rr, tris):
    # All geometry is transformed from MRI RAS (m) to HEAD RAS (mm).
    pts=mne.transforms.apply_trans(mri_to_head,np.asarray(rr,dtype=float))*1000
    indices=np.asarray(tris,dtype=int)
    if len(pts)<3 or len(indices)<1 or (indices<0).any() or (
        indices>=len(pts)).any() or not np.isfinite(pts).all():
        raise ValueError("Invalid head-space mesh")
    return {
        "vertices_head_mm": np.round(pts,3).tolist(),
        "triangles": indices.tolist(),
    }

def simplified_cortex_mesh(mri_to_head, source_space, target_faces: int):
    """Display-only quadric decimation; physical BEM sources never move.

    This mesh is for Three.js only. The gain matrix is calculated from the
    ORIGINAL MRI-space source vertices, never from simplified display points.
    """
    if target_faces < 2000:
        raise ValueError("Display mesh simplification must retain >= 2000 faces")
    rr=np.asarray(source_space["rr"],dtype=float)
    tris=np.asarray(source_space["tris"],dtype=int)
    if len(tris) <= target_faces:
        return head_mesh(mri_to_head, rr, tris)
    try:
        import trimesh
        geometry=trimesh.Trimesh(vertices=rr,faces=tris,process=False)
        reduced=geometry.simplify_quadric_decimation(face_count=target_faces)
    except ImportError as e:
        raise RuntimeError(
            "Install trimesh and fast-simplification for anatomical display mesh"
        ) from e
    if len(reduced.faces) > target_faces or len(reduced.faces) < target_faces*0.8:
        raise ValueError("Display cortex decimation produced unexpected face count")
    return head_mesh(mri_to_head, reduced.vertices, reduced.faces)

def label_at_source_vertex(annot_labels,hemisphere,vertex):
    return next((label.name for label in annot_labels
       if label.hemi==hemisphere and vertex in label.vertices),"unknown")

def build(fs_dir:Path, out:Path, sources_per_hemisphere:int, montage_name:str, display_mesh_faces:int=12000):
    require_version()
    bem_file=fs_dir/"bem/fsaverage-5120-5120-5120-bem-sol.fif"
    src_file=fs_dir/"bem/fsaverage-ico-5-src.fif"
    if not src_file.is_file() or not bem_file.is_file():
        raise FileNotFoundError("fsaverage BEM/source-space files not available; opt in with --download")
    transform_file=Path(mne.__file__).parent/"data/fsaverage/fsaverage-trans.fif"
    trans=mne.read_trans(transform_file)
    mri_to_head=as_mri_to_head(trans)
    # FreeSurfer calls this 'talairach.xfm', but MNE's documented destination
    # is mni_tal (MNI305-style stereotaxic coordinates). It must NOT be
    # silently labeled MNI152 or true Talairach atlas coordinates.
    mri_to_mni305=mne.read_talxfm(
        "fsaverage",subjects_dir=fs_dir.parent,verbose=False)
    if (mri_to_mni305["from"]!=FIFF.FIFFV_COORD_MRI or
        mri_to_mni305["to"]!=FIFF.FIFFV_MNE_COORD_MNI_TAL):
        raise ValueError("MNI305 transform frame mismatch")
    src=mne.read_source_spaces(src_file,verbose=False)
    points,pos_head=sources_from_src(src,mri_to_head,sources_per_hemisphere)
    head_to_mri=mne.transforms.invert_transform(mri_to_head)
    mri_source_m=mne.transforms.apply_trans(head_to_mri,pos_head)
    mni305_source_m=mne.transforms.apply_trans(mri_to_mni305,mri_source_m)
    for item,p in zip(points,mni305_source_m):
        item["mni305_mm"]=np.round(p*1000,5).tolist()
    info=registered_montage(montage_name)
    gain=gain_from_bem(bem_file,info,pos_head)
    # Require actual anatomical boundaries; a spherical mesh is not enough.
    surfaces=mne.read_bem_surfaces(str(bem_file),verbose=False)
    by_id={
        int(s["id"]):s for s in surfaces
    }
    ids={
        "brain":FIFF.FIFFV_BEM_SURF_ID_BRAIN,
        "skull":FIFF.FIFFV_BEM_SURF_ID_SKULL,
        "scalp":FIFF.FIFFV_BEM_SURF_ID_HEAD,
    }
    if any(id not in by_id for id in ids.values()):
        raise ValueError("Template three-layer BEM lacks required boundaries")
    geometry={
        layer:head_mesh(mri_to_head,by_id[id]["rr"],by_id[id]["tris"])
        for layer,id in ids.items()
    }
    # Use source space mesh in MRI coordinates: no FreeSurfer surface-RAS ambiguity.
    geometry["cortex"]={
       hemi:simplified_cortex_mesh(mri_to_head,s,display_mesh_faces)
       for hemi,s in zip(("lh","rh"),src)
    }
    labels=mne.read_labels_from_annot(
        "fsaverage",parc="aparc",subjects_dir=fs_dir.parent,verbose=False)
    for point in points:
        point["atlas"]="aparc"
        point["region"]=label_at_source_vertex(labels,point["hemisphere"],point["vertex"])
    sensors=[
        {"label":ch["ch_name"],
         "head_mm":np.round(ch["loc"][:3]*1000,5).tolist()}
        for ch in info["chs"]
    ]
    payload={
      "model_id":"fsaverage-mne-three-layer-bem-v1",
      "mne_version":mne.__version__,
      "subject":"fsaverage",
      "subject_type":"human-averaged-anatomical-template-not-individual",
      "montage":montage_name,
      "frame":"HEAD_RAS_MM",
      "transform_mri_to_head_rowmajor":np.round(mri_to_head["trans"],12).tolist(),
      "transform_mri_to_mni305_rowmajor":np.round(mri_to_mni305["trans"],12).tolist(),
      "standard_coordinate_definition":"MNE mni_tal (FreeSurfer MNI305), not MNI152 and not Talairach",
      "source_moment_unit":"nA_m",
      "gain_unit":"uV_per_nA_m",
      "forward_method":"MNE make_forward_dipole + fsaverage three-layer BEM",
      "source_orientation":"MNE original cortical normals rotated MRI→HEAD (sign conventional; no subject calibration)",
      "interpolation":"none; only precomputed source vertices are physically validated",
      "display_geometry":"decimated original cortical source-space surface (visualization only)",
      "display_mesh_target_faces":display_mesh_faces,
      "source_positions":points,
      "electrodes":sensors,
      "gains_uV_per_nAm":np.round(gain,8).tolist(),
      "meshes":geometry,
      "license_status":"REVIEW_REQUIRED_FREESURFER_DERIVED_ASSET",
      "limitations":[
          "Template anatomy is not a subject-specific MRI.",
          "MRI/HEAD registration follows MNE fsaverage transform; MNI305 uses FreeSurfer talairach.xfm; no MNI152 or true Talairach conversion.",
          "An optional separate local Wilson-Cowan column has explicitly assumed effective current/cell count/geometry; this is not empirical calibration of TVB or human EEG.",
          "EEG lead-fields valid at these source vertices; not arbitrary free-space drag.",
          "Generated geometry/forward is FreeSurfer-derived; do not distribute until license review.",
      ],
    }
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(payload,allow_nan=False,separators=(",",":")),encoding="utf-8")
    print(json.dumps({
        "model":payload["model_id"],"subject":payload["subject"],
        "sources":len(points),"electrodes":len(sensors),
        "meshes":{k:len(v["vertices_head_mm"]) if "vertices_head_mm" in v else {
            h:len(mesh["vertices_head_mm"]) for h,mesh in v.items()}
          for k,v in geometry.items()},
        "output":str(out),
    }))
    return payload

def fetch_pinned_fsaverage(subjects_dir:Path):
    """Official MNE mirror of the exact OSF inputs used by pinned MNE 1.11."""
    import hashlib, urllib.request, zipfile
    from tempfile import TemporaryDirectory
    archives=[
      ("fsaverage-root.zip","1270f22cbbdc6590ceded4ac48f1f456641cf0fdb0906a821632763d02ac9d83",subjects_dir),
      ("fsaverage-bem.zip","07b52d9b119e6bfb22ba262f0098a020708f52895a5bc9f4012f736d537ade5f",subjects_dir/"fsaverage"),
    ]
    subjects_dir.mkdir(parents=True,exist_ok=True)
    with TemporaryDirectory() as temporary:
        for name,digest,dest in archives:
            url="https://github.com/mne-tools/mne-data/releases/download/fsaverage-1.0/"+name
            archive=Path(temporary)/name
            urllib.request.urlretrieve(url,archive)
            if hashlib.sha256(archive.read_bytes()).hexdigest()!=digest:
                raise ValueError("fsaverage archive checksum mismatch")
            with zipfile.ZipFile(archive) as z:
                for member in z.infolist():
                    if not (dest/member.filename).resolve().is_relative_to(dest.resolve()):
                        raise ValueError("Unsafe archive path")
                z.extractall(dest)
                notices=[n for n in z.namelist() if any(t in Path(n).name.lower() for t in ("license","copying","copyright","notice"))]
                print(json.dumps({"archive":name,"sha256":digest,"source":url,"included_notice_paths":notices}))
    return subjects_dir/"fsaverage"

def package_public_asset(payload, out:Path):
    """Redistribute only the modified, attributed template derivative, not MRI."""
    import hashlib
    notice = (
      'All or portions of this licensed product (such portions are the "Software") '
      'have been obtained under license from The General Hospital Corporation "MGH" '
      'and are subject to the following terms and conditions:\n'
    )
    license_file=Path(__file__).resolve().parents[2]/"licenses/FreeSurfer-1.0.txt"
    license_text=license_file.read_text(encoding="utf-8")
    if 'PART B. DOWNLOADING AGREEMENT' not in license_text:
        raise ValueError("Missing FreeSurfer distribution terms")
    # Same physical sources and electrodes. No coordinate scaling/clamping.
    info=registered_montage(payload["montage"])
    pos=np.asarray([p["head_mm"] for p in payload["source_positions"]])*1e-3
    center=np.mean(np.asarray(payload["meshes"]["scalp"]["vertices_head_mm"])*1e-3,axis=0)
    radius=max(.095, float(np.max(np.linalg.norm(pos-center,axis=1)))/.85)
    sphere=mne.make_sphere_model(r0=center,head_radius=radius,
        relative_radii=(.87,.92,.97,1.),sigmas=(.33,1.,.004,.33),verbose=False)
    count=len(pos)
    dipoles=mne.Dipole(times=np.arange(3*count)*.001,
        pos=np.repeat(pos,3,axis=0),amplitude=np.full(3*count,1e-9),
        ori=np.tile(np.eye(3),(count,1)),gof=np.ones(3*count))
    fwd,_=mne.make_forward_dipole(dipoles,bem=sphere,info=info,
        trans=None,on_inside="raise",verbose=False)
    sphere_gain=np.asarray(fwd["sol"]["data"])*1e-3
    if sphere_gain.shape!=np.asarray(payload["gains_uV_per_nAm"]).shape or not np.isfinite(sphere_gain).all():
        raise ValueError("Incompatible same-coordinate sphere comparison")
    payload["comparison_sphere"]={
      "description":"Enclosing four-layer sphere; same HEAD source and sensor coordinates, not an individual fit",
      "center_head_mm":(center*1000).tolist(),"outer_radius_mm":radius*1000,
      "relative_radii":[.87,.92,.97,1.],"conductivity_S_per_m":[.33,1.,.004,.33],
      "gains_uV_per_nAm":np.round(sphere_gain,8).tolist(),
    }
    payload["license_status"]="FREESURFER_1_0_WITH_NOTICE"
    mne_terms=(Path(__file__).resolve().parents[2]/"licenses/MNE-data-BSD-3-Clause.txt").read_text(encoding="utf-8")
    payload["distribution_notice"]=notice+license_text+"\nMNE mirror notice:\n"+mne_terms
    payload["license_source"]="https://surfer.nmr.mgh.harvard.edu/fswiki/FreeSurferSoftwareLicense"
    payload["modified_by"]="BrainRun: reduced display meshes, selected cortical vertices, HEAD transform and MNE EEG forward matrices"
    payload["input_provenance"]={"mne_version":mne.__version__,
      "mirror":"https://github.com/mne-tools/mne-data/releases/tag/fsaverage-1.0",
      "archive_sha256":{"root":"1270f22cbbdc6590ceded4ac48f1f456641cf0fdb0906a821632763d02ac9d83","bem":"07b52d9b119e6bfb22ba262f0098a020708f52895a5bc9f4012f736d537ade5f"},
      "dataset":"MNE fetch_fsaverage; FreeSurfer fsaverage",
      "source_space":"fsaverage-ico-5-src.fif",
      "bem":"fsaverage-5120-5120-5120-bem-sol.fif"}
    payload["limitations"][-1]="Modified FreeSurfer-derived template; full FreeSurfer 1.0 terms accompany every asset."
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(payload,allow_nan=False,separators=(",",":")),encoding="utf-8")
    (out.parent/"FreeSurfer-LICENSE.txt").write_text(notice+license_text,encoding="utf-8")
    digest=hashlib.sha256(out.read_bytes()).hexdigest()
    (out.parent/"fsaverage-bem.sha256").write_text(digest+"  "+out.name+"\n",encoding="utf-8")
    print(json.dumps({"public_asset":str(out),"bytes":out.stat().st_size,"sha256":digest}))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--subjects-dir",type=Path,
        default=Path.home()/ "mne_data/MNE-fsaverage-data")
    parser.add_argument("--download",action="store_true",
        help="Explicitly fetch source subject files from MNE; ~435 MB compressed")
    parser.add_argument("--sources-per-hemisphere",type=int,default=8)
    parser.add_argument("--montage",choices=MONTAGES,default="10-20")
    parser.add_argument("--display-mesh-faces",type=int,default=12000)
    parser.add_argument("--output",type=Path,
       default=Path(".local-assets/pr5/fsaverage-bem.json"))
    parser.add_argument("--package-public",action="store_true",help="Include FreeSurfer terms and modified-data notice in a web asset")
    args=parser.parse_args()
    if args.download:
        fs_dir=fetch_pinned_fsaverage(args.subjects_dir)
    else:
        fs_dir=args.subjects_dir/"fsaverage"
    payload=build(fs_dir,args.output,args.sources_per_hemisphere,args.montage,args.display_mesh_faces)
    if args.package_public:
        package_public_asset(payload,args.output)

if __name__=="__main__":
    main()
