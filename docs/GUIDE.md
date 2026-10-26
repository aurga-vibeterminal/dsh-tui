# dsh-tui — User Guide

An opencode-style fullscreen terminal console for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). This guide covers launching, keys, commands, and troubleshooting.

- [Install & launch](#install--launch)
- [Keyboard reference](#keyboard-reference)
- [Commands](#commands)
- [File references in prompts](#file-references-in-prompts)
- [Working with todos](#working-with-todos)
- [Permissions & approvals](#permissions--approvals)
- [Themes](#themes)
- [Exporting transcripts](#exporting-transcripts)
- [Troubleshooting](#troubleshooting)

## Install & launch

`@vterminal/dsh-tui` is **not yet on npm** — install from a local checkout or a git URL:

```sh
dsh plugin --profile tui add D:\path\to\dsh-tui   # local path
dsh plugin --profile tui add github:<org>/dsh-tui # git source
dsh tui                                            # shorthand for dsh --profile tui
dsh tui --resume session-xxxx                      # continue a stored session
dsh tui --model deepseek-account/deepseek-v4-flash # explicit model route
```

The profile composes `dsh-base` plus the TUI bundle; sessions are stored per working directory under your Harness home (`~/.dsh` by default).

## Keyboard reference

| Key | Action |
|---|---|
| `Enter` | Send (queues into the next turn while the agent runs) |
| `Alt+Enter` | **Steer** — submit as next-step input for the running turn |
| `Shift+Enter` / `Ctrl+Enter` | New line |
| `↑` / `↓` | Input history (empty editor) / cursor movement |
| `Esc` | Interrupt the running turn |
| `PgUp` / `PgDn` | Scroll the transcript one page |
| `Ctrl+Home` / `Ctrl+End` | Jump to the top / bottom of the transcript |
| `Ctrl+Up` / `Ctrl+Down` | Jump to the previous / next user prompt |
| Mouse wheel | Scroll the transcript |
| `Ctrl+C` | Interrupt; press twice to quit |
| `Ctrl+Q` | Quit (restores the screen and prints the transcript into scrollback) |
| `Ctrl+O` | Toggle the newest tool card's detail view (diff / file read / terminal output / search list) |
| `Ctrl+L` | Full repaint (erases stray output written to the console by child processes) |
| `Ctrl+Shift+F` | Search the transcript viewport (built into the scroll region) |
| `Tab` | Force path completion at the cursor |
| `/` | Slash commands (autocomplete; Enter completes and runs) |
| `@` | Fuzzy file search (see below) |

## Commands

TUI-local commands (always available):

| Command | Action |
|---|---|
| `/permission` | Permission-preset picker (`workspace-write`, `read-only`, `danger-full-access`) |
| `/session` | List this directory's stored sessions; pick one to switch to (alias `/resume`) |
| `/fork` | Fork the current session and switch onto the branch |
| `/model` | Provider / model / reasoning-effort picker (hot-switch, applies to the next step) |
| `/cwd [path]` | Show or change the session working directory |
| `/inbox` | View and remove queued or steering input |
| `/todo` | Show the agent's current todo list |
| `/expand` | Toggle all tool detail cards |
| `/theme [name]` | Color theme picker (`dark`, `light`) |
| `/language [code]` | UI language picker — **English / 中文**（默认跟随系统语言；运行时即时切换） |
| `/export [path]` | Export the transcript as Markdown |
| `/events` | Raw session-event inspector |
| `/clear` | Clear the transcript view (history intact) |
| `/exit`, `/quit` | Quit (same as `Ctrl+Q`) |

Commands registered by the runtime profile (e.g. from plugins) are dispatched through the same slash pipeline, so anything dsh registers is available too.

## File references in prompts

- `@query` — fuzzy file search. **Type a space before `@`** (CJK characters are not word boundaries in the editor's trigger rules): `打开 @PLAN` works, `打开@PLAN` does not. `@` also works at line start or after CJK punctuation.
- `Tab` — force path completion anywhere in the line (`./`, `../`, `~/`, absolute, or a bare name).
- `@"path with spaces.md"` — quoted form.
- Search is backed by the `fd` binary when installed (`scoop install fd` / `apt install fd-find`), otherwise a bounded project walk that skips `node_modules`, `.git`, and build output.

## Working with todos

Todos are **authored by the agent** through its `todo_write` tool — the TUI renders them:

1. Ask for tracked work, e.g.:
   - `Refactor the config loader into three steps and track progress with todos`
   - `帮我分三步完成这个任务，用 todo 跟踪进度`
2. Each time the model updates the list, the transcript shows `· todos 2/5 done (/todo)`.
3. Run `/todo` to open the current list: `☑` completed (dim), `◐` in progress (accent), `☐` pending.

There is no user-side todo editing; ask the agent to add, reorder, or complete items.

## Permissions & approvals

- When a tool call needs approval, a bar appears: `y`/`Enter` allow once, `n`/`Esc` reject, `Ctrl+C` cancel.
- To stop being asked, switch presets:
  - `/permission` → picker, or
  - `/permission danger-full-access` → full access, never ask; `/permission workspace-write` → default (writes confined to the workspace, ask each time).
- The current preset is shown in the header bar.

## Themes

`/theme` opens the picker; `/theme light` switches directly. The change re-skins every surface live (transcript, editor border, header, dialogs). The choice lasts for the run; persisted theme files arrive with the Phase 4 config work.

## Exporting transcripts

`/export` writes `dsh-tui-<session>.md` into the working directory (or `/export D:\notes\today.md`). The export contains the header metadata, user/assistant turns (reasoning collapsed into `<details>`), tool calls with their result digests, and notices.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Stray log text on screen (browsers, GUI apps write to the console) | `Ctrl+L` full repaint |
| `no API key for provider route "deepseek-official"` | Use the account route (`/model`, pick `deepseek-account/...`) or store an API key (`DEEPSEEK_API_KEY`, or the web UI's Models page) |
| `@` file search shows nothing | Put a space before `@`; if files still miss, install `fd` |
| Mouse wheel behaves like ↑/↓ (input history) | Your terminal does not implement SGR mouse reporting (DEC modes 1000/1002/1006); it falls back to sending arrow keys. Use `PgUp`/`PgDn` or a terminal with mouse support |
| Something looks frozen | `Ctrl+L`; check the debug log (`DSH_TUI_LOG=path`) |
| Need raw protocol evidence | `/events` |
