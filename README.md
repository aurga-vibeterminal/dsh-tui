# dsh-tui

A terminal UI **addon** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): an opencode-style fullscreen agent console running in-process as a dsh plugin bundle.

**Status: v0.1.0 — Phases 1–3 complete.** See [docs/PLAN.md](docs/PLAN.md) for the roadmap and [docs/GUIDE.md](docs/GUIDE.md) for the user guide (keys, commands, `@` file search, todos, permissions, themes, export).

## Install (into a `tui` profile)

The package is **not yet published** — install from a local path or a git URL:

```sh
dsh plugin --profile tui add D:\path\to\dsh-tui     # local path (dev)
dsh plugin --profile tui add github:<org>/dsh-tui   # git source (needs its own build via `prepare`)
dsh --profile tui
```

Once published as `@vterminal/dsh-tui`, the shorthand `dsh plugin --profile tui add @vterminal/dsh-tui` will work.

The first `add` initializes the profile over `dsh-base`; the bundle contributes a `tui-startup` provider (flag parsing) and a `tui-runner` (the terminal app) and disables HMR for the profile.

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
- Phase 0 skeleton notices removed: the runner is now the full interactive console (Phases 1–3 complete).
- Pinned to dsh `>=0.2.1-rc.2 <0.3.0` via `engines.dsh` (dsh is a developer preview; breaking changes are expected between minor lines).
- `@` file search needs a space before the `@` (CJK characters are not word boundaries in pi-tui 1.3.0); install `fd` for the fast path.
- pi-tui 1.3.0 quirks we work around: alt-screen stop print-back (we print our own transcript), no `fd` fallback for fuzzy search (we ship one).
