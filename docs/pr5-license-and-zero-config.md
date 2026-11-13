# Template BEM distribution record

Updated 2026-11-13. This record supersedes the earlier unresolved OSF mirror audit; it does not certify individual anatomy, physiology or clinical use.

- Official FreeSurfer 1.0 agreement expressly covers downloaded software and data; Part B permits modified distribution subject to its notice, terms and attribution obligations. Complete text is preserved in `licenses/FreeSurfer-1.0.txt`.
- The official MNE release https://github.com/mne-tools/mne-data/releases/tag/fsaverage-1.0 identifies its two archives as mirrors of the precise former OSF fsaverage archives. SHA-256: root `1270f22cbbdc6590ceded4ac48f1f456641cf0fdb0906a821632763d02ac9d83`; BEM `07b52d9b119e6bfb22ba262f0098a020708f52895a5bc9f4012f736d537ade5f`. These resolve the previously undocumented mirror provenance; they do not relicense FreeSurfer as BSD.
- Packaging carries the entire FreeSurfer agreement with the required prefatory notice, the MNE mirror notice, modification identity, model limitations, exact archive provenance and generated-asset SHA-256. Archive notice paths are logged during cloud acquisition. The distribution includes selected cortical geometry/vertices, aparc names and BEM forward matrices, not MRI volumes or unrelated atlas files.
- The template is a human average, with explicit MRI/HEAD and MNI305 transforms; it is neither individualized MRI nor MNI152/true Talairach. BEM sources snap to precomputed vertices. The same-coordinate four-layer sphere comparison is a geometric approximation, not ground truth.
- This update does not resolve the separate TVB mixed demo-connectome licensing question documented in `data-license.md`.

The public model is generated in GitHub Actions, validated against an independent fresh MNE calculation, and loaded when users choose the anatomical template. Importing a compatible file remains an advanced option. The shared analysis records template geometry, source, reference and time; inverse analysis must use the BEM matrix, never the teaching-sphere matrix.
