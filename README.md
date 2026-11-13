# BrainRun

[Open the app](https://abwoo.github.io/brainrun/) · [简体中文](README.zh-CN.md)

BrainRun is an interactive browser workbench for exploring physical head models and neural dynamics. The physical model is the main interface: move a source, adjust a parameter, and inspect the numerical result. Chinese and English are available throughout the interface.

## Start with the model

The home page opens directly to **Currents & sensors**. There is no automatic experiment, setup wizard, or preset dialog in front of the model.

1. Drag the orange current source, or use the three position sliders.
2. Drag the arrow to rotate continuously, change its signed strength, or reverse polarity.
3. Click a scalp sensor and inspect its potential. Scalp colors, the selected reading and the voltage trace share one forward calculation and a fixed µV scale.
4. Expand model details for electrode layout/reference, a defined source pulse, a second source, scalp-constrained electrode dragging or skull conductivity. These controls change the corresponding calculation.
5. Choose **Head model → Anatomical template BEM** for matching anatomy and precomputed cortical-source lead fields. It loads automatically; file preparation is not needed.
6. For a numerical comparison, expand **More settings and model details → Skull conductivity** and choose **Four-layer spherical FEM**. Conductivity changes the assembled tetrahedral equations. Source motion is limited to the solved ±16 mm cube; the model is spherical, not MRI-derived anatomical FEM.
7. Open **Signal analysis** to inspect the same physical source history. Raw, scalp samples, source estimates and exports retain its model, geometry, reference and observation time.

In **Regions & activity**, the status panel reports actual Worker model time, selected E/I and active/queued inputs. A steady response is distinguished from paused or non-advancing model time. Repeated strong inputs can switch this bistable model into a high-activity state. **Restore before input** explicitly restores a complete pre-input checkpoint; overlapping pulses do not replace it with an already-driven state. **Use gentle input settings** sets a 0.5-amplitude, 20 ms pulse without firing it. The trace shows the full 0–1 activity range and clears old-run samples when rewinding. The response-region count is a retained 2 s peak summary, not an instantaneous activity meter.

The **Regions & activity** tab shows the 76-region network. Select a region, adjust input strength and duration, and apply an input explicitly. Selecting a region or rotating the view does not stimulate it. The activity trace reads the same Worker snapshots as the 3D view.

Use **Restore defaults** to return to a known configuration. The language switch changes presentation without resetting model parameters or recordings.

The FEM option uses 30,745 nodes / 174,080 tetrahedra, current-balanced 2 mm source/sink basis pairs, and an insulating scalp boundary. Its scalp field, moved electrodes, manual/native EEG, inverse matrix and controller projection use the same named FEM operator. Unreferenced FEM values have a zero scalp-area-mean computational datum; average/electrode differences do not depend on that additive gauge. Export retains numerical identity and validation scope. See [FEM methods and limits](docs/spherical-fem.md).

## Advanced tools

The Advanced labs menu keeps additional tools away from the default workbench:

- EEG recordings, spectra, event-related responses, time-frequency analysis, scalp maps and source estimates.
- LIF, Hodgkin–Huxley and multicompartment neuronal models.
- TES/TMS field approximations and sensory-input models.
- Matched main-network A/B from one complete state, branch EEG, saved-state replay and model-clock feedback.
- Brain regions, coordinate frames and model documentation.
- Optional presets on a separate page. They run only when requested and do not cover the main model.

For optional EEG feedback, select a sphere or template BEM source on the home page, choose a network region under **Regions & activity**, then open **Compare and replay**. Select **Selected head-model EEG** as the feedback measurement. Starting freezes that conductor, source orientation, sensor and reference; the displayed source label identifies the active measurement. **Stop and analyze feedback EEG** opens the actual retained causal-filter window. This neural-to-dipole coupling is an explicit uncalibrated assumption, not anatomical registration of the demonstration network.

For full multichannel native EEG, select the head model/source/electrodes on the physical home and a network region under **Regions & activity**. In **Signal analysis**, choose 250 or 500 Hz and **Record neural EEG at the physical source**. The current sphere/BEM geometry and reference are used, with native E/I supplying the primary-source moment. Its baseline is the first retained native sample; manual strength/pulse/second-source inputs are excluded. Raw, spatial views, inverse estimates and exports use the same frozen operator. A/B freezes that operator before forking, so both branch recordings use identical measurement geometry.

## Computation and interface

| Interaction | Numerical path | Display |
| --- | --- | --- |
| Move or rotate a dipole; change moment | MNE-derived four-layer spherical lead field | 3D source and sensors; electrode potentials in µV |
| Apply regional input | React control → SimClient → Worker → Rust/WASM Wilson–Cowan solver | Region activity and the selected activity trace |
| Change a reference | Recompute from preserved infinity-reference data | Updated channel potentials |
| Run an EEG experiment | Local source → forward projection → optional measurement noise | Raw, events and derived analyses with run provenance |
| Restore a snapshot | Restore saved solver state, parameters, random state and history | A new run lineage with the restored model clock |

Shared UI controls include a native accessible Dropdown, labeled range/number controls, and a persistent language switch. Option values, channel names, event codes, numerical arrays and exported schema keys are not translated.

The simulation runs in the browser. There is no hosted numerical API required by the public app. Model assets are generated during the GitHub build.

## Model boundaries

These are educational models, not measurements or predictions for an individual human.

- The four-layer sphere represents brain, CSF, skull and scalp. It uses a 95 mm radius and a finite, interpolated source grid. It is not individual MRI/BEM.
- The TVB demonstration connectome is a hybrid example, mainly macaque CoCoMac weights with scaled human callosal DSI information. It is not a subject-specific human connectome and is not registered to the head-conductor model.
- Neural-to-dipole gains remain explicit assumptions. Absolute EEG/ERP amplitudes are uncalibrated; the known amplitude and inverse-depth limitations remain documented.
- The main network records every 1 ms integration state and produces anti-aliased 250/500 Hz EEG independently of display refresh. Its centered offline FIR discards 64 ms on each edge; it is not a causal online filter. Legacy snapshot-derived experiments retain explicit information-bandwidth limits.
- The optional fsaverage BEM loads automatically with complete data notices; it is template anatomy with solved cortical nodes, not individual MRI or arbitrary-position BEM interpolation. Simulation feedback operates on Worker model time and never controls human-use equipment.

Progress and remaining evidence requirements: [2.0 delivery and acceptance](docs/2.0-sequential-delivery.md).

See [model specification](docs/model-spec.md), [frontend/solver contract](docs/frontend-backend-contract.md), [scientific validation](docs/validation.md), and [data licensing](docs/data-license.md).

## Development

Requirements: Node.js 24, Python 3.12, Rust with the WebAssembly target, and wasm-pack.

```bash
python3 -m pip install numpy mne==1.11.0 nibabel trimesh fast-simplification
python3 scripts/prepare-brain-data/fetch.py
python3 scripts/prepare-brain-data/prepare.py
python3 scientific/forward/generate_sphere_model.py
python3 scientific/forward/generate_sphere_model.py --skull-conductivity 0.002 --output app/public/forward-assets/sphere-skull-0.002.json
python3 scientific/forward/generate_sphere_model.py --skull-conductivity 0.008 --output app/public/forward-assets/sphere-skull-0.008.json
python3 scientific/forward/generate_fsaverage_bem.py --download --package-public --output app/public/forward-assets/fsaverage-bem.json
bash scripts/build-wasm.sh
cd app
npm ci
npm run dev
```

Open the Vite URL printed by the command. Production build: `npm run build`. GitHub Pages build: `npm run build:pages`, using the `/brainrun/` base path.

Pull requests use GitHub Actions for type checks, focused numerical regressions and browser interaction checks. The manual-workbench checks verify source controls against actual potentials, network inputs against Worker acknowledgements, both languages, and mobile layout.

## Data and license

Code: [MIT](LICENSE). Third-party notices: [NOTICE.md](NOTICE.md).

TVB source data and derived brain assets are generated at build time rather than committed. Template redistribution and data-license boundaries are described in [docs/data-license.md](docs/data-license.md). Scientific references and method-specific details are linked from the model documentation.
