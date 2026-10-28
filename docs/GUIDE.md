# Vibe Terminal — User Guide

**Vibe Terminal** is a fullscreen agent console for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). This guide covers launching, keys, commands, and troubleshooting.

- [Install & launch](#install--launch)
- [Sessions](#sessions)
- [Keyboard reference](#keyboard-reference)
- [Commands](#commands)
- [File references in prompts](#file-references-in-prompts)
- [Working with todos](#working-with-todos)
- [Permissions & approvals](#permissions--approvals)
- [Themes](#themes)
- [Persisted settings](#persisted-settings)
- [Exporting transcripts](#exporting-transcripts)
- [Plugins & the web UI](#plugins--the-web-ui)
- [Troubleshooting](#troubleshooting)

## Install & launch

`@vterminal/dsh-tui` is **not yet on npm** — install from a local checkout or a git URL:

```sh
dsh plugin --profile tui add D:\path\to\dsh-tui   # local path
dsh plugin --profile tui add github:<org>/dsh-tui # git source
dsh tui                                            # shorthand for dsh --profile tui
dsh tui -r                                         # open the session picker at startup
dsh tui -r session-xxxx                            # continue a stored session (alias --resume)
dsh tui --preset ptc                               # agent mode: standard (default) | ptc | minimal | cordis
dsh tui --model deepseek-account/deepseek-v4-flash # explicit model route
```

The profile composes `dsh-base` plus the TUI bundle; sessions are stored per working directory under your Harness home (`~/.dsh` by default).

## Sessions

- A session is created **only when you send the first message** — quitting without typing leaves nothing behind.
- `/session` lists this directory's stored sessions (newest first) in a scrollable picker; pick one to switch (history replays). Hidden from the list: subagent child sessions, **archived** sessions (archive state is shared with the web UI), and **blank** sessions that never started a turn.
- `/fork` branches the current session and switches onto the copy.
- In the dsh **web** UI these sessions may appear under "ungrouped": the web groups sessions by *workspace attachment*, a web-profile concept this TUI does not compose.

## Keyboard reference

| Key | Action |
|---|---|
| `Enter` | Send (queues into the next turn while the agent runs) |
| `Alt+S` | **Steer** — submit as next-step input for the running turn |
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
| `/new` | Start a fresh session (the old one stays in `/session`) |
| `/fork` | Fork the current session and switch onto the branch |
| `/model` | Provider / model / reasoning-effort picker (hot-switch, applies to the next step) |
| `/preset [id]` | Show or set the agent preset mode — `standard` / `ptc` / `minimal` / `cordis` (applies to the next session; same modes as the web UI) |
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

`@` autocompletes paths; image file paths (`.png` `.jpg` `.jpeg` `.webp` `.gif`, quoted or bare) that exist on disk are **admitted as real image attachments** through the same pipeline the web upload flow uses — the model sees the pixels, not just the path. Sending is blocked up front when the current model declares no image input (`/model` → `deepseek-flash` supports vision); the notice explains, and the unsent text is recoverable with the up-arrow history. Nonexistent paths fall back to plain text.

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

`/theme` opens the picker; `/theme light` switches directly. The change re-skins every surface live (transcript, editor border, header, dialogs).

## Persisted settings

`/preset`, `/theme`, `/language`, and `/model` write their choice to `$DSH_HOME/tui/settings.json` (default `~/.dsh/tui/settings.json`), so the preset mode, theme, language, and default model route survive restarts. Startup precedence is **CLI flag > saved setting > default** — `--preset ptc` overrides the saved preset for that run without rewriting it, and a missing or corrupt settings file is silently ignored (it is rewritten on the next change). A failed save only downgrades persistence for the current run and shows a notice; nothing else is affected. The saved model applies to newly created sessions (`/new`, restarts); switching mid-session still applies hot to the next step.

## Exporting transcripts

`/export` writes `dsh-tui-<session>.md` into the working directory (or `/export D:\notes\today.md`). The export contains the header metadata, user/assistant turns (reasoning collapsed into `<details>`), tool calls with their result digests, and notices.

## Plugins & the web UI

**Are the web UI's plugins available here?** In two layers:

- **Everything in `dsh-base` is shared** — tools, the registry slash commands (`/compact`, `/goal`, `/plan`, `/feedback`, `/permission`), permission presets, approvals, subagents, compaction, the attachment service. They work in the TUI automatically, with no command or setup.
- **Plugins installed into a specific profile are not shared.** Each profile (`web`, `tui`, `desktop`) is its own isolated pnpm workspace under `$DSH_HOME/profiles/<name>/`; a bundle installed into the web profile is invisible to the TUI profile, and vice versa.

**Installing plugins in the TUI.** `dsh-base` ships a plugin-management tool the agent can call, so just ask in the conversation — "list this profile's plugins", "install <bundle>" (it requires Full access or per-call approval). The TUI profile disables HMR (a fullscreen app must not observe composition changes), so it is startup-only: **restart `dsh tui` after installing** for the change to take effect. Once installed, a plugin's tools render as tool cards, its slash commands appear in `/` completion, and its approval requests open the standard dialogs — no TUI-specific adaptation needed.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Stray log text on screen (browsers, GUI apps write to the console) | `Ctrl+L` full repaint |
| `no API key for provider route "deepseek-official"` | Use the account route (`/model`, pick `deepseek-account/...`) or store an API key (`DEEPSEEK_API_KEY`, or the web UI's Models page) |
| `@` file search shows nothing | Put a space before `@`; if files still miss, install `fd` |
| Mouse wheel behaves like ↑/↓ (input history) | Your terminal does not implement SGR mouse reporting (DEC modes 1000/1002/1006); it falls back to sending arrow keys. Use `PgUp`/`PgDn` or a terminal with mouse support |
| Something looks frozen | `Ctrl+L`; check the debug log (`DSH_TUI_LOG=path`) |
| Need raw protocol evidence | `/events` |
