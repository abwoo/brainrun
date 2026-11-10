"""Independent verification of the Wilson-Cowan fixed-point structure.

Uses scipy (fsolve + solve_ivp), NOT the wilson_cowan.py integrator,
to answer: does the A-set single-node system really have two stable
fixed points, and does my Heun implementation agree with an independent
high-accuracy integrator?
"""
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import fsolve
from scipy.integrate import solve_ivp

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import Params, Simulator, StimulusEvent


def rhs_factory(p: Params):
    def sigmoid(x, a, b, c):
        z = np.clip(-a * (x - b), -700.0, 700.0)
        return c / (1.0 + np.exp(z))

    def f(t, y):
        E, I = y
        x_e = p.alpha_e * (p.c_ee * E - p.c_ei * I - p.theta_e)
        x_i = p.alpha_i * (p.c_ie * E - p.c_ii * I - p.theta_i)
        s_e = sigmoid(x_e, p.a_e, p.b_e, p.c_e)
        s_i = sigmoid(x_i, p.a_i, p.b_i, p.c_i)
        return [(-E + (p.k_e - p.r_e * E) * s_e) / p.tau_e,
                (-I + (p.k_i - p.r_i * I) * s_i) / p.tau_i]
    return f


def find_fixed_points(p: Params):
    f = rhs_factory(p)
    found = []
    for e0 in np.linspace(0, 1, 11):
        for i0 in np.linspace(0, 1, 11):
            sol, info, ier, _ = fsolve(lambda y: f(0.0, y), [e0, i0], full_output=True)
            if ier == 1 and np.allclose(f(0.0, sol), 0.0, atol=1e-10):
                sol = np.clip(sol, -0.01, 1.01)
                if not any(np.allclose(sol, s, atol=1e-6) for s in found):
                    found.append(sol)
    return found


def jacobian_eigs(p: Params, fp):
    # Finite-difference Jacobian of the RHS at the fixed point.
    f = rhs_factory(p)
    eps = 1e-6
    J = np.zeros((2, 2))
    for j in range(2):
        dy = np.zeros(2); dy[j] = eps
        J[:, j] = (np.array(f(0.0, fp + dy)) - np.array(f(0.0, fp - dy))) / (2 * eps)
    return np.linalg.eigvals(J)


def main():
    p = Params()
    fps = find_fixed_points(p)
    print(f"A-set single-node fixed points (fsolve, independent of my integrator): {len(fps)}")
    for fp in fps:
        ev = jacobian_eigs(p, fp)
        stable = bool(np.all(np.real(ev) < 0))
        print(f"  E*={fp[0]:.4f} I*={fp[1]:.4f}  eig={ev}  stable={stable}")

    # Basin map: long Heun runs from a grid of initial conditions.
    print("\nBasin map (2000 ms, no stimulus), endpoint E:")
    for e0 in (0.0, 0.3, 0.6, 1.0):
        row = []
        for i0 in (0.0, 0.3, 0.6, 1.0):
            sim = Simulator(np.array([[0.0]]), np.array([[0.0]]), Params(), e0=e0, i0=i0)
            r = sim.run(2000.0)
            row.append(f"{r.E[-1, 0]:.3f}")
        print(f"  E0={e0}: " + "  ".join(row))

    # Independent integrator cross-check: my Heun vs scipy RK45 (rtol=1e-10),
    # single node, pulse amp 2.0 for 100 ms at t=100 ms, 500 ms total.
    print("\nHeun (dt=1ms) vs scipy solve_ivp RK45 (rtol=1e-10), single node + pulse:")
    f = rhs_factory(p)
    def f_stim(t, y):
        P = 2.0 if 100.0 <= t < 200.0 else 0.0
        E, I = y
        x_e = p.alpha_e * (p.c_ee * E - p.c_ei * I + P - p.theta_e)
        x_i = p.alpha_i * (p.c_ie * E - p.c_ii * I - p.theta_i)
        se = 1.0 / (1.0 + np.exp(np.clip(-p.a_e * (x_e - p.b_e), -700, 700)))
        si = 1.0 / (1.0 + np.exp(np.clip(-p.a_i * (x_i - p.b_i), -700, 700)))
        return [(-E + (p.k_e - p.r_e * E) * se) / p.tau_e,
                (-I + (p.k_i - p.r_i * I) * si) / p.tau_i]
    sol = solve_ivp(f_stim, (0, 500), [0.0, 0.0], method="RK45", rtol=1e-10, atol=1e-12,
                    t_eval=np.arange(0, 501, 1.0))
    sim = Simulator(np.array([[0.0]]), np.array([[0.0]]), Params())
    r = sim.run(500.0, events=[StimulusEvent(0, 100.0, 100.0, 2.0)])
    dE = np.abs(sol.y[0] - r.E[:, 0]).max()
    dI = np.abs(sol.y[1] - r.I[:, 0]).max()
    print(f"  max |dE| vs RK45 = {dE:.3e}, max |dI| = {dI:.3e}  (Heun dt=1ms, O(dt^2) local error expected)")


if __name__ == "__main__":
    main()
