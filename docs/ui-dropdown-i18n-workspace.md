# BrainRun UI Design System · Unified Dropdown, Locale and Adjustable Workspace

## Implemented in this PR

1. A single accessible `Dropdown` built on the browser's **native `<select>`** (keyboard, screen readers, optgroups, mobile OS menus). It supplies one unified visual style, chevron, focus ring and disabled state. Migrated **all 32** select instances in EEG, HeadSphere, LocalBEM, stimulation, experiment, inverse and time-frequency labs, plus a new locale dropdown.
2. A central, typed `I18nProvider` with `zh-CN` and `en-US` keys. The language is persisted in localStorage and written to `html[lang]`; the topbar/modes and main-stage controls have both translations.
3. A user-adjustable desktop stage width (45–85%), reset, and 3D focus mode. Default stays 68% and the panels never disappear on narrow screens. **Layout actions are explicitly visual-only**: not a stimulation or neural parameter.
4. The control audit remains complete: **216 source JSX controls**, including shared Dropdown wrappers and new user preferences, without weakening prior causal browser tests.

## IMPORTANT: internationalization is NOT yet complete

English is visibly labeled **preview**. Advanced labs, long scientific explanations, errors, charts and tooltips remain partly Chinese, so this PR does **not** fulfill the final requirement for a seamless complete English product. Do not claim otherwise. This avoids misrepresenting localized science, trial conditions or annotation methods. The remaining work requires:

- Extract all remaining literal strings from all components, including dialogs/tooltips, dynamic error descriptions, 15 scenario presets, exports, axes/units and ARIA labels.
- Add typed bilingual resource dictionaries, terminology review (e.g. scalp potential ≠ source field; observed data ≠ simulated), missing-key CI fail gate and real bilingual visual screenshots.
- Preserve stable computational units and source IDs; never localize JSON property names, raw channel labels, event codes or experimental provenance identifiers.
- Translation UX on 390px touch and desktop keyboard; native dropdown is keyboard and screen-reader accessible by design, but still needs real browser/manual verification.

## Acceptance

- [ ] TypeScript + lint + controls scan + design-system tests pass
- [ ] Playwright Chromium: switch Chinese→English→reload, native Dropdown select/montage, change 3D stage size, focus/restore panels and revert language without JavaScript errors
- [ ] Existing PR5 physical and PR6 EEG/regression green
- [ ] Screenshot review, especially 390px and 978px widths
- [ ] Complete English translation and terminology pass are **future work**; this PR must remain a foundation, not be presented as final bilingual release.

This UI stream is intentionally separate from P0-2 science changes; it is based on the P0-1B branch. Tracking #11.
