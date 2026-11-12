import process$1 from "node:process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { brandString } from "@deepseek-ai/dsh-brand";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { MessageId, ReasoningEffortId, createUserMessage } from "@deepseek-ai/dsh-llm";
import { CombinedAutocompleteProvider, Editor, Key, Markdown, ProcessTerminal, ScrollView, SelectList, Text, TuiAltScreen, VStack, fuzzyFilter, fuzzyMatch, isViewportTUI, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { SessionSeq } from "@deepseek-ai/dsh-session";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { format } from "node:util";
//#region src/i18n.ts
/**
* dsh-tui internationalization.
*
* - Default locale follows the system (Intl-resolved), falling back to English
*   when the detected language has no message table yet.
* - `/language` switches at runtime (per-run, like `/theme`).
* - New languages: add a message table below and list its code in AVAILABLE —
*   detection and the picker pick it up automatically. Keys are stable ids;
*   `{param}` placeholders interpolate.
*
* Currently shipped: English (`en`). Reserved: Chinese (`zh`), Japanese (`ja`).
* @module dsh-tui/i18n
*/
/** Locale codes with shipped message tables. */
const AVAILABLE = ["en", "zh"];
/** All locale codes the UI knows about, including reserved (untranslated) ones. */
const KNOWN = [
	"en",
	"zh",
	"ja"
];
const en = {
	"welcome.version": "v{version}",
	"welcome.title": "DeepSeek Harness TUI",
	"welcome.subtitle": "Developed by Vibe Terminal",
	"welcome.line": "model {route} · type / for commands · ctrl+q quit",
	"welcome.contact": "development & feedback: dev@vterminal.dev",
	"header.newSession": "new session",
	"header.tokens": " tok",
	"hint.idle": "enter send · alt+s steer · / commands · ctrl+q quit",
	"hint.running": "enter queue · alt+s steer · esc interrupt · ctrl+q quit",
	"hint.background": "enter send · background agents still running · ctrl+q quits them too",
	"transcript.thinking": "thinking… ",
	"transcript.pending": "…",
	"transcript.attemptDiscarded": "· attempt discarded",
	"transcript.turnEnd": "· turn {reason}",
	"transcript.turnError": "· turn error: {message}",
	"transcript.uiError": "· ui error ({label}): {message}",
	"transcript.expandHint": " · ctrl+o",
	"card.linesCount": " ({shown}/{total} lines)",
	"card.exit": "  exit {code}",
	"card.signal": "  signal {signal}",
	"card.pathsCount": "  {count} path(s){capped}",
	"card.matchesCount": "  {count} match(es){capped}",
	"card.capped": " of {total} (capped)",
	"notice.todos": "· todos {done}/{total} done (/todo)",
	"notice.compacting": "· compacting context…",
	"notice.compacted": "· context compacted",
	"notice.compactQueued": "· /compact queued — runs when the current turn ends",
	"notice.compactAlreadyQueued": "· compaction already queued",
	"notice.compactQueueFailed": "· queued compaction failed: {message}",
	"notice.contextPressure": "· context at ~{percent}% of the window — /compact to shrink it",
	"notice.cwdChange": "· cwd → {cwd}",
	"notice.modelChange": "· model → {model}",
	"notice.permissionChange": "· permission → {preset}",
	"notice.subagentStarted": "· subagent started ({provider})",
	"notice.subagentFinished": "· subagent finished ({reason}){preview}",
	"approval.title": "⚠ approve {tool}",
	"approval.hint": "  y allow once · n or esc reject · ctrl+c cancel",
	"question.hintMulti": "  space toggle · enter submit{nav} · esc cancel",
	"question.hintSingle": "  enter select{nav} · esc cancel",
	"question.nav": " · tab question {index}/{total}",
	"events.title": "raw events (last {shown} of {total})",
	"dialog.closeHint": " esc close",
	"scroll.jumpToEnd": " ↓ latest ",
	"notice.queueAgain": "· press ctrl+c again to quit",
	"notice.queued": "(queued: {text})",
	"notice.steering": "(steering: {text})",
	"notice.imageAttached": "· 🖼 attached {name} ({width}×{height})",
	"notice.imageMissing": "· image not found: {path}",
	"notice.imageAdmitFailed": "· image {path} rejected: {message}",
	"notice.modelNotVision": "· {model} does not read images — switch with /model (vision: {models}) or remove the image; the text was not sent (up-arrow recovers it)",
	"notice.modelNotVisionNone": "none declared in the catalog",
	"model.visionTag": "multimodal",
	"dialog.thinkingTitle": "Thinking level (current: {effort})",
	"notice.thinkingChange": "· thinking → {effort} (applies to the next step)",
	"notice.thinkingStays": "· thinking stays {effort}",
	"notice.thinkingCancelled": "· thinking picker cancelled",
	"notice.thinkingUnsupported": "· {model} declares no reasoning levels",
	"notice.thinkingSingle": "· {model} offers one level: {effort}",
	"notice.thinkingInvalid": "· unknown level {effort} (off | low | high | max)",
	"dialog.mcpTitle": "MCP servers",
	"dialog.mcpDetailTitle": "MCP · {server}",
	"dialog.mcpServerCount": "{count} tools",
	"dialog.mcpConnected": "connected",
	"notice.mcpNone": "· no MCP servers connected — add @deepseek-ai/dsh-mcp-client rows to the profile patch (see the guide)",
	"notice.mcpUnavailable": "· tools service unavailable",
	"notice.reloadStarted": "· reloading profile composition…",
	"notice.reloadApplied": "· profile reloaded — changes applied in place",
	"notice.reloadRestart": "· reload finished but a restart is still required: {reason}",
	"notice.reloadPending": "· reload applied; {count} module change(s) still need a restart",
	"notice.reloadFailed": "· reload failed: {message}",
	"notice.reloadUnavailable": "· HMR is unavailable in this profile — restart dsh tui to apply changes",
	"dialog.skillTitle": "Skills",
	"dialog.skillDetailTitle": "Skill · {name}",
	"skill.source": "source",
	"skill.path": "path",
	"skill.whenToUse": "when to use",
	"skill.body": "body",
	"skill.usage": "use",
	"skill.taskPlaceholder": "your task",
	"notice.skillNone": "· no skills discovered (project .agents/skills or ~/.agents/skills)",
	"notice.skillUnavailable": "· skills service unavailable",
	"notice.skillUnknown": "· unknown skill {name}",
	"notice.skillListFailed": "· skill discovery failed: {message}",
	"notice.approved": "· approved {tool}",
	"notice.rejected": "· rejected {tool}",
	"notice.approvalCancelled": "· approval cancelled ({tool})",
	"notice.answered": "· answered {count} question(s)",
	"notice.questionsCancelled": "· questions cancelled",
	"notice.viewCleared": "· view cleared (session history intact)",
	"notice.noCommandRegistry": "· no command registry composed",
	"notice.unknownCommand": "· unknown command {command}",
	"notice.commandFailed": "· command failed: {message}",
	"notice.sendFailed": "· send failed: {message}",
	"notice.nothingToCopy": "· nothing to copy yet",
	"notice.copyCount": "· /copy: only {count} assistant message(s)",
	"notice.copied": "· copied {count} chars ({preview}…)",
	"notice.exported": "· exported {count} bytes → {path}",
	"notice.exportFailed": "· export failed: {message}",
	"notice.noTodos": "· no todos recorded",
	"notice.themeStays": "· theme stays {name}",
	"notice.themeChanged": "· theme → {name}",
	"notice.themeCancelled": "· theme picker cancelled",
	"notice.langChanged": "· language → {name}",
	"notice.langStays": "· language stays {name}",
	"notice.langCancelled": "· language picker cancelled",
	"notice.langUnavailable": "· language {name} is reserved but not translated yet; using {fallback}",
	"dialog.themeTitle": "Theme",
	"dialog.presetTitle": "Agent preset",
	"notice.presetStays": "· preset stays {preset}",
	"notice.presetChange": "· preset → {preset} (applies to the next session — /new)",
	"notice.settingsSaveFailed": "· settings save failed (changes apply to this session only)",
	"dialog.languageTitle": "Language",
	"dialog.reservedHint": "reserved · English fallback",
	"dialog.modelTitle": "Model (current: {route})",
	"dialog.effortTitle": "Reasoning effort for {model}",
	"dialog.effortCancelled": "· effort picker cancelled; keeping the default",
	"dialog.sessionTitle": "Switch to session ({workspace})",
	"dialog.permissionTitle": "Permission preset (current: {preset})",
	"permission.readOnly": "Read Only",
	"permission.workspaceWrite": "Workspace Write",
	"permission.fullAccess": "Full access",
	"permission.auto": "Auto review",
	"dialog.inboxTitle": "Remove pending input",
	"notice.modelCancelled": "· model picker cancelled",
	"notice.modelSwitchFailed": "· model switch failed: {message}",
	"notice.permissionStays": "· permission stays {name}",
	"notice.permissionCatalogFailed": "· permission catalog failed: {message}",
	"notice.permissionCancelled": "· preset picker cancelled",
	"notice.inboxEmpty": "· inbox empty",
	"notice.inboxCancelled": "· inbox picker cancelled",
	"notice.removed": "· removed {text}",
	"notice.removeFailed": "· remove failed (already claimed?)",
	"notice.sessionEmpty": "· no stored sessions in {cwd}",
	"notice.sessionCancelled": "· session picker cancelled",
	"notice.sessionStays": "· staying on the current session",
	"notice.sessionSwitched": "· switched to session {id}",
	"notice.resumeFailed": "· resume failed; started a fresh session ({message})",
	"notice.forkFailed": "· fork failed: {message}",
	"notice.interruptFirst": "· interrupt the running turn first (esc)",
	"notice.cwdNow": "· cwd {cwd}",
	"notice.cwdChangeFailed": "· cwd change failed: {message}",
	"notice.llmUnavailable": "· llm service unavailable",
	"notice.noModels": "· no models advertised",
	"notice.catalogFailed": "· model catalog failed: {message}",
	"notice.modelChangedNotice": "· model → {route}{effort}",
	"notice.needFirstMessage": "· send your first message to start the session",
	"notice.alreadyFresh": "· already in a fresh session (nothing to discard)",
	"notice.newSessionStarted": "· new session started — the previous one remains in /session",
	"notice.agentError": "· error: {message}",
	"notice.permissionServiceUnavailable": "· permission-presets service unavailable"
};
const tables = {
	en,
	zh: {
		"welcome.version": "v{version}",
		"welcome.title": "DeepSeek Harness TUI",
		"welcome.subtitle": "Developed by Vibe Terminal",
		"welcome.line": "模型 {route} · 输入 / 查看命令 · ctrl+q 退出",
		"welcome.contact": "开发与反馈：dev@vterminal.dev",
		"header.newSession": "新会话",
		"header.tokens": " tokens",
		"hint.idle": "enter 发送 · alt+s 转向 · / 命令 · ctrl+q 退出",
		"hint.running": "enter 排队 · alt+s 转向 · esc 中断 · ctrl+q 退出",
		"hint.background": "enter 发送 · 后台代理仍在运行 · ctrl+q 一并退出",
		"transcript.thinking": "思考中… ",
		"transcript.pending": "…",
		"transcript.attemptDiscarded": "· 本次尝试已丢弃",
		"transcript.turnEnd": "· 回合结束（{reason}）",
		"transcript.turnError": "· 回合出错：{message}",
		"transcript.uiError": "· 界面错误（{label}）：{message}",
		"transcript.expandHint": " · ctrl+o",
		"card.linesCount": "（{shown}/{total} 行）",
		"card.exit": "  退出码 {code}",
		"card.signal": "  信号 {signal}",
		"card.pathsCount": "  {count} 个路径{capped}",
		"card.matchesCount": "  {count} 处匹配{capped}",
		"card.capped": " / 共 {total}（已截断）",
		"notice.todos": "· 任务 {done}/{total} 已完成（/todo）",
		"notice.compacting": "· 正在压缩上下文…",
		"notice.compacted": "· 上下文已压缩",
		"notice.compactQueued": "· /compact 已排队 — 本回合结束后执行",
		"notice.compactAlreadyQueued": "· 压缩已在排队中",
		"notice.compactQueueFailed": "· 排队的压缩失败:{message}",
		"notice.contextPressure": "· 上下文已用约 {percent}% — 可用 /compact 压缩",
		"notice.cwdChange": "· 工作目录 → {cwd}",
		"notice.modelChange": "· 模型 → {model}",
		"notice.permissionChange": "· 权限预设 → {preset}",
		"notice.subagentStarted": "· 子代理已启动（{provider}）",
		"notice.subagentFinished": "· 子代理已结束（{reason}）{preview}",
		"approval.title": "⚠ 批准 {tool}",
		"approval.hint": "  y 允许一次 · n 或 esc 拒绝 · ctrl+c 取消",
		"question.hintMulti": "  space 切换 · enter 提交{nav} · esc 取消",
		"question.hintSingle": "  enter 选择{nav} · esc 取消",
		"question.nav": " · tab 第 {index}/{total} 题",
		"events.title": "原始事件（最近 {shown}/{total} 条）",
		"dialog.closeHint": " esc 关闭",
		"scroll.jumpToEnd": " ↓ 最新 ",
		"notice.queueAgain": "· 再按一次 ctrl+c 退出",
		"notice.queued": "（已排队：{text}）",
		"notice.steering": "（转向：{text}）",
		"notice.imageAttached": "· 🖼 已附图 {name}（{width}×{height}）",
		"notice.imageMissing": "· 图片不存在：{path}",
		"notice.imageAdmitFailed": "· 图片 {path} 准入被拒：{message}",
		"notice.modelNotVision": "· 当前模型 {model} 不支持图片输入 —— /model 切换到视觉模型（支持视觉：{models}），或去掉图片；消息未发送（上箭头可找回）",
		"notice.modelNotVisionNone": "目录中未声明任何视觉模型",
		"model.visionTag": "多模态",
		"dialog.thinkingTitle": "思维档位（当前：{effort}）",
		"notice.thinkingChange": "· 思维档位 → {effort}（下一步生效）",
		"notice.thinkingStays": "· 思维档位保持 {effort}",
		"notice.thinkingCancelled": "· 已取消思维档位选择",
		"notice.thinkingUnsupported": "· {model} 未声明思维档位",
		"notice.thinkingSingle": "· {model} 只有一档：{effort}",
		"notice.thinkingInvalid": "· 未知档位 {effort}（off | low | high | max）",
		"dialog.mcpTitle": "MCP 服务器",
		"dialog.mcpDetailTitle": "MCP · {server}",
		"dialog.mcpServerCount": "{count} 个工具",
		"dialog.mcpConnected": "已连接",
		"notice.mcpNone": "· 没有已连接的 MCP 服务器 —— 在 profile patch 中添加 @deepseek-ai/dsh-mcp-client 行（见指南）",
		"notice.mcpUnavailable": "· tools 服务不可用",
		"notice.reloadStarted": "· 正在重载 profile 组合…",
		"notice.reloadApplied": "· profile 已重载 —— 变更已就地生效",
		"notice.reloadRestart": "· 重载完成但仍需重启：{reason}",
		"notice.reloadPending": "· 已重载；{count} 处模块变更仍需重启生效",
		"notice.reloadFailed": "· 重载失败：{message}",
		"notice.reloadUnavailable": "· 本 profile 未启用 HMR —— 重启 dsh tui 以应用变更",
		"dialog.skillTitle": "技能",
		"dialog.skillDetailTitle": "技能 · {name}",
		"skill.source": "来源",
		"skill.path": "路径",
		"skill.whenToUse": "适用场景",
		"skill.body": "正文",
		"skill.usage": "使用方式",
		"skill.taskPlaceholder": "你的任务",
		"notice.skillNone": "· 未发现技能（项目 .agents/skills 或 ~/.agents/skills）",
		"notice.skillUnavailable": "· skills 服务不可用",
		"notice.skillUnknown": "· 未知技能 {name}",
		"notice.skillListFailed": "· 技能发现失败：{message}",
		"notice.approved": "· 已批准 {tool}",
		"notice.rejected": "· 已拒绝 {tool}",
		"notice.approvalCancelled": "· 审批已取消（{tool}）",
		"notice.answered": "· 已回答 {count} 个问题",
		"notice.questionsCancelled": "· 问题已取消",
		"notice.viewCleared": "· 视图已清空（会话历史保留）",
		"notice.noCommandRegistry": "· 未挂载命令注册表",
		"notice.unknownCommand": "· 未知命令 {command}",
		"notice.commandFailed": "· 命令失败：{message}",
		"notice.sendFailed": "· 发送失败：{message}",
		"notice.nothingToCopy": "· 暂无可复制内容",
		"notice.copyCount": "· /copy：只有 {count} 条助手消息",
		"notice.copied": "· 已复制 {count} 字符（{preview}…）",
		"notice.exported": "· 已导出 {count} 字节 → {path}",
		"notice.exportFailed": "· 导出失败：{message}",
		"notice.noTodos": "· 尚无任务记录",
		"notice.themeStays": "· 主题保持 {name}",
		"notice.themeChanged": "· 主题 → {name}",
		"notice.themeCancelled": "· 已取消主题选择",
		"notice.langChanged": "· 语言 → {name}",
		"notice.langStays": "· 语言保持 {name}",
		"notice.langCancelled": "· 已取消语言选择",
		"notice.langUnavailable": "· 语言 {name} 尚未翻译，暂用 {fallback}",
		"dialog.themeTitle": "主题",
		"dialog.languageTitle": "语言",
		"dialog.reservedHint": "预留 · 回退英文",
		"dialog.presetTitle": "智能体预设",
		"notice.presetStays": "· 预设保持 {preset}",
		"notice.presetChange": "· 预设 → {preset}（对下一个会话生效 —— /new）",
		"notice.settingsSaveFailed": "· 设置保存失败（改动仅本次会话生效）",
		"dialog.modelTitle": "模型（当前：{route}）",
		"dialog.effortTitle": "{model} 的推理力度",
		"dialog.effortCancelled": "· 已取消力度选择，保留默认",
		"dialog.sessionTitle": "切换会话（{workspace}）",
		"dialog.permissionTitle": "权限预设（当前：{preset}）",
		"permission.readOnly": "仅可查看",
		"permission.workspaceWrite": "工作区内修改",
		"permission.fullAccess": "完全权限",
		"permission.auto": "自动审查",
		"dialog.inboxTitle": "移除待处理输入",
		"notice.modelCancelled": "· 已取消模型选择",
		"notice.modelSwitchFailed": "· 模型切换失败：{message}",
		"notice.permissionStays": "· 权限保持 {name}",
		"notice.permissionCatalogFailed": "· 权限目录获取失败：{message}",
		"notice.permissionCancelled": "· 已取消预设选择",
		"notice.inboxEmpty": "· 收件箱为空",
		"notice.inboxCancelled": "· 已取消收件箱选择",
		"notice.removed": "· 已移除 {text}",
		"notice.removeFailed": "· 移除失败（可能已被处理）",
		"notice.sessionEmpty": "· {cwd} 下暂无历史会话",
		"notice.sessionCancelled": "· 已取消会话选择",
		"notice.sessionStays": "· 保持当前会话",
		"notice.sessionSwitched": "· 已切换到会话 {id}",
		"notice.resumeFailed": "· 恢复失败；已开启新会话（{message}）",
		"notice.forkFailed": "· 分叉失败：{message}",
		"notice.interruptFirst": "· 请先中断当前回合（esc）",
		"notice.cwdNow": "· 工作目录 {cwd}",
		"notice.cwdChangeFailed": "· 目录切换失败：{message}",
		"notice.llmUnavailable": "· llm 服务不可用",
		"notice.noModels": "· 未发现可用模型",
		"notice.catalogFailed": "· 模型目录获取失败：{message}",
		"notice.modelChangedNotice": "· 模型 → {route}{effort}",
		"notice.needFirstMessage": "· 发送第一条消息以创建会话",
		"notice.alreadyFresh": "· 已经是新会话（无需丢弃）",
		"notice.newSessionStarted": "· 已开启新会话 —— 之前的会话仍保留在 /session 中",
		"notice.agentError": "· error: {message}",
		"notice.permissionServiceUnavailable": "· 权限预设服务不可用"
	}
};
let current = "en";
/** Translate one key with `{param}` interpolation in the active locale. */
function t(key, params) {
	const template = (tables[current] ?? en)[key] ?? en[key] ?? key;
	if (params === void 0) return template;
	return template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}
/** The active locale. */
function locale() {
	return current;
}
/** Switch the active locale; unknown codes keep the current one. */
function setLocale(next) {
	if (AVAILABLE.includes(next)) {
		current = next;
		return true;
	}
	return false;
}
/** Selectable entries for the /language picker: every known locale, flagged. */
function knownLocales() {
	return KNOWN.map((id) => ({
		id,
		label: LOCALE_LABELS[id] ?? id,
		available: AVAILABLE.includes(id)
	}));
}
/** Selectable entries for the /language picker. */
function availableLocales() {
	return AVAILABLE.map((id) => ({
		id,
		label: LOCALE_LABELS[id] ?? id
	}));
}
const LOCALE_LABELS = {
	en: "English",
	zh: "中文",
	ja: "日本語 (reserved)"
};
/**
* Resolve the system locale to a shipped one: detected codes map to their
* primary language (`zh-CN` → `zh`), and anything without a message table
* falls back to English.
*/
function resolveSystemLocale() {
	const primary = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().split("-")[0] ?? "en";
	if (AVAILABLE.includes(primary)) return primary;
	return "en";
}
/** Initialize the default locale from the system (once at boot). */
function initSystemLocale() {
	current = resolveSystemLocale();
	return current;
}
/** i18n keys carrying the web-parity label per well-known permission value. */
const PERMISSION_LABEL_KEYS = {
	"read-only": "permission.readOnly",
	"workspace-write": "permission.workspaceWrite",
	"danger-full-access": "permission.fullAccess",
	auto: "permission.auto"
};
/**
* Display name for a permission preset value, matching the web client's
* labels ("Read Only" / "Workspace Write" / "Full access" / "Auto review",
* localized). Unknown or profile-configured custom values fall back to the
* catalog-provided name (or the raw value).
*/
function permissionDisplayName(value, fallback = value) {
	const key = PERMISSION_LABEL_KEYS[value];
	return key === void 0 ? fallback : t(key);
}
//#endregion
//#region src/agent-driver.ts
/**
* The agent driver: owns the single Agent the TUI drives and feeds the
* {@link TranscriptModel} from the runtime's live surfaces. Mirrors the
* recorder/headless drive loop (create or resume → subscribe → followup →
* whenIdle) but stays resident for the interactive session.
*
* **Lazy sessions**: with `lazy: true` (and no `--resume`), no Agent/Session
* is created at boot — only the first submitted message materializes one, so
* quitting without typing leaves no empty session behind. A model switch made
* before the first message is applied at creation time.
* @module dsh-tui/agent-driver
*/
/**
* Combine the busy sources into the aggregate. Pure and exported so the
* surprising cases (settled parent with live children, maintenance compaction,
* an in-flight request) are testable without a cordis context. The individual
* counts travel along: a client that is told `busy` can ask *why*.
*/
function aggregateStatus(flags) {
	return {
		running: flags.running,
		busy: flags.running || flags.maintenance || flags.attempts > 0 || flags.subagents > 0,
		blocked: flags.blocked,
		maintenance: flags.maintenance,
		attempts: flags.attempts,
		subagents: flags.subagents
	};
}
/**
* Builds the fold's {@link ToolPresenter} over the live tool registry. Both
* present methods are pure functions of (args, durable result), so views are
* identical live and on replay.
*/
function createToolPresenter(ctx) {
	return {
		callView(name, rawArgs) {
			try {
				const tool = ctx.get("tools")?.get(name);
				if (tool?.presentCall === void 0) return void 0;
				return tool.presentCall(JSON.parse(rawArgs));
			} catch {
				return;
			}
		},
		resultView(name, rawArgs, result) {
			try {
				const tool = ctx.get("tools")?.get(name);
				if (tool?.presentResult === void 0) return void 0;
				return tool.presentResult(JSON.parse(rawArgs), result);
			} catch {
				return;
			}
		}
	};
}
/**
* Create the driver. With `lazy: true` (and no resume id) no Agent/Session is
* created until the first `send()`; `resume` always materializes immediately
* (the user explicitly chose a session, and its history replays).
*/
async function createDriver(ctx, model, options) {
	await ctx.get("loader")?.await();
	const agents = ctx.get("agents");
	const defaultModel = ctx.get("agentDefaultModel");
	const sessions = ctx.get("sessions");
	if (agents === void 0 || defaultModel === void 0 || sessions === void 0) throw new Error("tui: core services (agents, agentDefaultModel, sessions) are unavailable");
	const profileSelection = defaultModel.currentSelection();
	let selection = {
		provider: profileSelection.provider,
		model: profileSelection.model,
		reasoningEffort: profileSelection.reasoningEffort
	};
	if (options.model !== void 0) selection = {
		...selection,
		...options.model
	};
	const agentOptions = () => ({
		provider: selection.provider,
		model: selection.model
	});
	const fs = ctx.get("fs");
	const cwd = fs === void 0 ? process$1.cwd() : fs.processPath(await fs.resolve("."));
	let driverPreset = options.preset;
	const statusListeners = [];
	let selectionRef;
	let handle;
	let agent;
	let running = false;
	/** Compaction and other maintenance work: runs while public status is `idle`. */
	let maintenance = false;
	/** Open LLM attempt ids — the only in-flight request signal outside the driver. */
	const openAttempts = /* @__PURE__ */ new Set();
	/** Live subagent activations, keyed by the `subagent/start`/`end` run id. */
	const liveSubagents = /* @__PURE__ */ new Set();
	/** Child session id → its live run ids; keys the orphan cleanup below. */
	const childRuns = /* @__PURE__ */ new Map();
	let blocked;
	let lastStatus = aggregateStatus({
		running: false,
		maintenance: false,
		attempts: 0,
		subagents: 0,
		blocked: void 0
	});
	let reaping = false;
	/** Recompute the aggregate and notify listeners on any change, including a
	*  count change that leaves `busy` set (a second subagent joining): the
	*  snapshot is public, so it must never go stale. Wire-level dedup belongs to
	*  the reporter, which would otherwise re-emit an identical escape. */
	const publishStatus = () => {
		const next = aggregateStatus({
			running,
			maintenance,
			attempts: openAttempts.size,
			subagents: liveSubagents.size,
			blocked
		});
		if (next.running === lastStatus.running && next.busy === lastStatus.busy && next.blocked === lastStatus.blocked && next.maintenance === lastStatus.maintenance && next.attempts === lastStatus.attempts && next.subagents === lastStatus.subagents) return;
		lastStatus = next;
		for (const callback of [...statusListeners]) callback(next);
	};
	/**
	* Reap the optimistic flags once the agent reaches true quiescence.
	* `whenIdle()` waits for the driver *and* maintenance tasks, so it is the
	* authoritative settle boundary; a missed `compaction/end` or stream `end`
	* frame then self-corrects instead of leaving the spinner spinning. Live
	* subagents keep their own accounting — they outlive a settled parent.
	*/
	const reapWhenSettled = (wired) => {
		if (reaping) return;
		reaping = true;
		wired.whenIdle().then(() => {
			reaping = false;
			if (agent !== wired) return;
			if (wired.status !== "idle") return;
			running = false;
			maintenance = false;
			openAttempts.clear();
			publishStatus();
		}, () => {
			reaping = false;
		});
	};
	const stoppers = [];
	const wireAgent = (wired) => {
		const safeApply = (label, action) => {
			try {
				action();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				try {
					model.pushNotice(t("transcript.uiError", {
						label,
						message: message.slice(0, 120)
					}), "error");
				} catch {}
			}
		};
		stoppers.push(ctx.on("agent/status", ({ agent: subject, status }) => {
			if (subject === wired) {
				running = status === "running";
				openAttempts.clear();
				publishStatus();
				if (running) reapWhenSettled(wired);
			}
		}), ctx.on("agent/error", ({ agent: subject, error }) => {
			if (subject === wired) {
				const message = error instanceof Error ? error.message : String(error);
				model.pushNotice(t("notice.agentError", { message: message.slice(0, 180) }), "error");
			}
		}), ctx.on("session/event", (session, event) => {
			if (session !== wired.session) return;
			const type = event.type;
			if (type === "compaction/start") {
				maintenance = true;
				reapWhenSettled(wired);
				publishStatus();
			} else if (type === "compaction/end") {
				maintenance = false;
				publishStatus();
			}
			safeApply("event", () => model.applyEvent(event));
		}), ctx.on("agent/assistant-stream", ({ agent: subject, frame }) => {
			if (subject !== wired) return;
			if (frame.type === "start") {
				openAttempts.add(String(frame.attemptId));
				reapWhenSettled(wired);
				publishStatus();
			} else if (frame.type === "end") {
				openAttempts.delete(String(frame.attemptId));
				publishStatus();
			}
			safeApply("stream", () => model.applyFrame(frame));
		}), wired.ctx.on("subagent/start", (info) => {
			const runId = String(info.runId);
			const childId = String(info.id);
			liveSubagents.add(runId);
			const runs = childRuns.get(childId) ?? /* @__PURE__ */ new Set();
			runs.add(runId);
			childRuns.set(childId, runs);
			publishStatus();
		}), wired.ctx.on("subagent/end", (info) => {
			const runId = String(info.runId);
			const childId = String(info.id);
			liveSubagents.delete(runId);
			const runs = childRuns.get(childId);
			if (runs !== void 0) {
				runs.delete(runId);
				if (runs.size === 0) childRuns.delete(childId);
			}
			publishStatus();
		}), ctx.on("agent/disposed", ({ agent: subject }) => {
			const childId = String(subject.id);
			const runs = childRuns.get(childId);
			if (runs === void 0) return;
			childRuns.delete(childId);
			for (const runId of runs) liveSubagents.delete(runId);
			publishStatus();
		}), (() => {
			const timer = setInterval(() => {
				if (agent !== wired || wired.status !== "idle") return;
				if (!running && openAttempts.size === 0) return;
				running = false;
				openAttempts.clear();
				publishStatus();
			}, 5e3);
			return () => clearInterval(timer);
		})());
	};
	/** Materialize the lazy agent (once). Resumes when a resume id was given. */
	const ensureAgent = async () => {
		if (agent !== void 0) return agent;
		agentOptions();
		const setup = (agentCtx) => {
			const selected = {
				current: {
					provider: selection.provider,
					model: selection.model,
					...selection.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) }
				},
				assembled: void 0
			};
			selectionRef = selected;
			installModelSelection(agentCtx, selected);
		};
		if (options.resume === void 0) {
			let sessionCwd = cwd;
			let workspaceAttach;
			const registry = ctx.get("workspaceRegistry");
			if (registry !== void 0) try {
				const workspace = await registry.create(cwd);
				sessionCwd = workspace.path;
				workspaceAttach = async (sessionId) => workspace.attachSession(sessionId);
			} catch {}
			const sessionId = brandString(`session-${randomUUID()}`);
			const meta = { cwd: sessionCwd };
			if (driverPreset !== void 0) meta.agentPreset = driverPreset;
			handle = await agents.create({
				sessionId,
				meta,
				agentOptions: agentOptions(),
				setup
			});
			if (workspaceAttach !== void 0) try {
				await workspaceAttach(String(handle.agent.id));
			} catch {}
		} else {
			if (ctx.get("sessionPersistence") === void 0) throw new Error("tui --resume requires the sessionPersistence service; dsh-base provides it");
			const resumeSessionId = brandString(options.resume);
			try {
				handle = await agents.resume({
					resumeSessionId,
					agentOptions: agentOptions(),
					setup
				});
			} catch (error) {
				throw new Error(`tui: cannot resume session "${options.resume}": ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		agent = handle.agent;
		wireAgent(agent);
		await agent.whenIdle();
		if (options.resume !== void 0) {
			const length = agent.session.seq;
			for (let seq = 0; seq < length; seq++) {
				const event = agent.session.eventAt(SessionSeq(seq));
				if (event !== void 0) model.applyEvent(event);
			}
		}
		return agent;
	};
	if (options.resume !== void 0) await ensureAgent();
	return {
		get agent() {
			return agent;
		},
		get session() {
			return agent?.session;
		},
		get hasAgent() {
			return agent !== void 0;
		},
		model,
		get running() {
			return running;
		},
		get busy() {
			return lastStatus.busy;
		},
		get status() {
			return lastStatus;
		},
		/** Whether an interrupt (Esc / Ctrl+C) has parent-side work to stop. */
		get interruptible() {
			return running || maintenance;
		},
		get route() {
			const current = selectionRef?.current;
			const active = current === void 0 ? selection : current;
			return {
				provider: active.provider,
				model: active.model,
				effort: active.reasoningEffort
			};
		},
		async send(input) {
			(await ensureAgent()).followup(createUserMessage({
				content: typeof input === "string" ? [{
					type: "text",
					text: input
				}] : input,
				source: { kind: "user" }
			}));
		},
		async steer(input) {
			(await ensureAgent()).steer(createUserMessage({
				content: typeof input === "string" ? [{
					type: "text",
					text: input
				}] : input,
				source: { kind: "user" }
			}));
		},
		setModel(switchTo) {
			selection = {
				provider: switchTo.provider,
				model: switchTo.model,
				reasoningEffort: switchTo.reasoningEffort
			};
			if (selectionRef !== void 0) selectionRef.current = {
				provider: switchTo.provider,
				model: switchTo.model,
				...switchTo.reasoningEffort === void 0 ? {} : { reasoningEffort: ReasoningEffortId(switchTo.reasoningEffort) }
			};
		},
		setPreset(id) {
			driverPreset = id;
		},
		workingDirectory() {
			const service = ctx.get("workingDirectory");
			if (agent !== void 0 && service !== void 0) return service.get(agent.session);
			return cwd;
		},
		async setWorkingDirectory(path) {
			const wired = await ensureAgent();
			const service = ctx.get("workingDirectory");
			if (service === void 0) throw new Error("tui: workingDirectory service unavailable");
			return await service.set(wired, path);
		},
		inbox() {
			if (agent === void 0) return [];
			const extract = (messages, target) => messages.map((message) => ({
				target,
				id: String(message.id),
				text: message.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("")
			}));
			const inbox = agent.inbox;
			return [...extract(inbox.nextStep, "next-step"), ...extract(inbox.nextTurn, "next-turn")];
		},
		removeInboxMessage(id) {
			return agent?.inbox.remove(MessageId(id)) ?? false;
		},
		async forkCurrent() {
			const wired = await ensureAgent();
			const child = ctx.get("sessions")?.fork(wired.session);
			if (child === void 0) throw new Error("tui: session fork unavailable");
			await ctx.get("sessions")?.flush(child);
			return String(child.id);
		},
		cancel() {
			agent?.cancel({ kind: "user" }, { keepInbox: true });
		},
		setBlocked(kind) {
			if (blocked === kind) return;
			blocked = kind;
			publishStatus();
		},
		/** Observe status snapshots (fires on every change; returns its disposer). */
		onStatus(listener) {
			statusListeners.push(listener);
			listener(lastStatus);
			return () => {
				const index = statusListeners.indexOf(listener);
				if (index >= 0) statusListeners.splice(index, 1);
			};
		},
		stop() {
			for (const stop of stoppers.splice(0)) stop();
		},
		async dispose() {
			stoppers.splice(0).forEach((stop) => stop());
			if (handle !== void 0) await handle.dispose();
			agent = void 0;
			handle = void 0;
			running = false;
			maintenance = false;
			blocked = void 0;
			reaping = false;
			openAttempts.clear();
			liveSubagents.clear();
			childRuns.clear();
			publishStatus();
		},
		async flush() {
			if (agent === void 0) return;
			await sessions.flush(agent.session);
		}
	};
}
//#endregion
//#region src/compact-queue.ts
/**
* Defers manual `/compact` requests made while the agent is running.
*
* The first request latches (notices "queued"), waits for idle, and — unless
* a new turn raced in, in which case it waits again — performs the dispatch
* exactly once. Failures clear the latch and surface through the delegate.
*/
var CompactQueue = class {
	queued = false;
	/** Whether a deferred compaction is waiting for the turn to end. */
	get isQueued() {
		return this.queued;
	}
	/** Queue one request; repeats while queued collapse to a notice. */
	request(delegate) {
		if (this.queued) {
			delegate.onDuplicate();
			return;
		}
		this.queued = true;
		delegate.onQueued();
		this.awaitIdle(delegate);
	}
	async awaitIdle(delegate) {
		try {
			while (this.queued) {
				await delegate.whenIdle();
				if (!this.queued) return;
				if (delegate.isRunning()) continue;
				this.queued = false;
				await delegate.dispatch();
				return;
			}
		} catch (error) {
			this.queued = false;
			delegate.onError(error instanceof Error ? error.message : String(error));
		}
	}
};
/**
* One-shot-per-band latch for the context-pressure hint: fires when the
* ratio crosses `notifyAt` from below and re-arms only after it falls back
* under `rearmBelow` (e.g. after a compaction shrank the history).
*/
var PressureLatch = class {
	notifyAt;
	rearmBelow;
	notified = false;
	constructor(notifyAt, rearmBelow) {
		this.notifyAt = notifyAt;
		this.rearmBelow = rearmBelow;
	}
	/** Whether this crossing should surface the hint. */
	shouldNotify(ratio) {
		if (this.notified) {
			if (ratio < this.rearmBelow) this.notified = false;
			return false;
		}
		if (ratio >= this.notifyAt) {
			this.notified = true;
			return true;
		}
		return false;
	}
};
//#endregion
//#region src/components/file-search.ts
/**
* File-search backing for the composer's `@` fuzzy completion.
*
* pi-tui's CombinedAutocompleteProvider requires the `fd` binary for fuzzy
* file search (`getFuzzyFileSuggestions` returns nothing without `fdPath`),
* which is often absent on Windows. We resolve `fd` when available and keep a
* bounded pure-JS walk as the fallback so `@` works out of the box.
* @module dsh-tui/components/file-search
*/
const SKIP_DIRECTORIES = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	".hg",
	".svn",
	"dist",
	"lib",
	"build",
	"out",
	"coverage",
	"target",
	"__pycache__",
	".dsh-test",
	".pnpm-store",
	".venv",
	"venv"
]);
const WALK_ENTRY_LIMIT = 4e3;
const WALK_DEPTH_LIMIT = 8;
const CACHE_TTL_MS = 3e4;
let cachedFdPath;
/** Resolve the `fd` binary once; null when unavailable. */
function resolveFdPath() {
	if (cachedFdPath !== void 0) return cachedFdPath;
	try {
		const finder = process.platform === "win32" ? "where" : "which";
		cachedFdPath = execFileSync(finder, ["fd"], {
			encoding: "utf8",
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		}).split("\n").map((line) => line.trim()).find((line) => line !== "") ?? null;
	} catch {
		cachedFdPath = null;
	}
	return cachedFdPath;
}
let cache;
let cacheBase;
/** Fuzzy file items over a bounded walk of the workspace (fd-free fallback). */
function fuzzyFileItems(basePath, query) {
	const now = Date.now();
	if (cache === void 0 || cacheBase !== basePath || now - cache.at > CACHE_TTL_MS) {
		const entries = [];
		collectEntries(basePath, "", entries, 0);
		cache = {
			at: now,
			entries
		};
		cacheBase = basePath;
	}
	const candidates = cache.entries.map((entry) => ({
		...entry,
		name: entry.path.split("/").pop() ?? entry.path
	}));
	const needle = query.replace(/^@/, "");
	return (needle === "" ? candidates.slice(0, 20) : fuzzyFilter(candidates, needle, (entry) => entry.name)).slice(0, 20).map((entry) => {
		const displayPath = entry.path;
		const label = entry.isDirectory ? `${entry.name}/` : entry.name;
		return {
			value: `@${entry.isDirectory ? `${displayPath}/` : displayPath}`,
			label,
			description: displayPath
		};
	});
}
function collectEntries(root, relative, out, depth) {
	if (out.length >= WALK_ENTRY_LIMIT || depth > WALK_DEPTH_LIMIT) return;
	let names;
	try {
		names = readdirSync(join(root, relative));
	} catch {
		return;
	}
	for (const name of names) {
		if (out.length >= WALK_ENTRY_LIMIT) return;
		if (name.startsWith(".") && name !== ".github") continue;
		if (SKIP_DIRECTORIES.has(name)) continue;
		const childRelative = relative === "" ? name : `${relative}/${name}`;
		let isDirectory;
		try {
			isDirectory = statSync(join(root, childRelative)).isDirectory();
		} catch {
			continue;
		}
		out.push({
			path: childRelative,
			isDirectory
		});
		if (isDirectory) collectEntries(root, childRelative, out, depth + 1);
	}
}
//#endregion
//#region src/events.ts
const RECENT_EVENT_LIMIT = 300;
let nextLocalId = 0;
const localId = (prefix) => `local-${prefix}-${nextLocalId++}`;
/**
* The fold. Call {@link applyEvent} for every durable event and
* {@link applyFrame} for every live stream frame of the driven session, in
* arrival order; renderers read {@link items} and {@link status} and are
* notified through {@link onChange}.
*/
var TranscriptModel = class {
	changeListeners = /* @__PURE__ */ new Set();
	live = /* @__PURE__ */ new Map();
	unknownCounts = /* @__PURE__ */ new Map();
	queuedNotices = [];
	idCounter = 0;
	presenter;
	constructor(presenter) {
		this.presenter = presenter;
	}
	items = [];
	/** Ring buffer of raw durable events for the /events inspector. */
	recent = [];
	title;
	/** Current permission preset name, from `permission/preset` events. */
	preset;
	/** Current model route, from `model/selection` events. */
	model;
	/** Latest todo list, from `todo/write` events. */
	todos;
	inputTokens = 0;
	outputTokens = 0;
	/** Register a change notification; returns its disposer. */
	onChange(listener) {
		this.changeListeners.add(listener);
		return () => {
			this.changeListeners.delete(listener);
		};
	}
	/** Clear everything for a session switch; keeps listeners and the items array identity. */
	reset() {
		this.items.length = 0;
		this.live.clear();
		this.queuedNotices = [];
		this.title = void 0;
		this.preset = void 0;
		this.model = void 0;
		this.todos = void 0;
		this.inputTokens = 0;
		this.outputTokens = 0;
		this.changed();
	}
	get status() {
		return {
			title: this.title,
			preset: this.preset,
			inputTokens: this.inputTokens,
			outputTokens: this.outputTokens,
			unknownEventTypes: this.unknownCounts
		};
	}
	/** Toggle the newest tool item's detail block (Ctrl+O). */
	toggleLastToolDetails() {
		for (let index = this.items.length - 1; index >= 0; index -= 1) {
			const item = this.items[index];
			if (item.kind === "tool" && !item.live) {
				item.expanded = !item.expanded;
				this.changed();
				return;
			}
		}
	}
	/** Toggle every settled tool item's detail block (/expand). */
	toggleAllToolDetails() {
		const tools = this.items.filter((item) => item.kind === "tool" && !item.live);
		if (tools.length === 0) return;
		const target = !tools.some((item) => item.kind === "tool" && item.expanded);
		for (const item of tools) if (item.kind === "tool") item.expanded = target;
		this.changed();
	}
	/** Local (non-durable) notice, e.g. the queue marker while a turn runs. */
	pushNotice(text, tone = "dim") {
		const index = this.items.length;
		this.items.push({
			kind: "notice",
			id: localId("notice"),
			text,
			tone
		});
		if (tone === "dim" && text.startsWith("(queued")) this.queuedNotices.push(index);
		this.changed();
	}
	/** Startup banner: whale logo plus the version/title/subtitle block (local, non-durable). */
	pushBanner(version, title, subtitle, info) {
		this.items.push({
			kind: "banner",
			id: localId("banner"),
			version,
			title,
			subtitle,
			info
		});
		this.changed();
	}
	applyFrame(frame) {
		if (frame.type === "start") {
			const index = this.items.length;
			this.items.push({
				kind: "assistant",
				id: `live-${frame.attemptId}`,
				live: true,
				text: "",
				reasoning: "",
				usage: void 0
			});
			this.live.set(frame.attemptId, {
				itemIndex: index,
				attemptId: frame.attemptId,
				blockTypes: /* @__PURE__ */ new Map()
			});
			this.changed();
			return;
		}
		if (frame.type === "chunk") {
			const state = this.live.get(frame.attemptId);
			if (state === void 0) return;
			const item = this.items[state.itemIndex];
			if (item?.kind !== "assistant") return;
			const chunk = frame.chunk;
			switch (chunk.type) {
				case "block-start":
					state.blockTypes.set(chunk.index, chunk.blockType);
					break;
				case "reasoning-delta":
					item.reasoning += chunk.text;
					break;
				case "text-delta":
					item.text += chunk.text;
					break;
				case "tool-call-delta": this.upsertLiveTool(chunk.id, chunk.name, chunk.argumentsDelta);
			}
			this.changed();
			return;
		}
		const state = this.live.get(frame.attemptId);
		if (state === void 0) return;
		this.live.delete(frame.attemptId);
		if (frame.outcome.kind === "abandoned") {
			const item = this.items[state.itemIndex];
			if (item?.kind === "assistant" && item.live) this.items.splice(state.itemIndex, 1, {
				kind: "notice",
				id: item.id,
				text: t("transcript.attemptDiscarded"),
				tone: "dim"
			});
			this.changed();
		}
	}
	applyEvent(event) {
		this.remember(event);
		const type = event.type;
		if (type === "session/title") {
			this.title = event.data.title;
			this.changed();
			return;
		}
		if (type.startsWith("session-log-deepseek/") || type.startsWith("llm/") || type.startsWith("plugin:")) return;
		if (type === "permission/preset") {
			this.preset = event.data.preset;
			this.items.push({
				kind: "notice",
				id: localId("preset"),
				text: t("notice.permissionChange", { preset: permissionDisplayName(this.preset) }),
				tone: "dim"
			});
			this.changed();
			return;
		}
		if (type === "command/run" || type === "command/done") return;
		if (type === "model/selection") {
			const data = event.data;
			const provider = data.selection?.provider ?? data.provider;
			const model = data.selection?.model ?? data.model;
			if (typeof provider === "string" && typeof model === "string") {
				this.model = `${provider}/${model}`;
				this.items.push({
					kind: "notice",
					id: localId("model"),
					text: t("notice.modelChange", { model: this.model }),
					tone: "dim"
				});
				this.changed();
			}
			return;
		}
		if (type === "working-directory/change") {
			const cwd = event.data.cwd;
			if (typeof cwd === "string" && cwd !== "") {
				this.items.push({
					kind: "notice",
					id: localId("cwd"),
					text: t("notice.cwdChange", { cwd }),
					tone: "dim"
				});
				this.changed();
			}
			return;
		}
		if (type === "todo/write") {
			const todos = event.data.todos;
			if (Array.isArray(todos)) {
				this.todos = todos.filter((entry) => typeof entry?.content === "string").map((entry) => ({
					content: entry.content,
					status: typeof entry.status === "string" ? entry.status : "pending"
				}));
				const done = this.todos.filter((entry) => entry.status === "completed").length;
				this.items.push({
					kind: "notice",
					id: localId("todo"),
					text: t("notice.todos", {
						done: String(done),
						total: String(this.todos.length)
					}),
					tone: "dim"
				});
				this.changed();
			}
			return;
		}
		if (type === "compaction/start") {
			this.items.push({
				kind: "notice",
				id: localId("compaction"),
				text: t("notice.compacting"),
				tone: "dim"
			});
			this.changed();
			return;
		}
		if (type === "compaction/end") {
			this.items.push({
				kind: "notice",
				id: localId("compaction"),
				text: t("notice.compacted"),
				tone: "dim"
			});
			this.changed();
			return;
		}
		switch (event.type) {
			case "user/message": {
				if (event.data.source.kind !== "user") return;
				this.dropQueuedNotices();
				const images = event.data.content.filter((block) => block.type === "image" && typeof block.attachment?.width === "number" && typeof block.attachment?.height === "number").map((block) => ({
					name: block.attachment.name ?? String(block.attachment.attachmentId ?? "image"),
					width: block.attachment.width,
					height: block.attachment.height
				}));
				this.items.push({
					kind: "user",
					id: `u${this.idCounter++}`,
					text: event.data.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join(""),
					...images.length === 0 ? {} : { images }
				});
				break;
			}
			case "assistant/message": {
				const blocks = event.data.message.content;
				const text = blocks.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("");
				const reasoning = blocks.filter((block) => block.type === "reasoning").map((block) => block.type === "reasoning" ? block.text : "").join("");
				const usage = event.data.usage === void 0 ? void 0 : {
					inputTokens: event.data.usage.inputTokens,
					outputTokens: event.data.usage.outputTokens
				};
				if (usage !== void 0) {
					this.inputTokens += usage.inputTokens;
					this.outputTokens += usage.outputTokens;
				}
				const liveIndex = this.items.findIndex((item) => item.kind === "assistant" && item.live);
				if (liveIndex >= 0) this.items.splice(liveIndex, 1, {
					kind: "assistant",
					id: `a${this.idCounter++}`,
					live: false,
					text,
					reasoning,
					usage
				});
				else this.items.push({
					kind: "assistant",
					id: `a${this.idCounter++}`,
					live: false,
					text,
					reasoning,
					usage
				});
				break;
			}
			case "tool/call": {
				const liveIndex = this.items.findIndex((item) => item.kind === "tool" && item.live && item.callId === event.data.callId);
				const item = {
					kind: "tool",
					id: `t${this.idCounter++}`,
					callId: event.data.callId,
					live: false,
					name: event.data.name,
					argDigest: digestToolArgs(event.data.name, event.data.arguments),
					rawArgs: event.data.arguments,
					status: "running",
					resultDigest: void 0,
					callView: this.presenter?.callView(event.data.name, event.data.arguments),
					resultView: void 0,
					expanded: false
				};
				if (liveIndex >= 0) this.items.splice(liveIndex, 1, item);
				else this.items.push(item);
				break;
			}
			case "tool/result": {
				const callId = event.data.message.toolCallId;
				const target = [...this.items].reverse().find((item) => item.kind === "tool" && item.callId === callId);
				if (target !== void 0 && target.kind === "tool") {
					target.status = event.data.message.isError === true ? "error" : "ok";
					target.resultDigest = digestToolResult(event.data.message.content);
					target.resultView = this.presenter?.resultView(target.name, target.rawArgs, {
						content: event.data.message.content,
						isError: event.data.message.isError === true,
						meta: event.data.meta
					});
				} else this.countUnknown("tool/result(unpaired)");
				break;
			}
			case "turn/end":
				if (event.data.reason.kind !== "completed") {
					const detail = event.data.reason.kind === "error" ? event.data.reason.error.message : "";
					const text = event.data.reason.kind === "error" ? t("transcript.turnError", { message: detail }) : t("transcript.turnEnd", { reason: event.data.reason.kind });
					this.items.push({
						kind: "notice",
						id: localId("turn"),
						text: text.length > 200 ? `${text.slice(0, 199)}…` : text,
						tone: event.data.reason.kind === "error" ? "error" : "dim"
					});
				}
				break;
			case "assistant/attempt":
				this.items.push({
					kind: "notice",
					id: localId("attempt"),
					text: t("transcript.attemptDiscarded"),
					tone: "dim"
				});
				break;
			case "turn/start":
			case "step/start":
			case "step/end":
			case "system/message":
			case "request/header":
			case "request/context":
			case "agent/inbox/spliced": break;
			default:
				this.countUnknown(event.type);
				return;
		}
		this.changed();
	}
	/** Keep one raw event for the inspector, bounded. */
	remember(event) {
		let summary;
		try {
			summary = JSON.stringify(event.data) ?? "";
		} catch {
			summary = "(unserializable)";
		}
		if (summary.length > 240) summary = `${summary.slice(0, 239)}…`;
		this.recent.push({
			seq: Number(event.seq),
			type: event.type,
			summary
		});
		if (this.recent.length > RECENT_EVENT_LIMIT) this.recent.splice(0, this.recent.length - RECENT_EVENT_LIMIT);
	}
	upsertLiveTool(callId, name, argsDelta) {
		const existing = this.items.find((item) => item.kind === "tool" && item.live && item.callId === callId);
		if (existing !== void 0 && existing.kind === "tool") {
			existing.argDigest = digestToolArgs(existing.name, rawArgsAppend(existing.argDigest, argsDelta));
			return;
		}
		this.items.push({
			kind: "tool",
			id: `live-${callId}`,
			callId,
			live: true,
			name: name ?? "…",
			argDigest: digestToolArgs(name ?? "", argsDelta),
			rawArgs: argsDelta,
			status: "running",
			resultDigest: void 0,
			callView: void 0,
			resultView: void 0,
			expanded: false
		});
	}
	dropQueuedNotices() {
		if (this.queuedNotices.length === 0) return;
		for (const index of this.queuedNotices.reverse()) this.items.splice(index, 1);
		this.queuedNotices = [];
	}
	countUnknown(type) {
		this.unknownCounts.set(type, (this.unknownCounts.get(type) ?? 0) + 1);
	}
	changed() {
		for (const listener of this.changeListeners) listener();
	}
};
function rawArgsAppend(currentDigest, delta) {
	return `${currentDigest}${delta}`;
}
/** One-line argument digest for a tool call: its most identifying field. */
function digestToolArgs(name, rawArgs) {
	try {
		const parsed = JSON.parse(rawArgs);
		if (parsed !== null && typeof parsed === "object") {
			const record = parsed;
			for (const key of [
				"command",
				"pattern",
				"path",
				"query",
				"url",
				"prompt"
			]) {
				const value = record[key];
				if (typeof value === "string" && value !== "") return value;
			}
			const first = Object.values(record).find((value) => typeof value === "string" && value !== "");
			if (typeof first === "string") return first;
			return rawArgs;
		}
	} catch {}
	return rawArgs;
}
/** One-line result digest: first text block, truncated. */
function digestToolResult(content) {
	const first = content.find((block) => block.type === "text");
	if (first === void 0) return void 0;
	const single = first.text.split("\n").find((line) => line.trim() !== "") ?? "";
	return single.length > 72 ? `${single.slice(0, 71)}…` : single;
}
//#endregion
//#region src/theme.ts
const darkColors = {
	text: {
		hex: "#E8E8E8",
		ansi: ["\x1B[97m", "\x1B[39m"]
	},
	dim: {
		hex: "#8A8A8A",
		ansi: ["\x1B[2m", "\x1B[22m"]
	},
	accent: {
		hex: "#4FC3F7",
		ansi: ["\x1B[36m", "\x1B[39m"]
	},
	user: {
		hex: "#4FC3F7",
		ansi: ["\x1B[36m", "\x1B[39m"]
	},
	tool: {
		hex: "#C792EA",
		ansi: ["\x1B[35m", "\x1B[39m"]
	},
	success: {
		hex: "#81C784",
		ansi: ["\x1B[32m", "\x1B[39m"]
	},
	warning: {
		hex: "#FFB74D",
		ansi: ["\x1B[33m", "\x1B[39m"]
	},
	error: {
		hex: "#F28B82",
		ansi: ["\x1B[31m", "\x1B[39m"]
	},
	border: {
		hex: "#6B6B6B",
		ansi: ["\x1B[90m", "\x1B[39m"]
	}
};
const lightColors = {
	text: {
		hex: "#1F1F1F",
		ansi: ["\x1B[30m", "\x1B[39m"]
	},
	dim: {
		hex: "#5F5F5F",
		ansi: ["\x1B[90m", "\x1B[39m"]
	},
	accent: {
		hex: "#1565C0",
		ansi: ["\x1B[34m", "\x1B[39m"]
	},
	user: {
		hex: "#1565C0",
		ansi: ["\x1B[34m", "\x1B[39m"]
	},
	tool: {
		hex: "#8E24AA",
		ansi: ["\x1B[35m", "\x1B[39m"]
	},
	success: {
		hex: "#2E7D32",
		ansi: ["\x1B[32m", "\x1B[39m"]
	},
	warning: {
		hex: "#9A6700",
		ansi: ["\x1B[33m", "\x1B[39m"]
	},
	error: {
		hex: "#C62828",
		ansi: ["\x1B[31m", "\x1B[39m"]
	},
	border: {
		hex: "#9E9E9E",
		ansi: ["\x1B[90m", "\x1B[39m"]
	}
};
const wrap = (open, close) => (text) => `${open}${text}${close}`;
let truecolorCache;
/** Truecolor support probe (cached; the environment does not change mid-run). */
function trueColorEnabled() {
	if (truecolorCache === void 0) {
		const program = process.env.TERM_PROGRAM;
		truecolorCache = process.env.COLORTERM === "truecolor" || process.env.COLORTERM === "24bit" || program === "iTerm.app" || program === "vscode" || program === "Apple_Terminal" || process.env.WT_SESSION !== void 0 || process.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
	}
	return truecolorCache;
}
function hexToRgb(hex) {
	const value = Number.parseInt(hex.slice(1), 16);
	return [
		value >> 16 & 255,
		value >> 8 & 255,
		value & 255
	];
}
/** A palette entry as a foreground wrapper: truecolor, or the ANSI fallback. */
function colorWrapper(color, truecolor) {
	if (!truecolor) return wrap(color.ansi[0], color.ansi[1]);
	const [r, g, b] = hexToRgb(color.hex);
	return wrap(`\x1b[38;2;${String(r)};${String(g)};${String(b)}m`, "\x1B[39m");
}
/** Materialize one theme from its palette (probe-independent, testable). */
function buildTheme(colors, truecolor) {
	return {
		text: colorWrapper(colors.text, truecolor),
		dim: colorWrapper(colors.dim, truecolor),
		accent: colorWrapper(colors.accent, truecolor),
		user: colorWrapper(colors.user, truecolor),
		tool: colorWrapper(colors.tool, truecolor),
		success: colorWrapper(colors.success, truecolor),
		warning: colorWrapper(colors.warning, truecolor),
		error: colorWrapper(colors.error, truecolor),
		border: colorWrapper(colors.border, truecolor)
	};
}
const darkTheme = buildTheme(darkColors, trueColorEnabled());
const lightTheme = buildTheme(lightColors, trueColorEnabled());
function themeByName(name) {
	if (name === "light") return lightTheme;
	return darkTheme;
}
const THEME_NAMES = ["dark", "light"];
/** pi-tui Markdown theme derived from one semantic theme. */
function markdownThemeFor(theme) {
	const identity = (text) => text;
	return {
		heading: theme.accent,
		link: theme.accent,
		linkUrl: theme.dim,
		code: theme.tool,
		codeBlock: identity,
		codeBlockBorder: theme.dim,
		quote: theme.dim,
		quoteBorder: theme.dim,
		hr: theme.dim,
		listBullet: theme.accent,
		bold: (text) => `\x1b[1m${text}\x1b[22m`,
		italic: (text) => `\x1b[3m${text}\x1b[23m`,
		strikethrough: theme.dim,
		underline: (text) => `\x1b[4m${text}\x1b[24m`
	};
}
/** pi-tui SelectList theme derived from one semantic theme. */
function selectListThemeFor(theme) {
	return {
		selectedPrefix: theme.accent,
		selectedText: theme.accent,
		description: theme.dim,
		scrollInfo: theme.dim,
		noMatch: theme.dim
	};
}
/**
* SelectList theme that reads the CURRENT theme on every call, so surfaces
* constructed once (the editor's autocomplete palette) re-skin when the
* theme ref is swapped instead of keeping the palette they were built with.
*/
function liveSelectListTheme(getTheme) {
	return {
		selectedPrefix: (text) => getTheme().accent(text),
		selectedText: (text) => getTheme().accent(text),
		description: (text) => getTheme().dim(text),
		scrollInfo: (text) => getTheme().dim(text),
		noMatch: (text) => getTheme().dim(text)
	};
}
//#endregion
//#region src/logo-cells.ts
/**
* Generated by tools/logo-cells.mjs — do not edit by hand.
* Source: the harness web app's whale favicon, rasterized to 16x12
* pixels and packed into half-block rows drawn in DeepSeek brand blue.
* @module dsh-tui/logo-cells
*/
/** The whale's brand color, as an RGB triple. */
const LOGO_RGB = [
	77,
	107,
	254
];
/** Half-block rows: space / ▀ / ▄ / █ per cell. */
const LOGO_ROWS = [
	"  ▄▄▄▄██   █▄  ▄",
	"▄████████▄ ▀███▀",
	"█  ▀▀████▀███   ",
	"█▄    ▀██▄███   ",
	" █▄  ▄▄ ████    ",
	"  ▀▀█████▀▀▀▀   "
];
//#endregion
//#region src/components/transcript.ts
/**
* Transcript rendering: maps {@link TranscriptItem}s to lines with one
* component per item, cached by a snapshot key of the item's renderable
* content. The app invalidates and requests renders from model changes.
* @module dsh-tui/components/transcript
*/
/**
* The DeepSeek whale, rasterized from the web app's favicon by
* `tools/logo-cells.mjs` into half-block rows — see `src/logo-cells.ts`.
*/
/**
* Truecolor support probe: the logo's brand blue needs direct-color ANSI;
* terminals without it get the blocks in the theme's accent color instead.
* (Shared with the theme system — see `src/theme.ts`.)
*/
const TRUECOLOR = trueColorEnabled();
/** One logo row: block runs in brand blue (or accent), spaces untouched. */
function logoLine(row, theme) {
	const truecolor = TRUECOLOR;
	const [r, g, b] = LOGO_RGB;
	let out = "";
	let run = "";
	const flush = () => {
		if (run === "") return;
		out += truecolor ? `\x1b[38;2;${String(r)};${String(g)};${String(b)}m${run}\x1b[39m` : theme.accent(run);
		run = "";
	};
	for (const ch of row) if (ch === " ") {
		flush();
		out += ch;
	} else run += ch;
	flush();
	return out;
}
var TranscriptView = class {
	items;
	entries = [];
	cacheWidth;
	cacheLines;
	context;
	constructor(items, context) {
		this.items = items;
		this.context = context;
	}
	invalidate() {
		this.cacheWidth = void 0;
		this.cacheLines = void 0;
	}
	/** Swap the rendering context (theme switch) and drop all caches. */
	setContext(context) {
		this.context = context;
		this.entries.length = 0;
		this.invalidate();
	}
	render(width) {
		if (this.cacheLines !== void 0 && this.cacheWidth === width) return this.cacheLines;
		const lines = [];
		for (let index = 0; index < this.items.length; index += 1) {
			const item = this.items[index];
			const entry = this.entryAt(index, item);
			lines.push(...entry.component.render(width));
			const next = this.items[index + 1];
			if (next !== void 0 && (next.kind === "user" || next.kind === "assistant")) lines.push("");
		}
		this.cacheWidth = width;
		this.cacheLines = lines;
		return lines;
	}
	entryAt(index, item) {
		const key = snapshotKey(item);
		const existing = this.entries[index];
		if (existing !== void 0 && existing.key === key) return existing;
		const entry = {
			key,
			component: createItemComponent(item, this.context)
		};
		this.entries[index] = entry;
		return entry;
	}
};
/** Everything of the item its rendering depends on. */
function snapshotKey(item) {
	switch (item.kind) {
		case "user": return `user|${item.text}|${(item.images ?? []).map((image) => `${image.name}:${String(image.width)}x${String(image.height)}`).join(",")}`;
		case "assistant": return `assistant|${item.live ? "live" : "set"}|${item.text}|${firstLine(item.reasoning, 72)}`;
		case "tool": return `tool|${item.name}|${item.argDigest}|${item.status}|${item.resultDigest ?? ""}|${String(item.expanded)}`;
		case "notice": return `notice|${item.text}|${item.tone}`;
		case "banner": return `banner|${item.version}|${item.title}|${item.subtitle}|${item.info}`;
	}
}
/** Compact headline for a tool item, preferring the declared call view title. */
function toolHeadline(item) {
	const view = item.resultView !== void 0 ? viewTitle(item.resultView) : void 0;
	const callTitle = item.callView !== void 0 ? callViewTitle(item.callView) : void 0;
	return {
		title: view ?? callTitle ?? `${item.name} ${item.argDigest}`,
		kind: item.callView !== void 0 && "kind" in item.callView ? item.callView.kind : void 0
	};
}
function callViewTitle(view) {
	switch (view.card) {
		case "terminal": return view.title;
		case "diff": return view.title;
		case "generic": return view.title;
	}
}
function viewTitle(view) {
	switch (view.card) {
		case "generic": return view.title;
		case "terminal": return view.title;
		case "diff": return view.title;
		case "search": return view.title;
		case "read": return;
		case "web": return view.title;
	}
}
function createItemComponent(item, context) {
	const { theme, markdownTheme } = context;
	switch (item.kind) {
		case "user": {
			const chips = item.images === void 0 ? [] : item.images.map((image) => theme.dim(`  🖼 ${image.name} · ${String(image.width)}×${String(image.height)}`));
			const body = new Text(theme.user("❯ ") + theme.text(item.text), 0, 0);
			return new MarkedPrompt(chips.length === 0 ? body : new Compound([body, new Text(chips.join("\n"), 0, 0)]));
		}
		case "assistant": {
			const reasoning = item.reasoning === "" ? [] : [theme.dim(`· ${item.live ? t("transcript.thinking") : ""}${firstLine(item.reasoning, 72)}`)];
			if (item.text === "") return new Text(reasoning.length > 0 ? reasoning.join("\n") : item.live ? theme.dim(t("transcript.pending")) : "", 0, 0);
			if (reasoning.length === 0) return new Markdown(item.text, 0, 0, markdownTheme, { color: theme.text });
			return new Compound([new Text(reasoning.join("\n"), 0, 0), new Markdown(item.text, 0, 0, markdownTheme, { color: theme.text })]);
		}
		case "tool": {
			const glyph = item.status === "running" ? "⋯" : item.status === "ok" ? "✓" : "✕";
			const headline = toolHeadline(item);
			const head = item.status === "ok" ? theme.success(`${glyph} ${headline.title}`) : item.status === "error" ? theme.error(`${glyph} ${headline.title}`) : theme.tool(`${glyph} ${headline.title}`);
			const hint = item.expanded ? "" : theme.dim(" · ctrl+o");
			const header = new Text(`${head}${hint}`, 0, 0);
			if (!item.expanded) return header;
			return new Compound([header, ...detailComponents(item, context)]);
		}
		case "notice": return new Text(item.tone === "error" ? theme.error(item.text) : theme.dim(item.text), 0, 0);
		case "banner": {
			const firstTextRow = Math.floor((LOGO_ROWS.length - 3) / 2);
			const texts = [
				theme.dim(item.version),
				theme.accent(item.title),
				theme.tool(item.subtitle)
			];
			const rows = LOGO_ROWS.map((row, index) => {
				const textIndex = index - firstTextRow;
				const text = textIndex >= 0 && textIndex < 3 ? `    ${texts[textIndex]}` : "";
				return new Text(`${logoLine(row, theme)}${text}`, 0, 0);
			});
			rows.push(new Text(theme.dim(item.info), 0, 0), new Text("", 0, 0));
			return new Compound(rows);
		}
	}
}
function firstLine(text, max) {
	const trimmed = (text.split("\n").find((candidate) => candidate.trim() !== "") ?? "").trim();
	return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
/** The expanded detail block components for one tool item. */
function detailComponents(item, context) {
	const { theme } = context;
	const blocks = [];
	const view = item.resultView ?? item.callView;
	if (view === void 0) {
		if (item.resultDigest !== void 0) blocks.push(new Text(theme.dim(`  ${item.resultDigest}`), 0, 0));
		if (item.rawArgs !== "" && item.rawArgs !== "{}") blocks.push(new Text(theme.dim(`  args ${truncateToWidth(item.rawArgs, 200, "")}`), 0, 0));
		return blocks;
	}
	switch (view.card) {
		case "diff":
			for (const diff of view.diffs) blocks.push(diffComponent(diff.path, diff.oldText, diff.newText, theme));
			return blocks;
		case "read": {
			blocks.push(new Text(theme.dim(`  ${view.path}${view.totalLines === void 0 ? "" : ` (${String(view.lines.length)}/${String(view.totalLines)} lines)`}`), 0, 0));
			const width = 4 + Math.max(...view.lines.map((line) => String(line.number).length), 1);
			for (const line of view.lines.slice(0, 200)) {
				const number = theme.dim(`${String(line.number).padStart(width)} │ `);
				blocks.push(new Text(`${number}${line.text}`, 0, 0));
			}
			return blocks;
		}
		case "terminal": {
			if (view.card === "terminal" && "output" in view && view.output !== void 0 && view.output !== "") for (const line of view.output.replace(/\r\n/g, "\n").split("\n").slice(0, 100)) blocks.push(new Text(theme.dim(`  ${line}`), 0, 0));
			const terminal = view;
			if (terminal.exitCode !== void 0 && terminal.exitCode !== 0) blocks.push(new Text(theme.error(`  exit ${String(terminal.exitCode)}`), 0, 0));
			else if (terminal.signal !== void 0) blocks.push(new Text(theme.warning(`  signal ${terminal.signal}`), 0, 0));
			return blocks;
		}
		case "search":
			if (view.shape === "paths") {
				blocks.push(new Text(theme.dim(`  ${String(view.paths.length)} path(s)${view.truncated ? ` of ${String(view.total)} (capped)` : ""}`), 0, 0));
				for (const path of view.paths.slice(0, 100)) blocks.push(new Text(theme.tool(`  ${path}`), 0, 0));
			} else {
				blocks.push(new Text(theme.dim(`  ${String(view.total)} match(es)${view.truncated ? " (capped)" : ""}`), 0, 0));
				for (const file of view.files.slice(0, 30)) {
					blocks.push(new Text(theme.tool(`  ${file.path}`), 0, 0));
					for (const match of file.matches.slice(0, 10)) blocks.push(new Text(theme.dim(`   ${String(match.lineNumber).padStart(4)} ${truncateToWidth(match.line, 120, "")}`), 0, 0));
				}
			}
			return blocks;
		case "generic":
			if ("content" in view && view.content !== void 0) {
				for (const block of view.content.slice(0, 20)) if (block.type === "text" && block.text !== "") for (const line of block.text.split("\n").slice(0, 40)) blocks.push(new Text(theme.dim(`  ${line}`), 0, 0));
			}
			if ("rawInput" in view && view.rawInput !== void 0) {
				const rendered = typeof view.rawInput === "string" ? view.rawInput : JSON.stringify(view.rawInput, null, 2);
				if (rendered !== "" && rendered !== "{}") blocks.push(new Text(theme.dim(`  in ${truncateToWidth(rendered, 200, "")}`), 0, 0));
			}
			return blocks;
		case "web":
			if ("content" in view && Array.isArray(view.content)) {
				for (const block of view.content.slice(0, 20)) if (block.type === "text" && block.text !== void 0) for (const line of block.text.split("\n").slice(0, 40)) blocks.push(new Text(theme.dim(`  ${line}`), 0, 0));
			}
			return blocks;
	}
}
/** One unified-diff block with +/- coloring (LCS over lines, size-guarded). */
function diffComponent(path, oldText, newText, theme) {
	const lines = diffLines(oldText, newText);
	const rows = [theme.accent(`  ── ${path} ──`)];
	for (const line of lines.slice(0, 200)) if (line.op === "+") rows.push(theme.success(`  + ${line.text}`));
	else if (line.op === "-") rows.push(theme.error(`  - ${line.text}`));
	else rows.push(theme.dim(`    ${line.text}`));
	if (lines.length > 200) rows.push(theme.dim(`  … ${String(lines.length - 200)} more line(s)`));
	return new Text(rows.join("\n"), 0, 0);
}
/** Common-prefix/suffix trim + LCS middle; falls back to before/after beyond the guard. */
function diffLines(oldText, newText) {
	const oldLines = oldText === null ? [] : oldText.replace(/\r\n/g, "\n").split("\n");
	const newLines = newText.replace(/\r\n/g, "\n").split("\n");
	if (oldLines.length > 0 && oldLines.at(-1) === "") oldLines.pop();
	if (newLines.length > 0 && newLines.at(-1) === "") newLines.pop();
	let start = 0;
	while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start += 1;
	let endOld = oldLines.length;
	let endNew = newLines.length;
	while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
		endOld -= 1;
		endNew -= 1;
	}
	const result = [];
	for (let index = 0; index < start; index += 1) result.push({
		op: " ",
		text: oldLines[index]
	});
	const middleOld = oldLines.slice(start, endOld);
	const middleNew = newLines.slice(start, endNew);
	if (middleOld.length * middleNew.length > 25e4) {
		for (const text of middleOld) result.push({
			op: "-",
			text
		});
		for (const text of middleNew) result.push({
			op: "+",
			text
		});
	} else result.push(...lcsDiff(middleOld, middleNew));
	for (let index = endOld; index < oldLines.length; index += 1) result.push({
		op: " ",
		text: oldLines[index]
	});
	return result;
}
/** Classic LCS line diff for bounded middles. */
function lcsDiff(oldLines, newLines) {
	const oldCount = oldLines.length;
	const newCount = newLines.length;
	const table = Array.from({ length: oldCount + 1 }, () => new Array(newCount + 1).fill(0));
	for (let i = oldCount - 1; i >= 0; i -= 1) for (let j = newCount - 1; j >= 0; j -= 1) table[i][j] = oldLines[i] === newLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
	const result = [];
	let i = 0;
	let j = 0;
	while (i < oldCount && j < newCount) if (oldLines[i] === newLines[j]) {
		result.push({
			op: " ",
			text: oldLines[i]
		});
		i += 1;
		j += 1;
	} else if (table[i + 1][j] >= table[i][j + 1]) {
		result.push({
			op: "-",
			text: oldLines[i]
		});
		i += 1;
	} else {
		result.push({
			op: "+",
			text: newLines[j]
		});
		j += 1;
	}
	while (i < oldCount) {
		result.push({
			op: "-",
			text: oldLines[i]
		});
		i += 1;
	}
	while (j < newCount) {
		result.push({
			op: "+",
			text: newLines[j]
		});
		j += 1;
	}
	return result;
}
/** Prepends an invisible OSC 133 prompt-start marker to a component's first line. */
var MarkedPrompt = class {
	child;
	constructor(child) {
		this.child = child;
	}
	invalidate() {
		this.child.invalidate();
	}
	render(width) {
		const lines = this.child.render(width);
		if (lines.length === 0) return lines;
		return [`\x1b]133;A\x07${lines[0] ?? ""}`, ...lines.slice(1)];
	}
};
/** Stacks child components vertically without layout semantics. */
var Compound = class {
	children;
	constructor(children) {
		this.children = children;
	}
	invalidate() {
		for (const child of this.children) child.invalidate();
	}
	render(width) {
		const lines = [];
		for (const child of this.children) lines.push(...child.render(width));
		return lines;
	}
};
//#endregion
//#region src/components/line-text.ts
/**
* One-line status text with a setter: truncate-to-width with caching, the
* shape the header bar and composer hints need (TruncatedText is immutable).
* @module dsh-tui/components/line-text
*/
var LineText = class {
	text;
	paddingX;
	cacheWidth;
	cacheLine;
	constructor(text, paddingX = 0) {
		this.text = text;
		this.paddingX = paddingX;
	}
	setText(text) {
		if (text === this.text) return;
		this.text = text;
		this.cacheWidth = void 0;
		this.cacheLine = void 0;
	}
	invalidate() {
		this.cacheWidth = void 0;
		this.cacheLine = void 0;
	}
	render(width) {
		if (this.cacheLine !== void 0 && this.cacheWidth === width) return this.cacheLine;
		const line = `${" ".repeat(this.paddingX)}${truncateToWidth(this.text, Math.max(0, width - this.paddingX * 2))}`;
		this.cacheWidth = width;
		this.cacheLine = [line];
		return this.cacheLine;
	}
};
//#endregion
//#region src/dialogs.ts
/**
* Interaction dialogs: the two waterfall answerers the TUI owes the runtime —
* tool approvals (`approval/request`) and user questions
* (`user-questions/request`, the `ask_user_question` tool).
*
* Both are plain pi-tui components shown as focused overlays above the app
* layout; key handlers resolve the waterfall promise, and the request's
* AbortSignal resolves cancellation without input.
* @module dsh-tui/dialogs
*/
/** Present the localized display reason best matching the environment. */
function displayReasonOf(reasons, fallback) {
	if (reasons !== void 0) return reasons.en;
	return fallback ?? "";
}
var ApprovalDialog = class {
	request;
	theme;
	cacheWidth;
	cacheLines;
	settled = false;
	done;
	resolveDone;
	constructor(request, theme) {
		this.request = request;
		this.theme = theme;
		this.done = new Promise((resolve) => {
			this.resolveDone = resolve;
		});
		request.signal?.addEventListener("abort", () => {
			this.settle("cancelled");
		}, { once: true });
	}
	invalidate() {
		this.cacheWidth = void 0;
		this.cacheLines = void 0;
	}
	render(width) {
		if (this.cacheLines !== void 0 && this.cacheWidth === width) return this.cacheLines;
		const reason = displayReasonOf(this.request.displayReason, this.request.reason);
		const head = this.theme.warning(t("approval.title", { tool: this.request.toolName }));
		const lines = [truncateToWidth(` ${head}`, width)];
		if (reason !== "") lines.push(truncateToWidth(this.theme.dim(`  ${reason}`), width));
		lines.push(truncateToWidth(this.theme.dim(t("approval.hint")), width));
		this.cacheWidth = width;
		this.cacheLines = lines;
		return lines;
	}
	handleInput(data) {
		if (this.settled) return;
		if (matchesKey(data, Key.enter) || data === "y" || data === "Y") {
			this.settle("allowed-once");
			return;
		}
		if (matchesKey(data, Key.escape) || data === "n" || data === "N") {
			this.settle("rejected");
			return;
		}
		if (matchesKey(data, Key.ctrl("c"))) this.settle("cancelled");
	}
	settle(outcome) {
		if (this.settled) return;
		this.settled = true;
		this.resolveDone(outcome);
	}
};
var QuestionDialog = class {
	request;
	theme;
	states = [];
	index = 0;
	cacheWidth;
	cacheLines;
	settled = false;
	done;
	resolveDone;
	constructor(request, theme) {
		this.request = request;
		this.theme = theme;
		this.done = new Promise((resolve) => {
			this.resolveDone = resolve;
		});
		for (const question of request.questions) this.states.push({
			question,
			selected: /* @__PURE__ */ new Set(),
			cursor: 0
		});
		request.signal?.addEventListener("abort", () => {
			this.settle({ answers: [] });
		}, { once: true });
	}
	invalidate() {
		this.cacheWidth = void 0;
		this.cacheLines = void 0;
	}
	render(width) {
		if (this.cacheLines !== void 0 && this.cacheWidth === width) return this.cacheLines;
		const lines = [];
		const active = this.states[this.index];
		if (active !== void 0) {
			const marker = this.theme.accent("?");
			lines.push(truncateToWidth(` ${marker} ${active.question.question}`, width));
			if (active.question.detail !== void 0 && active.question.detail !== "") for (const line of active.question.detail.split("\n").slice(0, 8)) lines.push(truncateToWidth(this.theme.dim(`   ${line}`), width));
			const options = active.question.options ?? [];
			for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
				const option = options[optionIndex];
				const isCursor = optionIndex === active.cursor;
				const isSelected = active.selected.has(option.label);
				const prefix = isCursor ? " ▶ " : "   ";
				const mark = active.question.multiSelect === true ? isSelected ? "[x] " : "[ ] " : "";
				const label = isCursor ? this.theme.accent(option.label) : option.label;
				lines.push(truncateToWidth(`${prefix}${mark}${label}`, width));
				if (option.description !== void 0 && option.description !== "") lines.push(truncateToWidth(this.theme.dim(`       ${option.description}`), width));
			}
			const navigation = this.states.length > 1 ? t("question.nav", {
				index: String(this.index + 1),
				total: String(this.states.length)
			}) : "";
			const hints = active.question.multiSelect === true ? t("question.hintMulti", { nav: navigation }) : t("question.hintSingle", { nav: navigation });
			lines.push(truncateToWidth(this.theme.dim(hints), width));
		}
		this.cacheWidth = width;
		this.cacheLines = lines;
		return lines;
	}
	handleInput(data) {
		if (this.settled) return;
		const active = this.states[this.index];
		if (active === void 0) return;
		const options = active.question.options ?? [];
		if (matchesKey(data, Key.escape)) {
			this.settle({ answers: [] });
			return;
		}
		if (matchesKey(data, Key.up)) {
			active.cursor = active.cursor > 0 ? active.cursor - 1 : options.length - 1;
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.down)) {
			active.cursor = active.cursor < options.length - 1 ? active.cursor + 1 : 0;
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.index = (this.index + 1) % this.states.length;
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.space) && active.question.multiSelect === true && options.length > 0) {
			const label = options[active.cursor]?.label;
			if (label !== void 0) {
				if (active.selected.has(label)) active.selected.delete(label);
				else active.selected.add(label);
				this.invalidate();
			}
			return;
		}
		if (matchesKey(data, Key.enter)) {
			if (active.question.multiSelect !== true && options.length > 0) {
				const label = options[active.cursor]?.label;
				if (label !== void 0) active.selected.add(label);
			}
			if (this.index < this.states.length - 1) {
				this.index += 1;
				this.invalidate();
				return;
			}
			const answers = this.states.map((state) => ({
				id: state.question.id,
				selected: [...state.selected]
			}));
			this.settle({ answers });
		}
	}
	settle(answer) {
		if (this.settled) return;
		this.settled = true;
		this.resolveDone(answer);
	}
};
/**
* Scrollable single-select picker over the pi-tui SelectList: pagination and
* mouse support come from the list; the wrapper adds a title, hints, and a
* `done` promise resolved with the chosen value.
*/
var PickerDialog = class {
	title;
	theme;
	requestRender;
	hints;
	list;
	settled = false;
	cacheWidth;
	cacheLines;
	done;
	resolveDone;
	constructor(title, items, theme, requestRender, hints, maxVisible = 12) {
		this.title = title;
		this.theme = theme;
		this.requestRender = requestRender;
		this.hints = hints;
		this.list = new SelectList(items.map((item) => ({
			value: item.value,
			label: item.label,
			...item.description === void 0 ? {} : { description: item.description }
		})), maxVisible, selectListThemeFor(theme));
		this.done = new Promise((resolve) => {
			this.resolveDone = resolve;
		});
		this.list.onSelectionChange = () => {
			this.invalidate();
			this.requestRender();
		};
		this.list.onSelect = (item) => {
			if (this.settled) return;
			this.settled = true;
			this.resolveDone(item.value);
		};
		this.list.onCancel = () => {
			if (this.settled) return;
			this.settled = true;
			this.resolveDone(void 0);
		};
	}
	invalidate() {
		this.cacheWidth = void 0;
		this.cacheLines = void 0;
		this.list.invalidate();
	}
	handleInput(data) {
		this.list.handleInput(data);
	}
	render(width) {
		if (this.cacheLines !== void 0 && this.cacheWidth === width) return this.cacheLines;
		const lines = [truncateToWidth(this.theme.accent(` ${this.title}`), width)];
		for (const line of this.list.render(width - 2)) lines.push(truncateToWidth(` ${line}`, width));
		lines.push(truncateToWidth(this.theme.dim(` ${this.hints}`), width));
		this.cacheWidth = width;
		this.cacheLines = lines;
		return lines;
	}
};
/** Generic read-only list overlay (todos, exports, static info). */
var ListDialog = class {
	title;
	rows;
	theme;
	cacheWidth;
	cacheLines;
	settled = false;
	done;
	resolveDone;
	constructor(title, rows, theme) {
		this.title = title;
		this.rows = rows;
		this.theme = theme;
		this.done = new Promise((resolve) => {
			this.resolveDone = resolve;
		});
	}
	invalidate() {
		this.cacheWidth = void 0;
		this.cacheLines = void 0;
	}
	render(width) {
		if (this.cacheLines !== void 0 && this.cacheWidth === width) return this.cacheLines;
		const lines = [truncateToWidth(this.theme.accent(` ${this.title}`), width)];
		for (const row of this.rows) lines.push(truncateToWidth(row, width));
		lines.push(truncateToWidth(this.theme.dim(t("dialog.closeHint")), width));
		this.cacheWidth = width;
		this.cacheLines = lines;
		return lines;
	}
	handleInput(data) {
		if (this.settled) return;
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") {
			this.settled = true;
			this.resolveDone();
		}
	}
};
/** Read-only raw-event inspector shown by the /events command. */
var EventsDialog = class {
	records;
	theme;
	maxLines;
	cacheWidth;
	cacheLines;
	settled = false;
	done;
	resolveDone;
	constructor(records, theme, maxLines = 24) {
		this.records = records;
		this.theme = theme;
		this.maxLines = maxLines;
		this.done = new Promise((resolve) => {
			this.resolveDone = resolve;
		});
	}
	invalidate() {
		this.cacheWidth = void 0;
		this.cacheLines = void 0;
	}
	render(width) {
		if (this.cacheLines !== void 0 && this.cacheWidth === width) return this.cacheLines;
		const lines = [truncateToWidth(this.theme.accent(` ${t("events.title", {
			shown: String(Math.min(this.maxLines, this.records.length)),
			total: String(this.records.length)
		})}`), width)];
		const start = Math.max(0, this.records.length - this.maxLines);
		for (const record of this.records.slice(start)) lines.push(truncateToWidth(this.theme.dim(` ${String(record.seq).padStart(4, " ")} ${record.type} ${record.summary}`), width));
		lines.push(truncateToWidth(this.theme.dim(t("dialog.closeHint")), width));
		this.cacheWidth = width;
		this.cacheLines = lines;
		return lines;
	}
	handleInput(data) {
		if (this.settled) return;
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") {
			this.settled = true;
			this.resolveDone();
		}
	}
};
//#endregion
//#region src/components/status-line.ts
/**
* The animated status segment of the header bar: shows a braille spinner
* frame while work is in flight (a turn, maintenance, or a background subagent
* — the driver's aggregate busy state), plain text otherwise. Owns its frame
* timer, asks the host for re-renders on each tick, and reports the
* visible/hidden flips so a terminal integration can mirror them.
* @module dsh-tui/components/status-line
*/
const SPINNER_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏"
];
var StatusLine = class {
	requestRender;
	intervalMs;
	frames;
	text = "";
	active = false;
	frame = 0;
	timer;
	cacheWidth;
	cacheLine;
	activeListener;
	constructor(requestRender, intervalMs = 120, frames = SPINNER_FRAMES) {
		this.requestRender = requestRender;
		this.intervalMs = intervalMs;
		this.frames = frames;
	}
	/**
	* Observe the spinner's visible/hidden flips — the exact state a terminal-side
	* observer can see (tab indicator, notification, sound), so an addon can
	* mirror it instead of scraping the byte stream for frames. Pass `undefined`
	* to detach. The flag mirrors the driver's aggregate busy state, so a visible
	* spinner never disagrees with what the OSC reports.
	*/
	setOnActiveChange(listener) {
		this.activeListener = listener;
	}
	/** Update the static text and the running state together. */
	set(text, active) {
		const textChanged = text !== this.text;
		const stateChanged = active !== this.active;
		if (!textChanged && !stateChanged) return;
		this.text = text;
		this.active = active;
		this.cacheWidth = void 0;
		this.cacheLine = void 0;
		this.syncTimer();
		if (stateChanged) {
			this.requestRender();
			this.activeListener?.(this.active);
		}
	}
	dispose() {
		const wasActive = this.active;
		this.active = false;
		this.syncTimer();
		this.cacheWidth = void 0;
		this.cacheLine = void 0;
		if (wasActive) this.activeListener?.(false);
	}
	invalidate() {
		this.cacheWidth = void 0;
		this.cacheLine = void 0;
	}
	render(width) {
		if (this.cacheLine !== void 0 && this.cacheWidth === width) return this.cacheLine;
		const head = this.active ? `${this.frames[this.frame % this.frames.length] ?? "·"} ` : "";
		this.cacheWidth = width;
		this.cacheLine = [truncateToWidth(`${head}${this.text}`, width)];
		return this.cacheLine;
	}
	syncTimer() {
		if (this.active && this.timer === void 0) this.timer = setInterval(() => {
			this.frame = (this.frame + 1) % this.frames.length;
			this.cacheWidth = void 0;
			this.cacheLine = void 0;
			this.requestRender();
		}, this.intervalMs);
		else if (!this.active && this.timer !== void 0) {
			clearInterval(this.timer);
			this.timer = void 0;
		}
	}
};
//#endregion
//#region src/settings.ts
/**
* Persisted dsh-tui user settings: `$DSH_HOME/tui/settings.json` (the home
* follows `DSH_HOME`, defaulting to `~/.dsh`). The preset / theme / locale
* choices made with `/preset`, `/theme`, and `/language` survive restarts.
* CLI flags keep the highest precedence at boot; the file only records what
* the runtime commands change.
* @module dsh-tui/settings
*/
const SETTING_KEYS = [
	"preset",
	"theme",
	"locale",
	"model"
];
/** Absolute settings-file path under the resolved harness home. */
function tuiSettingsPath() {
	return dshHomePath("tui", "settings.json");
}
/**
* Read the settings file. A missing file, unreadable bytes, or corrupt JSON
* all yield `{}` — a broken settings file must never block the TUI from
* starting; it is simply rewritten on the next change.
*/
async function loadTuiSettings() {
	let raw;
	try {
		raw = await readFile(tuiSettingsPath(), "utf8");
	} catch {
		return {};
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	const record = parsed;
	const settings = {};
	for (const key of SETTING_KEYS) {
		const value = record[key];
		if (typeof value === "string" && value.trim() !== "") settings[key] = value.trim();
	}
	return settings;
}
/**
* Atomically write the settings file (temp file + rename), creating parent
* directories on demand. Callers handle failures (a notice, a debug log).
*/
async function saveTuiSettings(settings) {
	const file = tuiSettingsPath();
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	await rename(tmp, file);
}
//#endregion
//#region src/images.ts
/**
* Image input for the composer: detect image file paths in submitted text,
* admit them through the harness attachment service (the same
* `admitPromptContent` pipeline the web upload flow uses), and gate sending
* on the current model's declared vision support.
* @module dsh-tui/images
*/
/** Media type per accepted file extension (case-insensitive). */
const MEDIA_BY_EXTENSION = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif"
};
/** The image media type a path's extension declares, or undefined for non-images. */
function mediaTypeFor(path) {
	const dot = path.lastIndexOf(".");
	if (dot < 0) return void 0;
	return MEDIA_BY_EXTENSION[path.slice(dot + 1).toLowerCase()];
}
/** Trailing sentence punctuation stripped from bare path tokens. */
const TRAILING_PUNCTUATION = /[),.;:!?>\]}，。；：！？）》」』]+$/u;
/**
* Candidate local image paths in one composer text, in first-occurrence
* order. Quoted spans (paths with spaces) and bare tokens both match; URLs
* are ignored — only files on this machine can be attached.
*/
function detectImagePaths(text) {
	const candidates = [];
	for (const match of text.matchAll(/["']([^"'\n]+)["']/g)) candidates.push(match[1]);
	for (const token of text.split(/\s+/)) {
		const cleaned = token.replace(TRAILING_PUNCTUATION, "");
		if (cleaned !== "") candidates.push(cleaned);
	}
	const results = [];
	const seen = /* @__PURE__ */ new Set();
	for (const candidate of candidates) {
		if (candidate.startsWith("http://") || candidate.startsWith("https://")) continue;
		if (mediaTypeFor(candidate) === void 0) continue;
		if (!seen.has(candidate)) {
			seen.add(candidate);
			results.push(candidate);
		}
	}
	return results;
}
/**
* Read and admit every existing image path through `ctx.attachments`
* (`admitPromptContent`): validation, normalization, and durable storage all
* happen inside the harness — the same pipeline the web upload flow uses.
*/
async function admitImages(ctx, paths) {
	const attachments = ctx.get("attachments");
	if (attachments === void 0) return {
		images: [],
		missing: [],
		failed: paths.map((path) => ({
			path,
			message: "attachment service unavailable"
		}))
	};
	const images = [];
	const missing = [];
	const pending = [];
	for (const path of paths) try {
		if (!(await stat(path)).isFile()) {
			missing.push(path);
			continue;
		}
		const data = await readFile(path);
		pending.push({
			path,
			mediaType: mediaTypeFor(path),
			data: data.toString("base64"),
			name: basename(path)
		});
	} catch {
		missing.push(path);
	}
	if (pending.length > 0) try {
		const admitted = await attachments.admitPromptContent(pending.map((part) => ({
			type: "image",
			mediaType: part.mediaType,
			data: part.data,
			name: part.name
		})));
		for (const part of admitted) {
			const image = part;
			if (image.type === "image" && typeof image.attachment?.width === "number") images.push(image);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			images,
			missing,
			failed: pending.map((part) => ({
				path: part.path,
				message
			}))
		};
	}
	return {
		images,
		missing,
		failed: []
	};
}
/**
* Whether the current model route declares image input. Mirrors the
* harness's own route gate (`read_image`): an entry whose modalities are
* **unknown refuses** — undefined is text-only, only an explicit
* `inputModalities` containing `image` passes. `undefined` here means
* resolution itself failed, in which case the send is allowed through and
* the adapter reports a precise error.
*/
async function modelAcceptsImages(ctx, provider, model) {
	const llm = ctx.get("llm");
	if (llm === void 0) return void 0;
	try {
		const info = await llm.resolveModelInfo(provider, model);
		if (info.inputModalities === void 0) return false;
		return info.inputModalities.includes("image");
	} catch {
		return;
	}
}
/** Model ids under one provider that explicitly declare image input, for switch hints. */
async function visionCapableModels(ctx, provider) {
	const llm = ctx.get("llm");
	if (llm === void 0) return [];
	try {
		return (await llm.listModels(provider)).filter((entry) => entry.inputModalities?.includes("image") === true).map((entry) => entry.id);
	} catch {
		return [];
	}
}
//#endregion
//#region src/util/log.ts
/**
* Dev logging and screen-output custody.
*
* While the TUI owns the screen, ANY stray write to the terminal garbles the
* alt-screen viewport. Two channels need custody:
* - `process.stderr.write` — replaced directly;
* - the global `console.*` methods — Node's console binds its write functions
*   at bootstrap, so replacing `process.stderr.write` alone does not affect
*   them (the harness logs diagnostics like the account model listing through
*   `console.info`/`console.warn`).
*
* Captured output is teed into the debug log file (DSH_TUI_LOG) instead of
* the terminal. Our own debug lines also go there.
*/
/** A logger writing to the DSH_TUI_LOG file, or a no-op when unset. */
function createDebugLogger() {
	const path = process$1.env.DSH_TUI_LOG;
	if (path === void 0 || path === "") return { debug: () => {} };
	appendFile(path, `--- dsh-tui session ${(/* @__PURE__ */ new Date()).toISOString()} ---\n`, "utf8").catch(() => {});
	return { debug: (message) => {
		appendFile(path, `${(/* @__PURE__ */ new Date()).toISOString()} ${message}\n`, "utf8").catch(() => {});
	} };
}
const CONSOLE_METHODS = [
	"log",
	"info",
	"warn",
	"error",
	"debug",
	"trace"
];
/**
* Takes custody of process.stderr and the global console while the TUI owns
* the screen. `restore` puts everything back and returns the captured stderr
* text for replay after the alt screen exited.
*/
var StderrCapture = class {
	log;
	originalWrite;
	originalConsole;
	captured = "";
	active = false;
	constructor(log) {
		this.log = log;
		this.originalWrite = process$1.stderr.write.bind(process$1.stderr);
		this.originalConsole = {};
		for (const method of CONSOLE_METHODS) this.originalConsole[method] = console[method];
	}
	install() {
		if (this.active) return;
		this.active = true;
		process$1.stderr.write = ((chunk, ...rest) => {
			const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
			this.captured += text;
			this.log.debug(`stderr: ${JSON.stringify(text)}`);
			const callback = rest[0];
			if (typeof callback === "function") callback();
			return true;
		});
		for (const method of CONSOLE_METHODS) console[method] = (...args) => {
			this.log.debug(`console.${method}: ${format(...args)}`);
		};
	}
	restore() {
		if (!this.active) return "";
		this.active = false;
		process$1.stderr.write = this.originalWrite;
		for (const method of CONSOLE_METHODS) console[method] = this.originalConsole[method];
		const pending = this.captured;
		this.captured = "";
		return pending;
	}
};
//#endregion
//#region package.json
var version = "0.1.0";
//#endregion
//#region src/app.ts
/**
* The interactive application: opencode-style fullscreen layout over the
* {@link AgentDriver} and {@link TranscriptModel}.
*
* ┌──────────────────────────────────────────┐
* │ header: project · title · model · status │
* ├──────────────────────────────────────────┤
* │ transcript ScrollView (follow: end)      │
* ├──────────────────────────────────────────┤
* │ composer: bordered editor + hints        │
* └──────────────────────────────────────────┘
*
* Keys: Enter sends (queues while running) · Esc/Ctrl+C interrupt · Ctrl+C
* twice or Ctrl+Q quits. Exit restores the main screen, prints the transcript
* into normal scrollback, flushes the session, and leaves through appExit.
* @module dsh-tui/app
*/
/**
* Wraps the combined autocomplete provider so an empty/blank composer never
* offers suggestions: deleting the leading "/" must close the command list,
* not fall through to the base-path file listing. Forced (Tab) completion is
* unaffected.
*/
var ComposerAutocomplete = class {
	inner;
	basePath;
	fdPath;
	skills;
	commands;
	constructor(inner, basePath, fdPath, skills, commands) {
		this.inner = inner;
		this.basePath = basePath;
		this.fdPath = fdPath;
		this.skills = skills;
		this.commands = commands;
	}
	async getSuggestions(lines, cursorLine, cursorCol, options) {
		const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
		if (before.trim() === "" && options.force !== true) return null;
		const hashToken = tokenAfterSeparators(before);
		if (hashToken !== null && hashToken.startsWith("#") && !hashToken.startsWith("#\"")) {
			const query = hashToken.slice(1).toLowerCase();
			const items = this.skills().filter((skill) => skill.name.toLowerCase().includes(query)).slice(0, 20).map((skill) => ({
				label: skill.name,
				value: `#${skill.name}`,
				...skill.description === "" ? {} : { description: `🛠 ${skill.description}` }
			}));
			if (items.length === 0) return null;
			return {
				items,
				prefix: hashToken
			};
		}
		if (this.fdPath === null) {
			const atToken = tokenAfterSeparators(before);
			if (atToken !== null && atToken.startsWith("@") && !atToken.startsWith("@\"")) {
				const items = fuzzyFileItems(this.basePath, atToken);
				if (items.length === 0) return null;
				return {
					items,
					prefix: atToken
				};
			}
		}
		const commandText = before.trimStart();
		if (options.force !== true && commandText.startsWith("/") && !commandText.slice(1).includes(" ")) {
			const query = commandText.slice(1);
			const matches = [];
			for (const command of this.commands()) {
				const nameMatch = fuzzyMatch(query, command.name);
				if (nameMatch.matches) {
					matches.push({
						command,
						score: nameMatch.score
					});
					continue;
				}
				let bestAlias;
				for (const alias of command.aliases ?? []) {
					const aliasMatch = fuzzyMatch(query, alias);
					if (aliasMatch.matches && (bestAlias === void 0 || aliasMatch.score < bestAlias.score)) bestAlias = {
						alias,
						score: aliasMatch.score
					};
				}
				if (bestAlias !== void 0) matches.push({
					command,
					score: bestAlias.score,
					viaAlias: bestAlias.alias
				});
			}
			matches.sort((a, b) => a.score - b.score || Number(a.viaAlias !== void 0) - Number(b.viaAlias !== void 0));
			if (matches.length === 0) return null;
			return {
				items: matches.map(({ command, viaAlias }) => ({
					value: command.name,
					label: viaAlias === void 0 ? command.name : `${command.name} (${viaAlias})`,
					...command.description === void 0 || command.description === "" ? {} : { description: command.description }
				})),
				prefix: commandText
			};
		}
		return await this.inner.getSuggestions(lines, cursorLine, cursorCol, options);
	}
	applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
		if (prefix.startsWith("#") && !prefix.startsWith("#\"")) {
			const currentLine = lines[cursorLine] ?? "";
			const before = currentLine.slice(0, cursorCol - prefix.length);
			const after = currentLine.slice(cursorCol);
			const replacement = `${item.value} `;
			const nextLine = `${before}${replacement}${after}`;
			return {
				lines: lines.map((line, index) => index === cursorLine ? nextLine : line),
				cursorLine,
				cursorCol: before.length + replacement.length
			};
		}
		return this.inner.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
	}
};
/** The last separator-delimited token, or null when none precedes the cursor. */
function tokenAfterSeparators(before) {
	const match = /([^\s,;:（）「」【】、，。；：'"=]+)$/.exec(before);
	return match === null ? null : match[1];
}
/** Expand #skill-name references to the model's <skill> tags; known names only. */
function expandSkillReferences(text, roster) {
	if (!text.includes("#")) return text;
	const known = new Set(roster.map((skill) => skill.name));
	return text.replace(/(^|\s)#([A-Za-z0-9][A-Za-z0-9_-]*)/g, (whole, lead, name) => known.has(name) ? `${lead}<skill>${name}</skill>` : whole);
}
const PRESET_MODES = [
	{
		id: "standard",
		zh: "标准（全套工具）"
	},
	{
		id: "ptc",
		zh: "PTC（程序化工具调用）"
	},
	{
		id: "minimal",
		zh: "极简（只读为主）"
	},
	{
		id: "cordis",
		zh: "创造（组合编排）"
	}
];
var TuiApp = class TuiApp {
	ctx;
	driver;
	tui;
	stderr;
	transcript;
	header;
	hints;
	editor;
	theme;
	themeRef;
	itemContext;
	log;
	preset;
	pendingPreset;
	pendingModel;
	settings;
	disposers;
	constructor(ctx, driver, tui, stderr, transcript, header, hints, editor, theme, themeRef, itemContext, log, preset, pendingPreset, pendingModel, settings, disposers) {
		this.ctx = ctx;
		this.driver = driver;
		this.tui = tui;
		this.stderr = stderr;
		this.transcript = transcript;
		this.header = header;
		this.hints = hints;
		this.editor = editor;
		this.theme = theme;
		this.themeRef = themeRef;
		this.itemContext = itemContext;
		this.log = log;
		this.preset = preset;
		this.pendingPreset = pendingPreset;
		this.pendingModel = pendingModel;
		this.settings = settings;
		this.disposers = disposers;
	}
	/**
	* Build the app: driver first (its subscription feeds the model), then the
	* layout, then input handling.
	*/
	static async create(ctx, options) {
		const settings = await loadTuiSettings();
		initSystemLocale();
		if (settings.locale !== void 0) setLocale(settings.locale);
		const savedTheme = settings.theme !== void 0 && THEME_NAMES.includes(settings.theme) ? settings.theme : void 0;
		const theme = themeByName(options.theme ?? savedTheme);
		const themeRef = { current: theme };
		const log = createDebugLogger();
		const model = new TranscriptModel(createToolPresenter(ctx));
		const preset = options.preset ?? (settings.preset !== void 0 && PRESET_MODES.some((mode) => mode.id === settings.preset) ? settings.preset : void 0) ?? "standard";
		const savedModelRaw = settings.model;
		const savedModel = savedModelRaw !== void 0 && /^[^/\s]+\/[^/\s]+$/.test(savedModelRaw) ? {
			provider: savedModelRaw.slice(0, savedModelRaw.indexOf("/")),
			model: savedModelRaw.slice(savedModelRaw.indexOf("/") + 1)
		} : void 0;
		const modelRoute = options.model ?? savedModel;
		const driver = await createDriver(ctx, model, {
			resume: options.resume,
			preset,
			model: modelRoute
		});
		const stderr = new StderrCapture(log);
		stderr.install();
		const tui = new TuiAltScreen(new ProcessTerminal(), false, void 0, { scrollToEndIndicator: () => themeRef.current.accent(t("scroll.jumpToEnd")) });
		const itemContext = {
			theme,
			markdownTheme: markdownThemeFor(theme)
		};
		const header = new StatusLine(() => {
			tui.requestRender();
		}, 120, process$1.env.DSH_TUI_NO_SPINNER === "1" ? ["·"] : void 0);
		const transcript = new TranscriptView(model.items, itemContext);
		const hints = new LineText("", 1);
		const editor = new Editor(tui, {
			borderColor: (text) => themeRef.current.border(text),
			selectList: liveSelectListTheme(() => themeRef.current)
		});
		const composer = new VStack([editor, hints]);
		const scroll = new ScrollView(transcript, {
			follow: "end",
			primary: true,
			overscroll: "chain",
			scrollbar: "auto",
			scrollbarHideDelayMs: 1500
		});
		if (isViewportTUI(tui)) tui.setLayoutRoot(new VStack([
			{
				component: scroll,
				basis: 0,
				grow: 1,
				minSize: 1
			},
			{
				component: header,
				basis: "auto",
				minSize: 1
			},
			{
				component: composer,
				basis: "auto",
				shrink: 1,
				minSize: 1
			}
		]));
		tui.setFocus(editor);
		const app = new TuiApp(ctx, driver, tui, stderr, transcript, header, hints, editor, theme, themeRef, itemContext, log, preset, void 0, modelRoute, settings, []);
		app.wire(model);
		app.wireInteractions(ctx);
		app.wireCommands();
		pushWelcome(model, driver);
		return app;
	}
	/** Overlay picker over pending inbox input; selecting removes the message. */
	async pickInboxMessage() {
		const pending = this.driver.inbox();
		if (pending.length === 0) {
			this.driver.model.pushNotice("· inbox empty");
			return;
		}
		const labels = /* @__PURE__ */ new Map();
		const options = pending.map((entry) => {
			const label = `[${entry.target}] ${truncate(entry.text === "" ? "(no text)" : entry.text, 44)}`;
			labels.set(label, { id: entry.id });
			return { label };
		});
		const dialog = new QuestionDialog({ questions: [{
			id: "inbox",
			question: t("dialog.inboxTitle"),
			options
		}] }, this.theme);
		const selected = (await this.showDialog(dialog)).answers[0]?.selected[0];
		if (selected === void 0) {
			this.driver.model.pushNotice("· inbox picker cancelled");
			return;
		}
		const target = labels.get(selected);
		if (target === void 0) return;
		this.driver.model.pushNotice(this.driver.removeInboxMessage(target.id) ? `· removed ${truncate(selected, 60)}` : `· remove failed (already claimed?)`);
	}
	/** Fork the current session and switch the driver onto the child. */
	async forkSession() {
		if (this.driver.running) {
			this.driver.model.pushNotice("· interrupt the running turn first (esc)");
			return;
		}
		let childId;
		try {
			childId = await this.driver.forkCurrent();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.driver.model.pushNotice(`· fork failed: ${message.slice(0, 140)}`, "error");
			return;
		}
		await this.switchSession(childId);
	}
	/** Overlay with the current todo list. */
	async showTodoList() {
		const todos = this.driver.model.todos;
		if (todos === void 0 || todos.length === 0) {
			this.driver.model.pushNotice("· no todos recorded");
			return;
		}
		const rows = todos.map((entry) => {
			const mark = entry.status === "completed" ? "☑" : entry.status === "in_progress" ? "◐" : "☐";
			return entry.status === "completed" ? this.theme.dim(` ${mark} ${entry.content}`) : entry.status === "in_progress" ? this.theme.accent(` ${mark} ${entry.content}`) : ` ${mark} ${entry.content}`;
		});
		await this.showDialog(new ListDialog("todos", rows, this.theme));
	}
	/** Theme picker + live re-skin of every rendered surface. */
	async pickTheme(argument) {
		if (argument !== "") {
			this.applyTheme(argument);
			return;
		}
		const dialog = new QuestionDialog({ questions: [{
			id: "theme",
			question: t("dialog.themeTitle"),
			options: THEME_NAMES.map((name) => ({ label: name }))
		}] }, this.theme);
		const selected = (await this.showDialog(dialog)).answers[0]?.selected[0];
		if (selected === void 0) {
			this.driver.model.pushNotice("· theme picker cancelled");
			return;
		}
		this.applyTheme(selected);
	}
	applyTheme(name) {
		const next = themeByName(name);
		if (next === this.theme) {
			this.persistSetting("theme", name);
			this.driver.model.pushNotice(t("notice.themeStays", { name }));
			return;
		}
		this.theme = next;
		this.themeRef.current = next;
		this.itemContext = {
			theme: next,
			markdownTheme: markdownThemeFor(next)
		};
		this.transcript.setContext(this.itemContext);
		this.header.set(headerLine(this.driver.model, next), this.driver.busy);
		this.hints.setText(hintsLine(this.driver, next));
		this.persistSetting("theme", name);
		this.driver.model.pushNotice(t("notice.themeChanged", { name }));
		this.tui.requestRender();
	}
	/** Export the transcript as Markdown. */
	async exportTranscript(pathArgument) {
		const model = this.driver.model;
		const sessionId = this.driver.hasAgent ? String(this.driver.session?.id ?? "session") : "unstarted";
		const path = pathArgument === "" ? `dsh-tui-${sessionId.slice(0, 13)}.md` : pathArgument;
		const markdown = renderTranscriptMarkdown(model, sessionId);
		try {
			await writeFile(path, markdown, "utf8");
			this.driver.model.pushNotice(`· exported ${markdown.length} bytes → ${path}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.driver.model.pushNotice(`· export failed: ${message.slice(0, 140)}`, "error");
		}
	}
	/** Copy the n-th latest assistant text (default: latest) to the clipboard. */
	copyAssistantText(argument) {
		const model = this.driver.model;
		const messages = model.items.filter((item) => item.kind === "assistant" && !item.live && item.text !== "");
		if (messages.length === 0) {
			model.pushNotice("· nothing to copy yet");
			return;
		}
		const index = argument === "" ? messages.length - 1 : messages.length - 1 - (Number.parseInt(argument, 10) || 0);
		const target = index >= 0 && index < messages.length ? messages[index] : void 0;
		if (target === void 0) {
			model.pushNotice(`· /copy: only ${String(messages.length)} assistant message(s)`);
			return;
		}
		osc52Copy(target.text);
		const preview = target.text.slice(0, 40).replace(/\n/g, " ");
		model.pushNotice(`· copied ${String(target.text.length)} chars (${preview}…)`);
	}
	/** Language picker: every known locale; reserved ones answer honestly. */
	async pickLanguage(argument) {
		if (argument !== "") {
			this.applyLanguage(argument);
			return;
		}
		const current = locale();
		const dialog = new QuestionDialog({ questions: [{
			id: "language",
			question: t("dialog.languageTitle"),
			options: knownLocales().map((entry) => ({
				label: `${entry.id === current ? "● " : ""}${entry.label}`,
				...entry.available ? {} : { description: t("dialog.reservedHint") }
			}))
		}] }, this.theme);
		const selected = (await this.showDialog(dialog)).answers[0]?.selected[0];
		if (selected === void 0) {
			this.driver.model.pushNotice(t("notice.langCancelled"));
			return;
		}
		const entry = knownLocales().find((candidate) => `${candidate.id === current ? "● " : ""}${candidate.label}` === selected);
		if (entry !== void 0) this.applyLanguage(entry.id);
	}
	applyLanguage(name) {
		const label = availableLocales().find((entry) => entry.id === name)?.label ?? name;
		if (setLocale(name)) {
			this.persistSetting("locale", name);
			this.driver.model.pushNotice(t("notice.langChanged", { name: label }));
			return;
		}
		this.driver.model.pushNotice(t("notice.langUnavailable", {
			name: label,
			fallback: "English"
		}));
	}
	/** Overlay picker over the llm catalog; applies the switch to the next step. */
	async pickModel() {
		const llm = this.ctx.get("llm");
		if (llm === void 0) {
			this.driver.model.pushNotice("· llm service unavailable", "error");
			return;
		}
		const entries = [];
		try {
			for (const provider of llm.listProviders()) {
				const models = await llm.listModels(provider.id);
				for (const info of models) entries.push({
					provider: info.provider,
					id: info.id,
					name: info.name,
					vision: info.inputModalities?.includes("image") === true
				});
			}
		} catch (error) {
			this.driver.model.pushNotice(`· model catalog failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			return;
		}
		if (entries.length === 0) {
			this.driver.model.pushNotice("· no models advertised");
			return;
		}
		const currentRoute = `${this.driver.route.provider}/${this.driver.route.model}`;
		const labels = /* @__PURE__ */ new Map();
		const options = entries.map((entry) => {
			const label = `${entry.provider}/${entry.id}${entry.vision ? ` (👁 ${t("model.visionTag")})` : ""}`;
			labels.set(label, entry);
			return {
				label,
				...entry.name === "" || entry.name === entry.id ? {} : { description: entry.name }
			};
		});
		const dialog = new QuestionDialog({ questions: [{
			id: "model",
			question: t("dialog.modelTitle", { route: truncate(currentRoute, 44) }),
			options
		}] }, this.theme);
		const chosenLabel = (await this.showDialog(dialog)).answers[0]?.selected[0];
		if (chosenLabel === void 0) {
			this.driver.model.pushNotice("· model picker cancelled");
			return;
		}
		const chosen = labels.get(chosenLabel);
		if (chosen === void 0) return;
		let effort;
		let efforts = [];
		try {
			efforts = (await llm.resolveModelInfo(chosen.provider, chosen.id)).reasoning?.efforts ?? [];
		} catch {
			efforts = [];
		}
		if (efforts.length > 1) {
			const labelOf = (candidate) => displayEffort(candidate);
			const effortDialog = new QuestionDialog({ questions: [{
				id: "effort",
				question: t("dialog.effortTitle", { model: chosen.id }),
				options: efforts.map((candidate) => ({
					label: labelOf(candidate),
					...candidate.description === void 0 ? {} : { description: candidate.description }
				}))
			}] }, this.theme);
			const effortLabel = (await this.showDialog(effortDialog)).answers[0]?.selected[0];
			if (effortLabel === void 0) this.driver.model.pushNotice("· effort picker cancelled; keeping the default");
			else effort = efforts.find((candidate) => labelOf(candidate) === effortLabel)?.id;
		}
		try {
			this.driver.setModel({
				provider: chosen.provider,
				model: chosen.id,
				reasoningEffort: effort
			});
			this.pendingModel = {
				provider: chosen.provider,
				model: chosen.id
			};
			this.persistSetting("model", `${chosen.provider}/${chosen.id}`);
			this.driver.model.pushNotice(`· model → ${chosen.provider}/${chosen.id}${effort === void 0 ? "" : ` (effort ${effort})`}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.driver.model.pushNotice(`· model switch failed: ${message.slice(0, 140)}`, "error");
		}
	}
	/** /thinking [level]: runtime reasoning-effort switch (off | low | high | max). */
	async pickThinking(argument) {
		const llm = this.ctx.get("llm");
		if (llm === void 0) {
			this.driver.model.pushNotice("· llm service unavailable", "error");
			return;
		}
		const route = this.driver.route;
		let efforts = [];
		let defaultEffort;
		try {
			const info = await llm.resolveModelInfo(route.provider, route.model);
			efforts = info.reasoning?.efforts ?? [];
			defaultEffort = info.reasoning?.defaultEffort;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.driver.model.pushNotice(`· model info failed: ${message.slice(0, 140)}`, "error");
			return;
		}
		if (efforts.length === 0) {
			this.driver.model.pushNotice(t("notice.thinkingUnsupported", { model: route.model }));
			return;
		}
		if (efforts.length === 1) {
			this.driver.model.pushNotice(t("notice.thinkingSingle", {
				model: route.model,
				effort: displayEffort(efforts[0])
			}));
			return;
		}
		if (argument !== "") {
			const direct = efforts.find((candidate) => candidate.id === argument);
			if (direct === void 0) {
				this.driver.model.pushNotice(t("notice.thinkingInvalid", { effort: argument }), "error");
				return;
			}
			this.applyThinking(direct.id);
			return;
		}
		const current = route.effort ?? defaultEffort;
		const labelOf = (candidate) => `${candidate.id === current ? "● " : ""}${displayEffort(candidate)}`;
		const dialog = new QuestionDialog({ questions: [{
			id: "thinking",
			question: t("dialog.thinkingTitle", { effort: current === void 0 ? "—" : displayEffort({
				id: current,
				name: ""
			}) }),
			options: efforts.map((candidate) => ({
				label: labelOf(candidate),
				...candidate.description === void 0 ? {} : { description: candidate.description }
			}))
		}] }, this.theme);
		const label = (await this.showDialog(dialog)).answers[0]?.selected[0];
		if (label === void 0) {
			this.driver.model.pushNotice(t("notice.thinkingCancelled"));
			return;
		}
		const chosen = efforts.find((candidate) => labelOf(candidate) === label);
		if (chosen !== void 0) this.applyThinking(chosen.id);
	}
	applyThinking(effort) {
		const route = this.driver.route;
		if (effort === route.effort) {
			this.driver.model.pushNotice(t("notice.thinkingStays", { effort: displayEffort({
				id: effort,
				name: ""
			}) }));
			return;
		}
		this.driver.setModel({
			provider: route.provider,
			model: route.model,
			reasoningEffort: effort
		});
		this.driver.model.pushNotice(t("notice.thinkingChange", { effort: displayEffort({
			id: effort,
			name: ""
		}) }));
	}
	/** /skill [name]: two-level skill browser (list → detail with body preview). */
	async showSkills(argument) {
		const skills = this.ctx.get("skills");
		if (skills === void 0) {
			this.driver.model.pushNotice(t("notice.skillUnavailable"), "error");
			return;
		}
		let summaries = [];
		try {
			summaries = await skills.list({ cwd: process$1.cwd() });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.driver.model.pushNotice(t("notice.skillListFailed", { message: message.slice(0, 140) }), "error");
			return;
		}
		if (summaries.length === 0) {
			this.driver.model.pushNotice(t("notice.skillNone"));
			return;
		}
		const openDetail = async (name) => {
			const summary = summaries.find((entry) => entry.name === name);
			if (summary === void 0) return;
			const rows = [
				`${summary.description}`,
				"",
				`${t("skill.usage")}: /${summary.name} <${t("skill.taskPlaceholder")}>`,
				`${t("skill.source")}: ${summary.source} · ${summary.provider}`,
				...summary.path === void 0 ? [] : [`${t("skill.path")}: ${summary.path}`],
				...summary.whenToUse === void 0 || summary.whenToUse === "" ? [] : ["", `${t("skill.whenToUse")}: ${summary.whenToUse}`]
			];
			try {
				const body = (await skills.get(name, { cwd: process$1.cwd() })).content.split("\n").slice(0, 24);
				rows.push("", `${t("skill.body")} ─────`, ...body);
			} catch {}
			await this.showDialog(new ListDialog(t("dialog.skillDetailTitle", { name }), rows, this.theme));
		};
		if (argument !== "") {
			if (!summaries.some((entry) => entry.name === argument)) {
				this.driver.model.pushNotice(t("notice.skillUnknown", { name: argument }), "error");
				return;
			}
			await openDetail(argument);
			return;
		}
		for (;;) {
			const picker = new PickerDialog(t("dialog.skillTitle"), summaries.map((summary) => ({
				value: summary.name,
				label: summary.name,
				...summary.description === "" ? {} : { description: summary.description }
			})), this.theme, () => this.tui.requestRender(), "↑↓ move · enter details · esc close", 12);
			const name = await this.showDialog(picker);
			if (name === void 0) return;
			await openDetail(name);
		}
	}
	/** /reload: reconcile the profile composition in place (new plugin rows, config) without restarting. */
	async reloadComposition() {
		const hmr = this.ctx.get("hmr");
		if (hmr === void 0) {
			this.driver.model.pushNotice(t("notice.reloadUnavailable"), "error");
			return;
		}
		this.driver.model.pushNotice(t("notice.reloadStarted"));
		try {
			const result = await hmr.runExclusive(() => hmr.reconcileProfile());
			for (const warning of result.warnings.slice(0, 3)) this.driver.model.pushNotice(`· ${warning.slice(0, 160)}`);
			if (result.restartReason !== void 0) {
				this.driver.model.pushNotice(t("notice.reloadRestart", { reason: result.restartReason.slice(0, 120) }), "error");
				return;
			}
			if (result.pending.length > 0) {
				this.driver.model.pushNotice(t("notice.reloadPending", { count: String(result.pending.length) }));
				return;
			}
			this.driver.model.pushNotice(t("notice.reloadApplied"));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.driver.model.pushNotice(t("notice.reloadFailed", { message: message.slice(0, 140) }), "error");
		}
	}
	/** /mcp: pick an MCP server, then drill into its detail (two-level). */
	async showMcpServers() {
		const tools = this.ctx.get("tools");
		if (tools === void 0 || tools.definitions === void 0 && tools.view === void 0) {
			this.driver.model.pushNotice(t("notice.mcpUnavailable"), "error");
			return;
		}
		const names = [];
		if (tools.definitions !== void 0) for (const definition of tools.definitions()) names.push(definition.name);
		else {
			const registryView = tools.view?.();
			for (const name of registryView?.visible.keys() ?? []) names.push(name);
		}
		const byServer = /* @__PURE__ */ new Map();
		for (const name of names) {
			if (!name.startsWith("mcp__")) continue;
			const separator = name.indexOf("__", 4);
			if (separator <= 4) continue;
			const server = name.slice(4, separator);
			const tool = name.slice(separator + 2);
			const bucket = byServer.get(server);
			if (bucket === void 0) byServer.set(server, [tool]);
			else bucket.push(tool);
		}
		if (byServer.size === 0) {
			this.driver.model.pushNotice(t("notice.mcpNone"));
			return;
		}
		for (;;) {
			const picker = new PickerDialog(t("dialog.mcpTitle"), [...byServer.entries()].map(([server, serverTools]) => ({
				value: server,
				label: server,
				description: t("dialog.mcpServerCount", { count: String(serverTools.length) })
			})), this.theme, () => this.tui.requestRender(), "↑↓ move · enter details · esc close", 10);
			const server = await this.showDialog(picker);
			if (server === void 0) return;
			const serverTools = byServer.get(server) ?? [];
			const rows = [
				`✓ ${t("dialog.mcpConnected")} · ${t("dialog.mcpServerCount", { count: String(serverTools.length) })}`,
				"",
				...serverTools.map((tool) => `  ${tool}`)
			];
			await this.showDialog(new ListDialog(t("dialog.mcpDetailTitle", { server }), rows, this.theme));
		}
	}
	/** /preset: preset picker; /preset <id>: apply directly. Applies to the next session. */
	pickPreset(argument) {
		if (argument !== "") {
			if (PRESET_MODES.find((p) => p.id === argument) === void 0) {
				this.driver.model.pushNotice(`· unknown preset ${argument} (available: ${PRESET_MODES.map((p) => p.id).join(", ")})`, "error");
				return;
			}
			this.applyPresetSelection(argument);
			return;
		}
		const current = this.pendingPreset ?? this.preset;
		const picker = new PickerDialog(t("dialog.presetTitle"), PRESET_MODES.map((p) => ({
			value: p.id,
			label: `${p.id === current ? "● " : ""}${p.id}`,
			description: p.zh
		})), this.theme, () => this.tui.requestRender(), "↑↓ move · enter select · esc cancel", 8);
		this.showDialog(picker).then((selected) => {
			if (selected === void 0) {
				this.driver.model.pushNotice(t("notice.presetCancelled"));
				return;
			}
			this.applyPresetSelection(selected);
		});
	}
	/** Update one persisted setting and write the file; failures surface as a notice. */
	persistSetting(key, value) {
		this.settings = {
			...this.settings,
			[key]: value
		};
		saveTuiSettings(this.settings).catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			this.log.debug(`settings save failed: ${message}`);
			this.driver.model.pushNotice(t("notice.settingsSaveFailed"), "error");
		});
	}
	applyPresetSelection(id) {
		if (id === (this.pendingPreset ?? this.preset)) {
			this.persistSetting("preset", id);
			this.driver.model.pushNotice(t("notice.presetStays", { preset: id }));
			return;
		}
		this.pendingPreset = id;
		this.driver.setPreset(id);
		this.persistSetting("preset", id);
		this.driver.model.pushNotice(t("notice.presetChange", { preset: id }));
	}
	/** /cwd with no argument shows the directory; with one it changes it. */
	async dispatchCwd(path) {
		if (path === "") {
			this.driver.model.pushNotice(`· cwd ${this.driver.workingDirectory()}`);
			return;
		}
		try {
			const resolved = await this.driver.setWorkingDirectory(path);
			this.driver.model.pushNotice(`· cwd → ${resolved}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.driver.model.pushNotice(`· cwd change failed: ${message.slice(0, 140)}`, "error");
		}
	}
	/** Discard the active conversation view and return to the lazy state; the
	*  old session stays in /session, and the next message starts a new one. */
	async startNewSession() {
		const model = this.driver.model;
		try {
			await this.driver.dispose();
		} catch (error) {
			this.log.debug(`driver dispose failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		model.reset();
		this.driver = await createDriver(this.ctx, model, {
			resume: void 0,
			preset: this.pendingPreset ?? this.preset,
			model: this.pendingModel,
			lazy: true
		});
		this.refreshCommandAutocomplete();
		model.pushNotice(t("notice.newSessionStarted"));
	}
	/** Overlay picker over stored sessions; switching rebuilds the driver on the target. */
	async pickSession() {
		if (this.driver.running) {
			this.driver.model.pushNotice("· interrupt the running turn first (esc)");
			return;
		}
		const query = this.ctx.get("sessionQuery");
		if (query === void 0) {
			this.driver.model.pushNotice("· sessionQuery service unavailable", "error");
			return;
		}
		let records = (await query.listSessions()).filter((record) => record.header.cwd !== void 0 && samePath(record.header.cwd, process$1.cwd()) && record.header.origin !== "subagent");
		const workspaceRegistry = this.ctx.get("workspaceRegistry");
		if (workspaceRegistry !== void 0) {
			const archived = new Set(workspaceRegistry.archivedSessionIds ?? []);
			records = records.filter((record) => !archived.has(String(record.header.id)));
		}
		const currentId = this.driver.hasAgent ? String(this.driver.session?.id ?? "") : "";
		if (records.length > 0) {
			const started = await Promise.all(records.map(async (record) => {
				const id = String(record.header.id);
				if (id === currentId) return true;
				try {
					return (await query.listEvents(id)).some((event) => event.type === "turn/start");
				} catch {
					return true;
				}
			}));
			records = records.filter((_, index) => started[index] === true);
		}
		if (records.length === 0) {
			this.driver.model.pushNotice(`· no stored sessions in ${truncate(process$1.cwd(), 60)}`);
			return;
		}
		const titles = /* @__PURE__ */ new Map();
		try {
			const observations = await query.readTitleSnapshots(records.map((record) => record.header.id));
			for (const entry of observations) {
				const observation = entry;
				if (observation.status !== "fulfilled") continue;
				const title = observation.value?.title?.title;
				if (typeof observation.sessionId === "string" && typeof title === "string" && title !== "") titles.set(observation.sessionId, title);
			}
		} catch {}
		const workspace = process$1.cwd();
		const options = [];
		records.forEach((record) => {
			const id = String(record.header.id);
			const isCurrent = id === currentId;
			const title = titles.get(id);
			const shortId = `${id.slice(0, 13)}…`;
			const label = `${isCurrent ? "● " : ""}${title === void 0 ? shortId : truncate(title, 36)}`;
			const parts = [record.live ? "live" : "stored", relativeTime(record.header.createdAt)];
			options.push({
				value: id,
				label,
				...parts.length === 0 ? {} : { description: parts.join(" · ") }
			});
		});
		const dialog = new QuestionDialog({ questions: [{
			id: "session",
			question: t("dialog.sessionTitle", { workspace: truncate(workspace, 40) }),
			options: options.map((option) => ({
				label: option.label,
				...option.description === void 0 ? {} : { description: option.description }
			}))
		}] }, this.theme);
		const selected = (await this.showDialog(dialog)).answers[0]?.selected[0];
		if (selected === void 0) {
			this.driver.model.pushNotice(t("notice.sessionCancelled"));
			return;
		}
		const chosen = options.find((option) => option.label === selected);
		if (chosen === void 0 || chosen.value === currentId) {
			this.driver.model.pushNotice(t("notice.sessionStays"));
			return;
		}
		await this.switchSession(chosen.value);
	}
	/** Retire the current agent, reset the model, and resume the target session. */
	async switchSession(sessionId) {
		const model = this.driver.model;
		try {
			await this.driver.dispose();
		} catch (error) {
			this.log.debug(`driver dispose failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		model.reset();
		try {
			this.driver = await createDriver(this.ctx, model, {
				resume: sessionId,
				preset: this.pendingPreset ?? this.preset,
				model: this.pendingModel
			});
			this.refreshCommandAutocomplete();
			this.driver.model.pushNotice(`· switched to session ${sessionId.slice(0, 13)}…`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log.debug(`session resume failed: ${message}`);
			this.driver = await createDriver(this.ctx, model, {
				resume: void 0,
				preset: this.pendingPreset ?? this.preset,
				model: this.pendingModel
			});
			this.refreshCommandAutocomplete();
			this.driver.model.pushNotice(`· resume failed; started a fresh session (${message.slice(0, 100)})`, "error");
		}
	}
	/** Overlay picker over the permission-presets catalog; runs /permission <value>. */
	async pickPermissionPreset() {
		if (!this.driver.hasAgent) {
			this.driver.model.pushNotice(t("notice.needFirstMessage"));
			return true;
		}
		const presets = this.ctx.get("permissionPresets");
		if (presets === void 0) {
			this.driver.model.pushNotice(t("notice.permissionServiceUnavailable"), "error");
			return true;
		}
		let current;
		let options;
		try {
			current = presets.current(this.driver.agent.session);
			options = presets.catalog().options.filter((option) => option.value !== "custom").map((option) => ({
				value: option.value,
				label: permissionDisplayName(option.value, option.name),
				...option.description === void 0 ? {} : { description: option.description }
			}));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.driver.model.pushNotice(t("notice.permissionCatalogFailed", { message: message.slice(0, 140) }), "error");
			return true;
		}
		const dialog = new QuestionDialog({ questions: [{
			id: "preset",
			question: t("dialog.permissionTitle", { preset: permissionDisplayName(current) }),
			options: options.map((option) => ({
				label: option.label,
				...option.description === void 0 ? {} : { description: option.description }
			}))
		}] }, this.theme);
		const label = (await this.showDialog(dialog)).answers[0]?.selected[0];
		if (label === void 0) {
			this.driver.model.pushNotice(t("notice.permissionCancelled"));
			return true;
		}
		const chosen = options.find((option) => option.label === label);
		if (chosen === void 0 || chosen.value === current) {
			this.driver.model.pushNotice(t("notice.permissionStays", { name: permissionDisplayName(current) }));
			return true;
		}
		return this.dispatchCommand(`/permission ${chosen.value}`);
	}
	/** Slash-command dispatch: TUI-local commands plus the runtime registry. */
	wireCommands() {
		this.refreshCommandAutocomplete();
		this.disposers.push(this.ctx.on("commands/change", () => {
			this.refreshCommandAutocomplete();
		}));
	}
	userSkills = [];
	skillsRefreshed = false;
	refreshCommandAutocomplete() {
		const commands = this.ctx.get("commands");
		const paletteItems = [
			{
				name: "exit",
				description: "quit the TUI",
				aliases: ["quit"]
			},
			{
				name: "clear",
				description: "clear the transcript view"
			},
			{
				name: "session",
				description: "list stored sessions and switch to one",
				aliases: ["resume", "sessions"]
			},
			{
				name: "new",
				description: "start a fresh session (old one stays in /session)"
			},
			{
				name: "preset",
				description: "show or set the agent preset mode (next session)"
			},
			{
				name: "events",
				description: "inspect raw session events"
			},
			{
				name: "model",
				description: "switch provider/model/effort",
				aliases: ["models"]
			},
			{
				name: "thinking",
				description: "switch the reasoning level (off | low | high | max)",
				aliases: ["effort"]
			},
			{
				name: "mcp",
				description: "list connected MCP servers and their tools"
			},
			{
				name: "reload",
				description: "apply profile composition changes (new plugin/MCP rows) without restarting"
			},
			{
				name: "skill",
				description: "browse available skills and inspect their instructions",
				aliases: ["skills"]
			},
			{
				name: "cwd",
				description: "show or change the working directory"
			},
			{
				name: "inbox",
				description: "view and remove queued or steering input"
			},
			{
				name: "fork",
				description: "fork the current session and switch to it"
			},
			{
				name: "expand",
				description: "toggle all tool detail cards"
			},
			{
				name: "todo",
				description: "show the current todo list",
				aliases: ["todos"]
			},
			{
				name: "theme",
				description: "switch color theme (dark/light)"
			},
			{
				name: "language",
				description: "switch UI language",
				aliases: ["lang"]
			},
			{
				name: "export",
				description: "export the transcript as Markdown"
			},
			{
				name: "copy",
				description: "copy an assistant reply to the clipboard"
			}
		];
		if (commands !== void 0 && this.driver.hasAgent) try {
			const descriptors = commands.list(this.driver.agent);
			for (const descriptor of descriptors) paletteItems.unshift({
				name: descriptor.name,
				description: descriptor.description
			});
		} catch (error) {
			this.log.debug(`command list failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		const fdPath = resolveFdPath();
		this.editor.setAutocompleteProvider(new ComposerAutocomplete(new CombinedAutocompleteProvider(paletteItems, process$1.cwd(), fdPath), process$1.cwd(), fdPath, () => this.userSkills, () => paletteItems));
		if (!this.skillsRefreshed) {
			this.skillsRefreshed = true;
			this.refreshUserSkills();
		}
	}
	/** Load the user-invocable skill roster behind the /<skill-name> gesture. */
	async refreshUserSkills() {
		const skills = this.ctx.get("skills");
		if (skills === void 0) return;
		try {
			const discovered = await skills.list({ cwd: process$1.cwd() });
			this.userSkills = discovered.filter((skill) => skill.invocation?.userInvocable === true).map((skill) => ({
				name: skill.name,
				description: skill.description
			}));
			this.refreshCommandAutocomplete();
		} catch (error) {
			this.log.debug(`skill roster failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	/** Dispatch one submitted line; returns true when consumed as a command. */
	async dispatchCommand(line) {
		if (!line.startsWith("/")) return false;
		if (line === "/exit" || line === "/quit") {
			this.finishApp?.(0);
			return true;
		}
		if (line === "/compact") {
			if (!this.driver.hasAgent) {
				this.driver.model.pushNotice(t("notice.needFirstMessage"));
				return true;
			}
			if (this.driver.running) {
				this.compactQueue.request({
					isRunning: () => this.driver.running,
					whenIdle: () => this.driver.agent.whenIdle(),
					dispatch: async () => {
						await this.dispatchCommand("/compact");
					},
					onQueued: () => this.driver.model.pushNotice(t("notice.compactQueued")),
					onDuplicate: () => this.driver.model.pushNotice(t("notice.compactAlreadyQueued")),
					onError: (message) => this.driver.model.pushNotice(t("notice.compactQueueFailed", { message: message.slice(0, 120) }), "error")
				});
				return true;
			}
		}
		if (line === "/clear") {
			this.transcript.invalidate();
			this.driver.model.pushNotice(t("notice.viewCleared"));
			return true;
		}
		if (line === "/session" || line === "/sessions" || line === "/resume") {
			await this.pickSession();
			return true;
		}
		if (line === "/events") {
			const dialog = new EventsDialog(this.driver.model.recent, this.theme);
			await this.showDialog(dialog);
			return true;
		}
		if (line === "/expand") {
			this.driver.model.toggleAllToolDetails();
			return true;
		}
		if (line === "/todo" || line === "/todos") {
			await this.showTodoList();
			return true;
		}
		if (line === "/theme" || line.startsWith("/theme ")) {
			await this.pickTheme(line.slice(6).trim());
			return true;
		}
		if (line === "/language" || line === "/lang") {
			await this.pickLanguage("");
			return true;
		}
		if (line.startsWith("/language ")) {
			await this.pickLanguage(line.slice(10).trim());
			return true;
		}
		if (line.startsWith("/lang ")) {
			await this.pickLanguage(line.slice(5).trim());
			return true;
		}
		if (line === "/export" || line.startsWith("/export ")) {
			await this.exportTranscript(line.slice(7).trim());
			return true;
		}
		if (line === "/copy" || line.startsWith("/copy ")) {
			this.copyAssistantText(line.slice(5).trim());
			return true;
		}
		if (line === "/model" || line === "/models") {
			await this.pickModel();
			return true;
		}
		if (line === "/thinking" || line.startsWith("/thinking ") || line === "/effort" || line.startsWith("/effort ")) {
			const argument = line.startsWith("/thinking") ? line.slice(9).trim() : line.slice(7).trim();
			await this.pickThinking(argument);
			return true;
		}
		if (line === "/mcp") {
			await this.showMcpServers();
			return true;
		}
		if (line === "/reload") {
			await this.reloadComposition();
			return true;
		}
		if (line === "/skill" || line.startsWith("/skill ") || line === "/skills") {
			await this.showSkills(line === "/skills" ? "" : line.slice(7).trim());
			return true;
		}
		if (line === "/inbox") {
			await this.pickInboxMessage();
			return true;
		}
		if (line === "/fork") {
			await this.forkSession();
			return true;
		}
		if (line === "/new") {
			if (this.driver.running) {
				this.driver.model.pushNotice(t("notice.interruptFirst"));
				return true;
			}
			if (!this.driver.hasAgent) {
				this.driver.model.pushNotice(t("notice.alreadyFresh"));
				return true;
			}
			await this.startNewSession();
			return true;
		}
		if (line === "/preset" || line.startsWith("/preset ")) {
			this.pickPreset(line.slice(7).trim());
			return true;
		}
		if (line === "/cwd" || line.startsWith("/cwd ")) {
			await this.dispatchCwd(line.slice(4).trim());
			return true;
		}
		if (line === "/permission" || line === "/permissions") {
			if (!this.driver.hasAgent) {
				this.driver.model.pushNotice(t("notice.needFirstMessage"));
				return true;
			}
			return this.pickPermissionPreset();
		}
		const firstWord = line.split(/\s/)[0] ?? "";
		if (firstWord.length > 1 && this.userSkills.some((skill) => skill.name === firstWord.slice(1))) {
			if (this.driver.running) this.driver.model.pushNotice(t("notice.queued", { text: firstLineOf(line) }));
			this.driver.send(line).then(() => this.refreshCommandAutocomplete()).catch((error) => this.reportSubmitFailure(error));
			return true;
		}
		if (!this.driver.hasAgent) {
			this.driver.model.pushNotice(t("notice.needFirstMessage"));
			return true;
		}
		const commands = this.ctx.get("commands");
		if (commands === void 0) {
			this.driver.model.pushNotice(t("notice.noCommandRegistry"), "error");
			return true;
		}
		try {
			const execution = await commands.execute(this.driver.agent, line, [], new AbortController().signal);
			if (execution === void 0) {
				this.driver.model.pushNotice(t("notice.unknownCommand", { command: line.split(" ")[0] ?? line }), "error");
				return true;
			}
			const result = execution.result;
			if (result.kind === "error") this.driver.model.pushNotice(t("notice.commandFailed", { message: result.text.slice(0, 180) }), "error");
			else if (result.text !== void 0 && result.text !== "") this.driver.model.pushNotice(`· ${result.text.slice(0, 400)}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.driver.model.pushNotice(t("notice.commandFailed", { message: message.slice(0, 180) }), "error");
		}
		return true;
	}
	/** Serializes dialogs so concurrent requests queue instead of stacking. */
	dialogQueue = Promise.resolve();
	wireInteractions(ctx) {
		this.disposers.push(ctx.on("approval/request", (request, next) => this.guardWaterfall("approval", async () => {
			const dialog = new ApprovalDialog(request, this.theme);
			const outcome = await this.showDialog(dialog, "permission");
			this.driver.model.pushNotice(outcome === "allowed-once" ? `· approved ${request.toolName}` : outcome === "rejected" ? `· rejected ${request.toolName}` : `· approval cancelled (${request.toolName})`);
			return outcome;
		}, next)));
		this.disposers.push(ctx.on("user-questions/request", (request, next) => this.guardWaterfall("questions", async () => {
			const dialog = new QuestionDialog({
				questions: request.questions,
				signal: request.signal
			}, this.theme);
			const answer = await this.showDialog(dialog, "question");
			this.driver.model.pushNotice(answer.answers.length === 0 ? "· questions cancelled" : `· answered ${String(answer.answers.length)} question(s)`);
			return answer;
		}, next)));
	}
	/** Degrade waterfall-handler failures to next() instead of a broken chain. */
	async guardWaterfall(label, answer, next) {
		try {
			return await answer();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.log.debug(`${label} dialog failed: ${message}`);
			this.driver.model.pushNotice(`· ui error (${label}): ${message.slice(0, 120)}`, "error");
			return next();
		}
	}
	showDialog(dialog, block = void 0) {
		const run = async () => {
			const handle = this.tui.showOverlay(dialog, {
				width: "100%",
				anchor: "bottom-left",
				margin: 0
			});
			if (block !== void 0) this.driver.setBlocked(block);
			try {
				this.tui.requestRender();
				return await dialog.done;
			} finally {
				handle.hide();
				if (block !== void 0) this.driver.setBlocked(void 0);
				this.tui.renderNow(true);
			}
		};
		const queued = this.dialogQueue.then(run, run);
		this.dialogQueue = queued.catch(() => {});
		return queued;
	}
	/** Last state written on each channel; identical reports never reach the wire. */
	lastProgressActive;
	lastProgramStatus = "";
	wire(model) {
		const render = () => {
			this.header.set(headerLine(model, this.theme), this.driver.busy);
			this.hints.setText(hintsLine(this.driver, this.theme));
		};
		this.header.setOnActiveChange((active) => {
			this.log.debug(`spinner: ${active ? "visible" : "hidden"}`);
		});
		const guard = (action, label) => {
			try {
				action();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.log.debug(`${label} failed: ${message}`);
				try {
					model.pushNotice(`· ui error (${label}): ${message.slice(0, 120)}`, "error");
				} catch {}
			}
		};
		this.disposers.push(model.onChange(() => {
			guard(() => {
				this.transcript.invalidate();
				render();
				this.reportTerminalStatus(this.driver.status);
				this.tui.requestRender();
			}, "render");
		}));
		let lastRunning = false;
		this.disposers.push(this.driver.onStatus((status) => {
			const turnEnded = lastRunning && !status.running;
			lastRunning = status.running;
			guard(() => {
				this.reportTerminalStatus(status);
				render();
				this.tui.requestRender();
				if (turnEnded) this.checkContextPressure();
			}, "status-render");
		}));
		let healTimer;
		this.disposers.push(() => {
			if (healTimer !== void 0) clearTimeout(healTimer);
		});
		this.disposers.push(this.ctx.on("session/event", (session, event) => {
			if (session !== this.driver.session) return;
			if (!shouldHealAfterEvent(String(event.type))) return;
			if (healTimer !== void 0) clearTimeout(healTimer);
			healTimer = setTimeout(() => {
				healTimer = void 0;
				guard(() => {
					this.tui.renderNow(true);
				}, "heal-repaint");
			}, 0);
		}));
		render();
	}
	/**
	* Push the aggregate state to the terminal. OSC 9;4 drives the tab/taskbar
	* indicator and pi-tui re-emits it every second while active, so a dropped
	* edge or a late-attaching observer still converges; OSC 7501 program status
	* adds the states a busy/idle bit cannot express — `blocked` (the turn waits
	* on the user) versus `working`. Terminals that never answer the 7501 support
	* query silently drop those reports.
	*
	* Each channel dedups its own payload: the aggregate also flips on count
	* changes (a second subagent joining) that leave the reported state identical,
	* and a redundant escape is pure noise on a shared byte stream.
	*/
	reportTerminalStatus(status) {
		const terminal = this.tui.terminal;
		const progress = terminalProgressActive(status);
		const payload = !status.busy ? {
			state: "idle",
			app: PROGRAM_STATUS_APP
		} : {
			...status.blocked === void 0 ? { state: "working" } : {
				state: "blocked",
				kind: status.blocked
			},
			app: PROGRAM_STATUS_APP,
			message: sessionTitle(this.driver.model)
		};
		const key = JSON.stringify(payload);
		const writeProgress = progress !== this.lastProgressActive;
		const writeStatus = key !== this.lastProgramStatus;
		if (!writeProgress && !writeStatus) return;
		if (writeProgress) {
			this.lastProgressActive = progress;
			terminal.setProgress(progress);
		}
		if (writeStatus) {
			this.lastProgramStatus = key;
			terminal.setProgramStatus(payload);
		}
		this.log.debug(`status: busy=${String(status.busy)} running=${String(status.running)} maintenance=${String(status.maintenance)} attempts=${String(status.attempts)} subagents=${String(status.subagents)} blocked=${status.blocked ?? "-"} -> ${payload.state}`);
	}
	/** Run until the user quits; resolves with the exit code. */
	async run(initialPrompt, openSessionPicker = false) {
		let settled = false;
		const finish = (code) => {
			if (settled) return;
			settled = true;
			this.finishApp = void 0;
			this.shutdown(code);
		};
		this.finishApp = finish;
		let lastInterrupt = 0;
		this.tui.addInputListener((data) => {
			try {
				if (matchesKey(data, Key.ctrl("q"))) {
					finish(0);
					return { consume: true };
				}
				if (matchesKey(data, Key.ctrl("c"))) {
					if (this.driver.interruptible) {
						this.driver.cancel();
						return { consume: true };
					}
					const now = Date.now();
					if (now - lastInterrupt < 1500) finish(0);
					else {
						lastInterrupt = now;
						this.driver.model.pushNotice("· press ctrl+c again to quit");
					}
					return { consume: true };
				}
				if (matchesKey(data, Key.escape) && this.driver.interruptible) {
					this.driver.cancel();
					return { consume: true };
				}
				if (matchesKey(data, Key.ctrl("l"))) {
					this.tui.renderNow(true);
					return { consume: true };
				}
				if (matchesKey(data, Key.ctrl("o"))) {
					this.driver.model.toggleLastToolDetails();
					return { consume: true };
				}
				if (matchesKey(data, Key.alt("s"))) {
					const text = this.editor.getText().trim();
					if (text !== "") {
						this.submitText(text, true);
						return { consume: true };
					}
				}
				return;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.log.debug(`input handler failed: ${message}`);
				this.driver.model.pushNotice(`· ui error (input): ${message.slice(0, 120)}`, "error");
				return { consume: true };
			}
		});
		this.editor.onSubmit = (text) => {
			const trimmed = text.trim();
			if (trimmed === "") return;
			this.submitText(trimmed, false);
		};
		this.tui.start();
		if (openSessionPicker) await this.pickSession();
		if (initialPrompt !== void 0 && initialPrompt.trim() !== "") this.driver.send(initialPrompt);
		return new Promise((resolve) => {
			this.onShutdown = (code) => {
				resolve({ exitCode: code });
			};
		});
	}
	/** One submission path for Enter (send/queue) and Alt+S (steer). */
	submitText(trimmed, steer) {
		const expanded = expandSkillReferences(trimmed, this.userSkills);
		this.editor.addToHistory(trimmed);
		if (expanded.startsWith("/")) {
			this.dispatchCommand(expanded).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				this.driver.model.pushNotice(`· command failed: ${message.slice(0, 120)}`, "error");
			});
			return;
		}
		if (steer) {
			this.driver.steer(expanded).then(() => {
				this.driver.model.pushNotice(t("notice.steering", { text: firstLineOf(expanded) }));
			}).catch((error) => this.reportSubmitFailure(error));
			return;
		}
		if (detectImagePaths(expanded).length > 0) {
			this.submitWithImages(expanded);
			return;
		}
		if (this.driver.running) this.driver.model.pushNotice(t("notice.queued", { text: firstLineOf(expanded) }));
		this.driver.send(expanded).then(() => this.refreshCommandAutocomplete()).catch((error) => this.reportSubmitFailure(error));
	}
	/** Send one message after admitting its image paths as attachments. */
	async submitWithImages(trimmed) {
		const route = this.driver.route;
		if (await modelAcceptsImages(this.ctx, route.provider, route.model) === false) {
			const capable = await visionCapableModels(this.ctx, route.provider);
			this.driver.model.pushNotice(t("notice.modelNotVision", {
				model: route.model,
				models: capable.length > 0 ? capable.join(", ") : t("notice.modelNotVisionNone")
			}), "error");
			return;
		}
		const { images, missing, failed } = await admitImages(this.ctx, detectImagePaths(trimmed));
		for (const path of missing) this.driver.model.pushNotice(t("notice.imageMissing", { path }), "error");
		for (const failure of failed) this.driver.model.pushNotice(t("notice.imageAdmitFailed", {
			path: failure.path,
			message: failure.message.slice(0, 120)
		}), "error");
		if (images.length === 0) {
			if (this.driver.running) this.driver.model.pushNotice(t("notice.queued", { text: firstLineOf(trimmed) }));
			await this.driver.send(trimmed);
			await this.refreshCommandAutocomplete();
			return;
		}
		const content = [{
			type: "text",
			text: trimmed
		}, ...images.map((image) => ({
			type: "image",
			attachment: image.attachment
		}))];
		for (const image of images) this.driver.model.pushNotice(t("notice.imageAttached", {
			name: image.attachment.name ?? "image",
			width: String(image.attachment.width),
			height: String(image.attachment.height)
		}));
		if (this.driver.running) this.driver.model.pushNotice(t("notice.queued", { text: firstLineOf(trimmed) }));
		await this.driver.send(content);
		await this.refreshCommandAutocomplete();
	}
	reportSubmitFailure(error) {
		const message = error instanceof Error ? error.message : String(error);
		this.log.debug(`submit failed: ${message}`);
		this.driver.model.pushNotice(t("notice.sendFailed", { message: message.slice(0, 120) }), "error");
	}
	/**
	* Post-turn context-pressure hint: measure the live request against the
	* routed model's context window and, when it crosses ~70% once per band,
	* suggest `/compact`. Purely advisory — missing services, unrouted
	* sessions, or measurement failures stay silent.
	*/
	async checkContextPressure() {
		const agent = this.driver.agent;
		if (agent === void 0) return;
		const meter = this.ctx.get("tokenMeter");
		const llm = this.ctx.get("llm");
		if (meter === void 0 || llm === void 0) return;
		try {
			const route = this.driver.route;
			const contextWindow = (await llm.resolveModelInfo(route.provider, route.model)).context;
			if (contextWindow === void 0 || contextWindow <= 0) return;
			const ratio = meter.measure(agent.session).totalTokens / contextWindow;
			if (this.pressureLatch.shouldNotify(ratio)) this.driver.model.pushNotice(t("notice.contextPressure", { percent: String(Math.round(ratio * 100)) }));
		} catch {}
	}
	onShutdown;
	/** Quit request callable shared with command dispatch (/exit, /quit). */
	finishApp;
	/** Defers `/compact` made during a running turn to the next idle boundary. */
	compactQueue = new CompactQueue();
	/** One-shot-per-band latch for the post-turn context-pressure hint. */
	pressureLatch = new PressureLatch(.7, .6);
	async shutdown(code) {
		this.log.debug(`shutdown: begin (code ${String(code)})`);
		const step = (label, action) => {
			return Promise.resolve().then(action).catch((error) => {
				this.log.debug(`shutdown ${label} failed: ${error instanceof Error ? error.message : String(error)}`);
			});
		};
		await step("shield-signals", () => {
			process$1.removeAllListeners("SIGINT");
			process$1.removeAllListeners("SIGTERM");
			process$1.on("SIGINT", () => {
				this.log.debug("sigint shielded during teardown");
			});
			process$1.on("SIGTERM", () => {
				this.log.debug("sigterm shielded during teardown");
			});
		});
		for (const dispose of this.disposers) dispose();
		this.disposers.length = 0;
		await step("stop-spinner", () => {
			this.header.dispose();
		});
		await step("stop-driver", () => {
			this.driver.stop();
		});
		await step("stop-renderer", () => {
			this.tui.stop({ preserveScreen: true });
		});
		await step("print-transcript", () => {
			printTranscriptForScrollback(this.transcript);
		});
		await step("restore-stderr", () => {
			const pending = this.stderr.restore();
			if (pending !== "") process$1.stderr.write(pending);
		});
		await step("flush", async () => {
			await Promise.race([this.driver.flush(), new Promise((resolve) => {
				setTimeout(resolve, 4e3).unref();
			})]);
		});
		await step("clear-progress", () => {
			this.tui.terminal.setProgramStatus({ state: "clear" });
			this.tui.terminal.setProgress(false);
		});
		this.log.debug("shutdown: complete");
		this.onShutdown?.(code);
	}
};
function firstLineOf(text) {
	const line = text.split("\n").find((candidate) => candidate.trim() !== "") ?? "";
	return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}
function terminalProgressActive(status) {
	return status.busy && status.blocked === void 0;
}
/**
* Session events whose settlement marks a window where external processes ran
* (the tool's children, background jobs) and may have written straight to the
* shared console — each one schedules a full-screen repaint that erases the
* stray text the way Ctrl+L does, but automatically.
*/
function shouldHealAfterEvent(eventType) {
	return eventType === "tool/result" || eventType === "turn/end" || eventType === "job/settled";
}
/** Program name reported in OSC 7501; the spec caps it at 32 `[A-Za-z0-9_.+-]` chars. */
const PROGRAM_STATUS_APP = "dsh-tui";
/** Session title, shared by the header and the OSC 7501 message (never prompts or output). */
function sessionTitle(model) {
	return model.title === void 0 ? t("header.newSession") : truncate(model.title, 24);
}
function headerLine(model, theme) {
	const project = basename(process$1.cwd());
	const title = sessionTitle(model);
	const preset = model.preset === void 0 ? "" : ` · ${permissionDisplayName(model.preset)}`;
	const modelRoute = truncate(model.model ?? "", 28);
	const modelSegment = modelRoute === "" ? "" : ` · ${modelRoute}`;
	const tokens = `${model.inputTokens + model.outputTokens}${t("header.tokens")}`;
	return theme.dim(` ${project} · ${title}${preset}${modelSegment} · ${tokens}`);
}
function hintsLine(driver, theme) {
	if (driver.running) return theme.dim(t("hint.running"));
	if (driver.busy) return theme.dim(t("hint.background"));
	return theme.dim(t("hint.idle"));
}
/** Human-readable effort label: the catalog display name, else the capitalized id. */
function displayEffort(effort) {
	if (effort.name !== "") return effort.name;
	return effort.id === "" ? effort.id : `${effort.id[0].toUpperCase()}${effort.id.slice(1)}`;
}
function truncate(text, max) {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
/** Copy helper: the n-th latest assistant text via OSC 52 clipboard write. */
function osc52Copy(text) {
	const payload = Buffer.from(text, "utf8").toString("base64");
	process$1.stdout.write(`\x1b]52;c;${payload}\x07`);
}
/** Markdown export of one transcript. */
function renderTranscriptMarkdown(model, sessionId) {
	const lines = [
		`# ${model.title === void 0 ? "dsh-tui transcript" : model.title}`,
		"",
		`> session \`${sessionId}\` · model ${model.model ?? "(default)"} · ${model.inputTokens + model.outputTokens} tokens · exported ${(/* @__PURE__ */ new Date()).toISOString()}`,
		""
	];
	for (const item of model.items) switch (item.kind) {
		case "user":
			lines.push("## ❯ user", "", item.text, "");
			for (const image of item.images ?? []) lines.push(`> 🖼 ${image.name} · ${String(image.width)}×${String(image.height)}`, "");
			break;
		case "assistant":
			lines.push("## assistant", "");
			if (item.reasoning !== "") lines.push("<details><summary>reasoning</summary>", "", item.reasoning, "", "</details>", "");
			if (item.text !== "") lines.push(item.text, "");
			if (item.usage !== void 0) lines.push(`> ${String(item.usage.inputTokens)} in / ${String(item.usage.outputTokens)} out tokens`, "");
			break;
		case "tool": {
			const headline = item.resultView !== void 0 || item.callView !== void 0 ? item.name : `${item.name} ${item.argDigest}`;
			lines.push(`**tool** \`${headline}\`${item.status === "error" ? " *(error)*" : ""}`);
			if (item.resultDigest !== void 0) lines.push("", "```text", item.resultDigest, "```");
			lines.push("");
			break;
		}
		case "notice":
			lines.push(`> ${item.text.replace(/^·\s*/, "")}`, "");
			break;
		case "banner": lines.push("```text", ...LOGO_ROWS, "```", `${item.version} · ${item.title} — ${item.subtitle}`, `> ${item.info}`, "");
	}
	return `${lines.join("\n")}\n`;
}
/** Startup banner: the DeepSeek whale, brand block, current route, first hints. */
function pushWelcome(model, driver) {
	const version$1 = version;
	model.pushBanner(t("welcome.version", { version: version$1 }), t("welcome.title"), t("welcome.subtitle"), t("welcome.line", { route: `${driver.route.provider}/${driver.route.model}` }));
	model.pushNotice(t("welcome.contact"));
}
/** Compact relative time for the session picker. */
function relativeTime(createdAtMs) {
	const deltaSeconds = Math.max(0, Math.floor((Date.now() - createdAtMs) / 1e3));
	if (deltaSeconds < 60) return `${String(deltaSeconds)}s ago`;
	if (deltaSeconds < 3600) return `${String(Math.floor(deltaSeconds / 60))}m ago`;
	if (deltaSeconds < 86400) return `${String(Math.floor(deltaSeconds / 3600))}h ago`;
	return `${String(Math.floor(deltaSeconds / 86400))}d ago`;
}
/** Case-insensitive, separator-normalized path equality for cwd scoping. */
function samePath(left, right) {
	const normalize = (value) => {
		const unified = value.replaceAll("/", "\\");
		return process$1.platform === "win32" ? unified.toLowerCase() : value;
	};
	return normalize(left) === normalize(right);
}
/**
* Print the final transcript into the terminal's normal scrollback after the
* alt screen exited (opencode-style exit). Renders from our own view model —
* never through the renderer's stop() print-back (defective with layout
* roots in pi-tui 1.3.0; see docs/render-decision.md).
*/
function printTranscriptForScrollback(transcript) {
	const width = Math.max(40, Math.min(1e3, process$1.stdout.columns ?? 80));
	const lines = transcript.render(width);
	if (lines.length === 0) return;
	process$1.stdout.write(`\n${lines.join("\n")}\n`);
}
//#endregion
export { TuiApp };
