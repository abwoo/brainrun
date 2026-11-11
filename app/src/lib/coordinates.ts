/**
 * Explicit scientific coordinate transforms for BrainRun.
 *
 * No implicit conversions: tvb-demo, head, MRI, MNI and Talairach are
 * DIFFERENT spaces. MNE montage HEAD and our sphere-centred HEAD are
 * connected by a documented origin translation; none of the other spaces
 * has a validated registration in PR5.
 *
 * Matrices are row-major 4x4 affine transforms acting on column
 * homogeneous [x,y,z,1] points in millimetres.
 */
import type { Vec3Mm } from './volumeConduction';

export type CoordinateSpace =
  | 'head-ras-mm'
  | 'head-sphere-centered-mm'
  | 'mri-ras-mm'
  | 'mni152-mm'
  | 'talairach-mm'
  | 'tvb-demo-mm';

export interface SpatialTransform {
  from: CoordinateSpace;
  to: CoordinateSpace;
  matrix: readonly number[]; // 16 numbers, row-major
  provenance: string;
  /** Name of validated registration or analytic coordinate conversion. */
  method: string;
  /** Max/expected spatial error, if measured, in mm. Null means unknown. */
  errorMm: number | null;
}

export function validateTransform(t: SpatialTransform): void {
  if (!t.method.trim() || !t.provenance.trim() ||
      !Array.isArray(t.matrix) || t.matrix.length !== 16 ||
      !t.matrix.every(Number.isFinite) ||
      Math.abs(t.matrix[12]) > 1e-10 ||
      Math.abs(t.matrix[13]) > 1e-10 ||
      Math.abs(t.matrix[14]) > 1e-10 ||
      Math.abs(t.matrix[15] - 1) > 1e-10 ||
      (t.errorMm !== null && (!Number.isFinite(t.errorMm) || t.errorMm < 0))) {
    throw new RangeError('Invalid documented mm-space affine transform');
  }
}

export function applyTransform(t: SpatialTransform, p: Vec3Mm): Vec3Mm {
  validateTransform(t);
  if (p.length !== 3 || !p.every(Number.isFinite)) {
    throw new RangeError('Coordinate must contain three finite mm values');
  }
  const m=t.matrix;
  return [
    m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+m[3],
    m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+m[7],
    m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+m[11],
  ];
}

/** Invert a 3D affine transform with arbitrary nonsingular linear part. */
export function inverseTransform(t: SpatialTransform): SpatialTransform {
  validateTransform(t);
  const m=t.matrix;
  const a=m[0],b=m[1],c=m[2],d=m[4],e=m[5],f=m[6],g=m[8],h=m[9],i=m[10];
  const A=e*i-f*h,B=c*h-b*i,C=b*f-c*e;
  const D=f*g-d*i,E=a*i-c*g,F=c*d-a*f;
  const G=d*h-e*g,H=b*g-a*h,I=a*e-b*d;
  const det=a*A+b*D+c*G;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    throw new RangeError('Spatial transform is singular');
  }
  const inv=[A/det,B/det,C/det,D/det,E/det,F/det,G/det,H/det,I/det];
  const translation=[m[3],m[7],m[11]];
  const result=[
    inv[0],inv[1],inv[2],-inv[0]*translation[0]-inv[1]*translation[1]-inv[2]*translation[2],
    inv[3],inv[4],inv[5],-inv[3]*translation[0]-inv[4]*translation[1]-inv[5]*translation[2],
    inv[6],inv[7],inv[8],-inv[6]*translation[0]-inv[7]*translation[1]-inv[8]*translation[2],
    0,0,0,1,
  ];
  return {
    from:t.to,to:t.from,matrix:result,
    method:'inverse('+t.method+')',
    provenance:t.provenance,
    errorMm:t.errorMm,
  };
}

/** Compose b ∘ a. Unknown or inconsistent registrations are rejected. */
export function composeTransforms(a:SpatialTransform,b:SpatialTransform):SpatialTransform {
  validateTransform(a);validateTransform(b);
  if(a.to!==b.from)throw new Error('Spatial transform frames do not match');
  const c=new Array<number>(16).fill(0);
  for(let r=0;r<4;r++)for(let col=0;col<4;col++)
    for(let k=0;k<4;k++)c[r*4+col]+=b.matrix[r*4+k]*a.matrix[k*4+col];
  return {
    from:a.from,to:b.to,matrix:c,
    provenance:a.provenance+'; '+b.provenance,
    method:b.method+' ∘ '+a.method,
    // Conservative sum bound; unknown remains unknown.
    errorMm:a.errorMm===null||b.errorMm===null?null:a.errorMm+b.errorMm,
  };
}

export const MNE_HEAD_TO_SPHERE:SpatialTransform={
  from:'head-ras-mm',
  to:'head-sphere-centered-mm',
  matrix:[1,0,0,0, 0,1,0,0, 0,0,1,-40, 0,0,0,1],
  method:'subtract MNE sphere origin from head RAS point',
  provenance:'scientific/forward/generate_sphere_model.py: ORIGIN_M=[0,0,0.04]',
  errorMm:0,
};
