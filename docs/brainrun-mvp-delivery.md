# BrainRun MVP delivery

Scope: the user's current P0-2 + Dropdown + flexible usable workspace + complete zh/en UI request. All editing and checks are performed through GitHub; no user-computer build or checkout.

- One Worker-confirmed run identity, command inputs, simulation clock, accepted/applied ACKs, model/geometry IDs, seed and parent lineage. Reset/restore isolates old packets.
- EEG exports include run provenance, source configuration, accepted upstream timeline, restorable Worker snapshots, events and epochs. Legacy scientific fixtures remain readable.
- Starting late oddball now publishes its Raw/events/epochs together. Switching reference clears derived epochs. Mixed-run data cannot enter the shared store. One-channel oddball does not support multielectrode topography or inverse estimation.
- All 36 lab selectors use one native Dropdown. Keyboard, OS touch menus and stable option values are retained.
- Presentation-only JSX localization covers displayed strings, dynamic results, SVG labels, ARIA, tooltips, errors, scenarios and canvas prompts. Numeric data, event codes, option values and exported schema keys are unchanged. Chinese and English persist across reloads.
- Adjustable 3D width, focus mode, resizable desktop labs, mobile scrolling and keyboard Escape/F. Existing one-click scenarios and live measured response remain the beginner entry.

Native 250/500 Hz LIVE source acquisition, anatomical registration, calibrated multiscale human physiology, real-device performance and human usability studies remain separate P0-3/P1 scientific/release work. This MVP must not be represented as that validation.

Integration: #13 carried missing #12 content into main. #17 consolidates #14/#16; #15 is an alternative Dropdown API and is superseded by the single shared implementation.
