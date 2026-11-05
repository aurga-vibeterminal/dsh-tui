# DSH TUI

**DSH TUI** — a fullscreen agent console for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`), running in-process as a dsh plugin bundle. Watch agents work, step in the moment you're needed, and ship.

**Status: v0.1.0.** The full user guide lives in [docs/GUIDE.md](docs/GUIDE.md) — keys, commands, sessions, `@` file search, image input, todos, permissions, themes, export, plugins & MCP, troubleshooting.

## Features

- **Chat & steering** — `Enter` sends (queues into the next turn while the agent runs), `Alt+S` submits as next-step input for the running turn, `Esc` interrupts, `Ctrl+Q` quits and prints the transcript into scrollback.
- **Transcript** — tool cards for diffs / file reads / terminal output / search lists (`Ctrl+O` toggles the newest card's detail, `/expand` toggles all), in-viewport search (`Ctrl+Shift+F`), prompt-to-prompt jumps (`Ctrl+Up` / `Ctrl+Down`), full repaint (`Ctrl+L`).
- **Sessions** — created on first message and grouped by the working directory's final segment (the same workspace registry the web UI's sidebar follows); `/session` (alias `/resume`) switches, `/fork` branches onto a copy, `dsh tui -r [session]` resumes at startup; subagent, archived, and never-started sessions are hidden from the picker.
- **Slash commands** — TUI-local: `/model`, `/thinking` (alias `/effort`), `/permission`, `/preset`, `/mcp`, `/skill` (alias `/skills`), `/reload`, `/cwd`, `/inbox`, `/todo`, `/expand`, `/theme`, `/language`, `/export`, `/events`, `/clear`. Commands registered by the runtime profile (e.g. `/compact`, `/goal`, `/plan`) flow through the same pipeline.
- **Skills** — `#skill-name` references in the composer (marked `🛠`, expand to the model's `<skill>` form on send), a `/<skill-name> <task>` first-line gesture for deterministic invocation, and the `/skill` browser over project (`.agents/skills`) and user (`~/.agents/skills`) skills.
- **File references & image input** — `@` fuzzy file search (backed by `fd` when installed), `Tab` forced path completion; image paths (`.png` `.jpg` `.jpeg` `.webp` `.gif`) that exist on disk attach as real image inputs for vision models (`deepseek-flash`), with an up-front notice when the current model has no image input.
- **Todos** — authored by the agent through `todo_write`; the transcript shows `· todos 2/5 done (/todo)` and `/todo` opens the live list (`☑` / `◐` / `☐`).
- **Context compaction** — step-boundary auto-compaction at ≥80% of the context window plus context-overflow recovery (built into dsh-base, active mid-turn); `/compact` runs immediately when idle and **queues for the turn's end when the agent is running** (coalesced, interrupt-friendly), with a one-shot `~70%` pressure hint after each turn.
- **Busy & idle reporting** — the header spinner follows one aggregate state (turn, compaction/maintenance, in-flight LLM request, live background subagents); `OSC 9;4` tab progress is active only while working and clears while waiting for input or idle, while `OSC 7501` distinguishes `working` / `blocked` / `idle`; see [Terminal status](docs/GUIDE.md#busy-idle--terminal-status).
- **Permissions & approvals** — approval bar (`y`/`Enter` allow once, `n`/`Esc` reject), presets `workspace-write` / `read-only` / `danger-full-access` via `/permission`, current preset shown in the header.
- **Persisted settings** — preset mode (`standard` / `ptc` / `minimal` / `cordis`), theme (`dark` for dark terminal backgrounds / `light` for light ones — body text re-colors, truecolor with ANSI fallback), language (English / 中文), and default model route survive restarts in `$DSH_HOME/tui/settings.json`; startup precedence is CLI flag > saved setting > default, and the saved model still hot-switches mid-session.
- **Export** — `/export [path]` writes the transcript as Markdown (header metadata, turns with reasoning collapsed into `<details>`, tool result digests, notices).
- **Plugins & MCP** — everything in `dsh-base` is shared with the web UI (tools, registry commands, approvals, subagents, compaction, attachments); profile-specific bundles stay isolated, each profile being its own pnpm workspace. MCP servers are per-profile plugin rows in the profile's `cordis.patch.yml`; their tools register as `mcp__<serverName>__<tool>` with standard approvals. `/reload` applies profile composition changes in place.

## Install (into a `tui` profile)

The package is **not yet published** — one-time setup from a fresh machine:

**1. Install dsh** (the DeepSeek Harness CLI):

```sh
npm install -g @deepseek-ai/dsh
```

**2. Install pnpm** (the repo's package manager):

```sh
npm install -g pnpm
```

**3. Build the local checkout:**

```sh
cd D:\path\to\dsh-tui
pnpm install
pnpm build         # tsdown → lib/
```

`lib/` must exist before step 4: the profile links against this checkout, and a missing build surfaces as `failed to import … lib/index.js` when the profile activates.

**4. Install the bundle into the profile:**

```sh
dsh plugin --profile tui add D:\path\to\dsh-tui     # local path (dev)
# or, without a local checkout:
dsh plugin --profile tui add github:aurga-vibeterminal/dsh-tui   # git source: pnpm clones and builds it via `prepare` (see note)
```

Then launch:

```sh
dsh tui                          # shorthand for dsh --profile tui
dsh tui -r                       # open the session picker at startup (alias --resume)
dsh tui -r session-xxxx          # continue a stored session
dsh tui --preset ptc             # agent mode: standard (default) | ptc | minimal | cordis
dsh tui --model deepseek-account/deepseek-flash   # explicit model route
```

Once published as `@vterminal/dsh-tui`, the shorthand `dsh plugin --profile tui add @vterminal/dsh-tui` will work.

> **Git-source note.** `github:…` runs `pnpm add` inside the profile: pnpm clones the repository, runs the bundle's `prepare` script (`tsdown` → `lib/`), and links the built snapshot — no manual checkout or build needed. pnpm ≥ 10.26 gates dependency build scripts behind `allowBuilds`, so the first install may report the build as pending; approve it (`pnpm approve-builds` in the profile, or dsh's guided approval) and re-run the `add`. The install is pinned to the cloned commit — update by re-running the `add`.

The first `add` initializes the profile over `dsh-base`; the bundle contributes a `tui-startup` provider (flag parsing) and a `tui-runner` (the terminal app). HMR stays enabled with the base default `root: []` — configuration watches only, no module watching: profile patch changes (e.g. newly added MCP rows) apply live and `/reload` forces a reconcile, while module-code changes — including the dev-linked bundle's own rebuilds — are never hot-swapped under the fullscreen app and report a restart.

## Develop

```sh
pnpm install
pnpm build         # tsdown → lib/
pnpm typecheck
pnpm test
```

Run against a local dsh (sandboxed Harness home):

```sh
pnpm build
$env:DSH_HOME = "<repo>/.dsh-test"
dsh plugin --profile tui add <repo-path>    # re-run after code changes
dsh --profile tui
```

For daily development the profile is also installed into the real `~/.dsh` (any shell: `dsh tui`); the install is a pnpm link to this repo, so `pnpm build` is the only step between edit and run (`pnpm dev` watches).

Record event fixtures for tests (keyless, drives `dsh-llm-mock-server`):

```sh
pnpm record basic-chat "<prompt>"
pnpm record tool-call "<prompt>" --tool-call   # scripted glob tool call
```

## Known Limitations

- Not yet published to npm; install from a local path or git (see above). The published name will be `@vterminal/dsh-tui`.
- Pinned to dsh `>=0.2.1-rc.2 <0.3.0` via `engines.dsh` (dsh is a developer preview; breaking changes are expected between minor lines).
- `@` file search needs a space before the `@` (CJK characters are not word boundaries in pi-tui 1.3.0); install `fd` for the fast path.
- pi-tui 1.3.0 quirks we work around: alt-screen stop print-back (we print our own transcript), no `fd` fallback for fuzzy search (we ship one).
- Module-code changes require a restart — under the fullscreen app only configuration is hot-reloaded (`/reload` covers composition changes).
- Plugins and MCP servers are per-profile by design: bundles installed into the web profile are invisible to the TUI profile, and vice versa.
- Mouse wheel falls back to arrow-key history on terminals without SGR mouse reporting (DEC modes 1000/1002/1006); use `PgUp`/`PgDn` there.
