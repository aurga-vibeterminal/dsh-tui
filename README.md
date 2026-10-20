# dsh-tui

A terminal UI **addon** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): a scrollback-native, pi-style agent console running in-process as a dsh plugin bundle.

**Status: Phase 0 skeleton.** See [docs/PLAN.md](docs/PLAN.md) for the roadmap.

## Install (into a `tui` profile)

```sh
dsh plugin --profile tui add dsh-tui        # or a path / git spec for local development
dsh --profile tui
```

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

## Known Limitations

- Phase 0 skeleton: the runner prints resolved startup values and exits; the interactive loop lands in Phase 1.
- Pinned to dsh `>=0.2.1-rc.2 <0.3.0` via `engines.dsh` (dsh is a developer preview; breaking changes are expected between minor lines).
