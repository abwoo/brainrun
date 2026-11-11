"""Independent high-accuracy SciPy ODE reference for local E/I→dipole coupling.

This is a numerical cross-check, *not* empirical biological calibration.
All current/distance/cell-count values are explicitly assumed.
Outputs are temporary and generated in CI; no copyrighted subject data.
"""
import json
from pathlib import Path
import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import root

TAU_E_MS=12.0
TAU_I_MS=20.0
C_EE=2.8
C_EI=2.4
C_IE=2.6
C_II=0.2
TONIC=0.1
SLOPE=2.5
THRESHOLD=1.1
N=1_000_000
COHERENCE=.08
I_E_PA=200.
I_I_PA=100.
L_MM=.5

def logistic(z):
    return 1. / (1. + np.exp(-SLOPE * (z - THRESHOLD)))

def rates(_t,y,stim):
    e,i=y
    de=(-e+logistic(C_EE*e-C_EI*i+TONIC+stim))/TAU_E_MS
    di=(-i+logistic(C_IE*e-C_II*i+TONIC))/TAU_I_MS
    return np.array([de,di])

def dipole_nam(e,i,b_e,b_i):
    return N*COHERENCE*L_MM*(I_E_PA*(e-b_e)-I_I_PA*(i-b_i))*1e-6

def make_reference():
    equilibrium=root(lambda s:rates(0,s,0),[.1,.1],tol=1e-12)
    if not equilibrium.success and np.max(np.abs(rates(0,equilibrium.x,0)))>1e-12:
        raise RuntimeError("Independent ODE fixed-point solver failed")
    baseline=equilibrium.x
    assert np.max(np.abs(rates(0,baseline,0)))<1e-11
    pieces=[
        (0.,80.,0.),
        (80.,120.,1.4),
        (120.,600.,0.),
    ]
    series=[{"t_ms":0.,"e":float(baseline[0]),"i":float(baseline[1]),
             "q_nAm":0.}]
    state=baseline.copy()
    for start,stop,stim in pieces:
        sample=np.arange(start+4,stop+0.01,4,dtype=float)
        result=solve_ivp(lambda t,y:rates(t,y,stim),(start,stop),state,
            method="DOP853",rtol=1e-12,atol=1e-14,t_eval=sample)
        if not result.success:
            raise RuntimeError(result.message)
        for time,e,i in zip(result.t,result.y[0],result.y[1]):
            series.append({
                "t_ms":float(time),"e":float(e),"i":float(i),
                "q_nAm":float(dipole_nam(e,i,*baseline)),
            })
        state=result.y[:,-1]
    return {
      "method":"Independent SciPy DOP853 piecewise stimulus; numerical cross-check only",
      "t_ms_window":[0,600],
      "stimulus":{"on_ms":80,"off_ms":120,"drive":1.4},
      "baseline_e":float(baseline[0]),
      "baseline_i":float(baseline[1]),
      "morphology":{"N":N,"coherence":COHERENCE,"I_exc_pA":I_E_PA,
                    "I_inh_pA":I_I_PA,"length_mm":L_MM},
      "samples":series,
    }

def main():
    out=Path(__file__).resolve().parents[2]/"tests/pr5/fixtures/local-column-reference.json"
    out.parent.mkdir(parents=True,exist_ok=True)
    result=make_reference()
    out.write_text(json.dumps(result,allow_nan=False,separators=(",",":")))
    print(json.dumps({"samples":len(result["samples"]),
      "peak_nAm":max(abs(x["q_nAm"]) for x in result["samples"]),
      "baseline_e":result["baseline_e"],"baseline_i":result["baseline_i"]}))

if __name__=="__main__":
    main()
