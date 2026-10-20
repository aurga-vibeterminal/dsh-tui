# Renderer decision — use `@earendil-works/pi-tui`

Status: **Decided** (Phase 0 · Spike 2) · Date: 2026-10-20 · Supersedes: the open question in PLAN §11.1

## Decision

Depend on **`@earendil-works/pi-tui` (pinned `1.3.0`)** as the renderer core, using **`TuiAltScreen`** — the fullscreen alternate-screen renderer with app-owned scrolling — to deliver the opencode-style layout mandated by PLAN v3 §4. No in-house renderer.

## Why

| Criterion | Finding |
|---|---|
| Style fit | `TuiAltScreen` + `VStack`/`ScrollView` layout root + overlays is exactly the opencode model: persistent header, app-scrolled transcript viewport (`follow: "end"`), bottom composer, dialogs as overlays. Building this in-house (layout regions, scroll physics, mouse hit-testing, scrollbars, in-viewport search) is a multi-week effort, not the ~1 week the scrollback model would have needed. |
| Standalone usability | Verified against the published package: no pi-runtime coupling. Exports cover the whole contract (`Terminal`, `TuiMainScreen`/`TuiAltScreen`, `Component`, Editor/Markdown/Loader/SelectList, `matchesKey`/`Key`, overlays, colors/themes, width utils). |
| Dependencies | Two runtime deps only: `marked`, `get-east-asian-width` (CJK-correct width — mandatory for zh users). No React, no bundler magic. |
| Platform | Ships lazy-loaded native clipboard prebuilds for win32 x64/arm64 (also darwin/linux), loaded via `createRequire` at call time with graceful fallback — safe as an external dependency; nothing for tsdown to bundle. |
| License / size | MIT · 2.4 MB unpacked. |
| Node engine | `>=22.19.0` — matches dsh's own floor. |
| Testability | The `Terminal` interface is a small mock; our `HeadlessTerminal` (headless xterm) enables deterministic, pty-free renderer tests in Vitest. |

## Evidence (Spike 2, all passing — `test/render-spike.test.ts`)

1. **Layout & streaming**: header bar + transcript `ScrollView(follow:'end', primary)` + bordered composer (Editor + hints) render; markdown deltas (CJK + code fence) stream in; the viewport follows the tail (final code block + tool status visible while intro text correctly scrolls out of view).
2. **Differential updates**: streaming replaces old partial lines — no duplication (the final state occurs exactly once).
3. **Editor**: focused Editor receives raw key bytes through the Terminal abstraction (`send`), CJK input works, `Enter` submits, and the appended turn renders.
4. **Width discipline**: every component line satisfies `visibleWidth(line) <= width` at 60 columns.
5. **Alt-screen exit**: `stop()` returns the emulator to the normal buffer cleanly.

## Findings & caveats

1. **60 fps render throttle** (`MIN_RENDER_INTERVAL_MS = 16`): tests must use real-time flushes (`setTimeout ≥ 30 ms`), not microtask ticks.
2. **xterm writes parse asynchronously**: the test adapter tracks pending writes via the `write(data, callback)` API and exposes `settled()`; reads are only valid after it resolves.
3. **Alt-screen has no scrollback**: content scrolled above the viewport is not in the emulator buffer; assertions must use viewport rows while running (`findInView`) and the printed document only after exit.
4. **pi-tui 1.3.0 edge defect** — `TuiAltScreen.stop()`'s document print-back with a `setLayoutRoot` tree renders only the scroll region's first row (measured: `tui.render(60)` returned 6 lines while `transcript.render(60)` returned 18). **Workaround adopted**: dsh-tui prints its own exit transcript from the view model (which we own end-to-end) rather than relying on the renderer's print-back. Candidate for an upstream issue.
5. `VirtualTerminal` (pi's test helper) is not published; our `HeadlessTerminal` fills that role and stays in `test/helpers/`.

## Consequences

- `@earendil-works/pi-tui` becomes a runtime `dependency` (exact pin `1.3.0`); it is external in our tsdown build and installed by the profile's pnpm like any npm dependency.
- Our component work goes into dsh-specific components (`ToolBlock`, `ApprovalBar`, transcript view model) on top of pi-tui primitives — we do not fork or wrap its rendering internals.
- PLAN §11.1 (renderer) and §11.3 (mouse) are resolved; the in-house fallback path is closed unless pi-tui becomes unmaintained.
