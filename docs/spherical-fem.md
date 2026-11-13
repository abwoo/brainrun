# Spherical FEM numerical comparison

This is a four-compartment **spherical** numerical benchmark, not MRI-derived anatomical FEM or an individually calibrated head. FEM is an optional setting in the existing physical workspace; the default analytic model and automatic template BEM remain available.

## Equation and geometry

The quasistatic weak equation is K u = b, with K_ij = integral(sigma grad(phi_i) dot grad(phi_j)) over the volume. P1 tetrahedra are assembled in SI units. Concentric interfaces at 85.5 / 87.4 / 92.15 / 95 mm have conductivities 0.33 / 1 / {0.002, 0.004, 0.008} / 0.33 S/m. Every interface has a conforming mesh ring; no tetrahedron crosses a tissue boundary. Level 4 has 30,745 nodes, 174,080 tetrahedra and 2,562 scalp vertices. All interfaces are faceted.

An insulating Neumann boundary and zero net injected current leave one additive potential constant. One node is pinned for sparse LU, then the surface-area-weighted mean is subtracted. This is not an infinity potential. Legacy JSON names rawDataUvInfinity and infinityGainUvPerNAm mean unreferenced FEM coefficients; exported forwardNumerics.datum identifies surface-area-mean-zero. Average and electrode references use the selected sensors and are gauge invariant. UI labels identify the FEM datum.

Sources use a 2 mm Cartesian current source/sink pair basis. Each load uses its containing tetrahedron's barycentric shape functions, with I = q / separation, q = 1 nA·m. Both zero net current and the exact first spatial current moment are checked. Continuous orientation combines three Cartesian pair solutions. This regularized basis is not an exactly rotated single finite pair or an exact singular point dipole. No fitted amplitude scaling is applied. Sources remain inside brain tissue.

## Shared browser calculation

The generator solves 24 Cartesian fields at the eight nodes of the ±16 mm source cube. Browser movement uses bounded trilinear interpolation. Switching from the wider analytic grid bounds both sources and resets moved electrodes; the UI explains this.

Standard montage rays intersect the actual polyhedral scalp. P1 facet interpolation supplies matching sensor positions and coefficients; positions are not falsely stored at radius 95 mm. Dragged sensors snap to solved vertices, replacing position and gain row together. Scalp colors use FEM nodal solutions, not smoothed montage voltages.

The same operator is frozen for manual Raw, native 250/500 Hz primary-source EEG, A/B projection and native feedback. Shared recording/cursor and weak forward contexts preserve its matrix for topography/inverse after later model changes. Export identifies the model, mesh SHA-256, solver, load, boundary, gauge, dependency versions and error scope. Coordinates remain head-RAS-sphere-centered mm; gains are µV/(nA·m). TVB-to-head anatomical registration and neural-to-moment calibration remain unverified.

## Focused validation

Cloud checks cover mesh conformity and volume coverage, stiffness versus independent scikit-fem 12.0.2, and a homogeneous central-source field versus the insulating sphere analytic solution. They check current/moment conservation, stiffness symmetry/null space, positive energy, residual below 1e-8, reciprocity below 1e-9, superposition and polarity.

The refinement benchmark compares levels 2 and 3 with fresh MNE 1.11.0 four-layer fields. Initial results reduced maximum whole-field relative L2 error from 8.92% to 4.31%; aggregate error reduced from 7.27% to 3.92%. Public assets use finer level 4. Every conductivity-specific asset must pass the predeclared 5% maximum whole-field L2 criterion on all 24 solved Cartesian fields and 12 fields at four off-grid positions: [0,0,0], [15,-15,15], [-12,4,8], [5,9,-7] mm. Comparisons subtract the scalp-vertex mean; no amplitude fit is allowed. Actual metrics are saved in assets and the CI report.

These are case-specific conductor checks, **not** whole-volume or per-sensor error bounds, tests of arbitrary near-zero potentials, a singular dipole convergence proof or physiological validation. MNE's analytic multilayer model and the faceted finite-pair FEM are different approximations. Independent homogeneous and assembly checks complement that reference.

A real-browser path covers solver choice, clamping, conductivity, scalp sensor dragging, pulse Raw/export, native WASM 500 Hz EEG and shared topography/inverse time. Existing acquisition checks cover 250/500 Hz filtering and display-rate independence. This is not novice-user or physical touch-device acceptance.

## Primary references

- [scikit-fem assembly, meshes and elements](https://scikit-fem.readthedocs.io/en/stable/api.html)
- [SciPy sparse LU](https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.splu.html)
- [MNE spherical conductor](https://mne.tools/stable/generated/mne.make_sphere_model.html)
- [FEM EEG potential approaches and source representation](https://pmc.ncbi.nlm.nih.gov/articles/PMC2791331/)

These inform the formulation. This implementation does not claim to implement DUNEuro, a validated anatomical FEM pipeline or a published Venant source scheme.
