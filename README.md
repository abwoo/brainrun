# BrainRun

[Open the app](https://abwoo.github.io/brainrun/) · [简体中文](README.zh-CN.md)

BrainRun is an interactive browser workbench for exploring physical head models and neural dynamics. The physical model is the main interface: move a source, adjust a parameter, and inspect the numerical result. Chinese and English are available throughout the interface.

## Start with the model

The home page opens directly to **Currents & sensors**. There is no automatic experiment, setup wizard, or preset dialog in front of the model.

1. Drag the orange current source, or use the three position sliders.
2. Change its direction or strength.
3. Select a scalp sensor and inspect its potential. Source changes immediately update the forward calculation, 3D sensor display, and numerical readings.
4. Expand model details only when you need electrode layout, voltage reference, units, or assumptions.

The **Regions & activity** tab shows the 76-region network. Select a region, adjust input strength and duration, and apply an input explicitly. Selecting a region or rotating the view does not stimulate it. The activity trace reads the same Worker snapshots as the 3D view.

Use **Restore defaults** to return to a known configuration. The language switch changes presentation without resetting model parameters or recordings.

## Advanced tools

The Advanced labs menu keeps additional tools away from the default workbench:

- EEG recordings, spectra, event-related responses, time-frequency analysis, scalp maps and source estimates.
- LIF, Hodgkin–Huxley and multicompartment neuronal models.
- TES/TMS field approximations and sensory-input models.
- Parameter comparisons, saved-state replay and simulated feedback control.
- Brain regions, coordinate frames and model documentation.
- Optional presets on a separate page. They run only when requested and do not cover the main model.

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
- A live recording derived from roughly 60 Hz visualization snapshots is not native 250/500 Hz acquisition.
- Optional MRI/BEM models must be obtained and generated separately. Simulation feedback does not control human-use equipment.

See [model specification](docs/model-spec.md), [frontend/solver contract](docs/frontend-backend-contract.md), [scientific validation](docs/validation.md), and [data licensing](docs/data-license.md).

## Development

Requirements: Node.js 24, Python 3.12, Rust with the WebAssembly target, and wasm-pack.

```bash
python3 -m pip install numpy mne==1.11.0
python3 scripts/prepare-brain-data/fetch.py
python3 scripts/prepare-brain-data/prepare.py
python3 scientific/forward/generate_sphere_model.py
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
