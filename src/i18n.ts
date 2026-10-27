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
export const AVAILABLE = ['en', 'zh'] as const

/** All locale codes the UI knows about, including reserved (untranslated) ones. */
export const KNOWN = ['en', 'zh', 'ja'] as const

export type Locale = (typeof AVAILABLE)[number]

const en = {
  // welcome & header
  'welcome.title': 'dsh-tui v{version} · opencode-style console for DeepSeek Harness',
  'welcome.line': 'model {route} · type / for commands · ctrl+q quit',
  'welcome.contact': 'development & feedback: dev@vterminal.dev',
  'header.newSession': 'new session',
  'header.tokens': ' tok',
  // hints
  'hint.idle': 'enter send · alt+enter steer · / commands · ctrl+q quit',
  'hint.running': 'enter queue · alt+enter steer · esc interrupt · ctrl+q quit',
  // transcript chrome
  'transcript.thinking': 'thinking… ',
  'transcript.pending': '…',
  'transcript.attemptDiscarded': '· attempt discarded',
  'transcript.turnEnd': '· turn {reason}',
  'transcript.turnError': '· turn error: {message}',
  'transcript.uiError': '· ui error ({label}): {message}',
  'transcript.expandHint': ' · ctrl+o',
  'card.linesCount': ' ({shown}/{total} lines)',
  'card.exit': '  exit {code}',
  'card.signal': '  signal {signal}',
  'card.pathsCount': '  {count} path(s){capped}',
  'card.matchesCount': '  {count} match(es){capped}',
  'card.capped': ' of {total} (capped)',
  // fold notices
  'notice.todos': '· todos {done}/{total} done (/todo)',
  'notice.compacting': '· compacting context…',
  'notice.compacted': '· context compacted',
  'notice.cwdChange': '· cwd → {cwd}',
  'notice.modelChange': '· model → {model}',
  'notice.permissionChange': '· permission → {preset}',
  'notice.subagentStarted': '· subagent started ({provider})',
  'notice.subagentFinished': '· subagent finished ({reason}){preview}',
  // dialogs: approval
  'approval.title': '⚠ approve {tool}',
  'approval.hint': '  y allow once · n or esc reject · ctrl+c cancel',
  // dialogs: questions
  'question.hintMulti': '  space toggle · enter submit{nav} · esc cancel',
  'question.hintSingle': '  enter select{nav} · esc cancel',
  'question.nav': ' · tab question {index}/{total}',
  // dialogs: events / list
  'events.title': 'raw events (last {shown} of {total})',
  'dialog.closeHint': ' esc close',
  'scroll.jumpToEnd': ' ↓ latest ',
  // app: interaction notices
  'notice.queueAgain': '· press ctrl+c again to quit',
  'notice.queued': '(queued: {text})',
  'notice.steering': '(steering: {text})',
  'notice.approved': '· approved {tool}',
  'notice.rejected': '· rejected {tool}',
  'notice.approvalCancelled': '· approval cancelled ({tool})',
  'notice.answered': '· answered {count} question(s)',
  'notice.questionsCancelled': '· questions cancelled',
  // app: command notices
  'notice.viewCleared': '· view cleared (session history intact)',
  'notice.noCommandRegistry': '· no command registry composed',
  'notice.unknownCommand': '· unknown command {command}',
  'notice.commandFailed': '· command failed: {message}',
  'notice.sendFailed': '· send failed: {message}',
  'notice.nothingToCopy': '· nothing to copy yet',
  'notice.copyCount': '· /copy: only {count} assistant message(s)',
  'notice.copied': '· copied {count} chars ({preview}…)',
  'notice.exported': '· exported {count} bytes → {path}',
  'notice.exportFailed': '· export failed: {message}',
  'notice.noTodos': '· no todos recorded',
  'notice.themeStays': '· theme stays {name}',
  'notice.themeChanged': '· theme → {name}',
  'notice.themeCancelled': '· theme picker cancelled',
  'notice.langChanged': '· language → {name}',
  'notice.langStays': '· language stays {name}',
  'notice.langCancelled': '· language picker cancelled',
  'notice.langUnavailable': '· language {name} is reserved but not translated yet; using {fallback}',
  // app: session & model pickers
  'dialog.themeTitle': 'Theme',
  'dialog.presetTitle': 'Agent preset',
  'notice.presetStays': '· preset stays {preset}',
  'notice.presetChange': '· preset → {preset} (applies to the next session — /new)',
  'notice.settingsSaveFailed': '· settings save failed (changes apply to this session only)',
  'dialog.languageTitle': 'Language',
  'dialog.reservedHint': 'reserved · English fallback',
  'dialog.modelTitle': 'Model (current: {route})',
  'dialog.effortTitle': 'Reasoning effort for {model}',
  'dialog.effortCancelled': '· effort picker cancelled; keeping the default',
  'dialog.sessionTitle': 'Switch to session ({workspace})',
  'dialog.permissionTitle': 'Permission preset (current: {preset})',
  'permission.readOnly': 'Read Only',
  'permission.workspaceWrite': 'Workspace Write',
  'permission.fullAccess': 'Full access',
  'permission.auto': 'Auto review',
  'dialog.inboxTitle': 'Remove pending input',
  'notice.modelCancelled': '· model picker cancelled',
  'notice.modelSwitchFailed': '· model switch failed: {message}',
  'notice.permissionStays': '· permission stays {name}',
  'notice.permissionCatalogFailed': '· permission catalog failed: {message}',
  'notice.permissionCancelled': '· preset picker cancelled',
  'notice.inboxEmpty': '· inbox empty',
  'notice.inboxCancelled': '· inbox picker cancelled',
  'notice.removed': '· removed {text}',
  'notice.removeFailed': '· remove failed (already claimed?)',
  'notice.sessionEmpty': '· no stored sessions in {cwd}',
  'notice.sessionCancelled': '· session picker cancelled',
  'notice.sessionStays': '· staying on the current session',
  'notice.sessionSwitched': '· switched to session {id}',
  'notice.resumeFailed': '· resume failed; started a fresh session ({message})',
  'notice.forkFailed': '· fork failed: {message}',
  'notice.interruptFirst': '· interrupt the running turn first (esc)',
  'notice.cwdNow': '· cwd {cwd}',
  'notice.cwdChangeFailed': '· cwd change failed: {message}',
  'notice.llmUnavailable': '· llm service unavailable',
  'notice.noModels': '· no models advertised',
  'notice.catalogFailed': '· model catalog failed: {message}',
  'notice.modelChangedNotice': '· model → {route}{effort}',
  'notice.needFirstMessage': '· send your first message to start the session',
  'notice.alreadyFresh': '· already in a fresh session (nothing to discard)',
  'notice.newSessionStarted': '· new session started — the previous one remains in /session',
  'notice.agentError': '· error: {message}',
  'notice.permissionServiceUnavailable': '· permission-presets service unavailable',
} as const

export type MessageKey = keyof typeof en

const tables: Record<Locale, Record<string, string>> = {
  en,
  zh: {
    'welcome.title': 'dsh-tui v{version} · DeepSeek Harness 的 opencode 风格终端控制台',
    'welcome.line': '模型 {route} · 输入 / 查看命令 · ctrl+q 退出',
    'welcome.contact': '开发与反馈：dev@vterminal.dev',
    'header.newSession': '新会话',
    'header.tokens': ' tokens',
    'hint.idle': 'enter 发送 · alt+enter 转向 · / 命令 · ctrl+q 退出',
    'hint.running': 'enter 排队 · alt+enter 转向 · esc 中断 · ctrl+q 退出',
    'transcript.thinking': '思考中… ',
    'transcript.pending': '…',
    'transcript.attemptDiscarded': '· 本次尝试已丢弃',
    'transcript.turnEnd': '· 回合结束（{reason}）',
    'transcript.turnError': '· 回合出错：{message}',
    'transcript.uiError': '· 界面错误（{label}）：{message}',
    'transcript.expandHint': ' · ctrl+o',
    'card.linesCount': '（{shown}/{total} 行）',
    'card.exit': '  退出码 {code}',
    'card.signal': '  信号 {signal}',
    'card.pathsCount': '  {count} 个路径{capped}',
    'card.matchesCount': '  {count} 处匹配{capped}',
    'card.capped': ' / 共 {total}（已截断）',
    'notice.todos': '· 任务 {done}/{total} 已完成（/todo）',
    'notice.compacting': '· 正在压缩上下文…',
    'notice.compacted': '· 上下文已压缩',
    'notice.cwdChange': '· 工作目录 → {cwd}',
    'notice.modelChange': '· 模型 → {model}',
    'notice.permissionChange': '· 权限预设 → {preset}',
    'notice.subagentStarted': '· 子代理已启动（{provider}）',
    'notice.subagentFinished': '· 子代理已结束（{reason}）{preview}',
    'approval.title': '⚠ 批准 {tool}',
    'approval.hint': '  y 允许一次 · n 或 esc 拒绝 · ctrl+c 取消',
    'question.hintMulti': '  space 切换 · enter 提交{nav} · esc 取消',
    'question.hintSingle': '  enter 选择{nav} · esc 取消',
    'question.nav': ' · tab 第 {index}/{total} 题',
    'events.title': '原始事件（最近 {shown}/{total} 条）',
    'dialog.closeHint': ' esc 关闭',
    'scroll.jumpToEnd': ' ↓ 最新 ',
    'notice.queueAgain': '· 再按一次 ctrl+c 退出',
    'notice.queued': '（已排队：{text}）',
    'notice.steering': '（转向：{text}）',
    'notice.approved': '· 已批准 {tool}',
    'notice.rejected': '· 已拒绝 {tool}',
    'notice.approvalCancelled': '· 审批已取消（{tool}）',
    'notice.answered': '· 已回答 {count} 个问题',
    'notice.questionsCancelled': '· 问题已取消',
    'notice.viewCleared': '· 视图已清空（会话历史保留）',
    'notice.noCommandRegistry': '· 未挂载命令注册表',
    'notice.unknownCommand': '· 未知命令 {command}',
    'notice.commandFailed': '· 命令失败：{message}',
    'notice.sendFailed': '· 发送失败：{message}',
    'notice.nothingToCopy': '· 暂无可复制内容',
    'notice.copyCount': '· /copy：只有 {count} 条助手消息',
    'notice.copied': '· 已复制 {count} 字符（{preview}…）',
    'notice.exported': '· 已导出 {count} 字节 → {path}',
    'notice.exportFailed': '· 导出失败：{message}',
    'notice.noTodos': '· 尚无任务记录',
    'notice.themeStays': '· 主题保持 {name}',
    'notice.themeChanged': '· 主题 → {name}',
    'notice.themeCancelled': '· 已取消主题选择',
    'notice.langChanged': '· 语言 → {name}',
    'notice.langStays': '· 语言保持 {name}',
    'notice.langCancelled': '· 已取消语言选择',
    'notice.langUnavailable': '· 语言 {name} 尚未翻译，暂用 {fallback}',
    'dialog.themeTitle': '主题',
    'dialog.languageTitle': '语言',
    'dialog.reservedHint': '预留 · 回退英文',
    'dialog.presetTitle': '智能体预设',
    'notice.presetStays': '· 预设保持 {preset}',
    'notice.presetChange': '· 预设 → {preset}（对下一个会话生效 —— /new）',
    'notice.settingsSaveFailed': '· 设置保存失败（改动仅本次会话生效）',
    'dialog.modelTitle': '模型（当前：{route}）',
    'dialog.effortTitle': '{model} 的推理力度',
    'dialog.effortCancelled': '· 已取消力度选择，保留默认',
    'dialog.sessionTitle': '切换会话（{workspace}）',
    'dialog.permissionTitle': '权限预设（当前：{preset}）',
    'permission.readOnly': '仅可查看',
    'permission.workspaceWrite': '工作区内修改',
    'permission.fullAccess': '完全权限',
    'permission.auto': '自动审查',
    'dialog.inboxTitle': '移除待处理输入',
    'notice.modelCancelled': '· 已取消模型选择',
    'notice.modelSwitchFailed': '· 模型切换失败：{message}',
    'notice.permissionStays': '· 权限保持 {name}',
    'notice.permissionCatalogFailed': '· 权限目录获取失败：{message}',
    'notice.permissionCancelled': '· 已取消预设选择',
    'notice.inboxEmpty': '· 收件箱为空',
    'notice.inboxCancelled': '· 已取消收件箱选择',
    'notice.removed': '· 已移除 {text}',
    'notice.removeFailed': '· 移除失败（可能已被处理）',
    'notice.sessionEmpty': '· {cwd} 下暂无历史会话',
    'notice.sessionCancelled': '· 已取消会话选择',
    'notice.sessionStays': '· 保持当前会话',
    'notice.sessionSwitched': '· 已切换到会话 {id}',
    'notice.resumeFailed': '· 恢复失败；已开启新会话（{message}）',
    'notice.forkFailed': '· 分叉失败：{message}',
    'notice.interruptFirst': '· 请先中断当前回合（esc）',
    'notice.cwdNow': '· 工作目录 {cwd}',
    'notice.cwdChangeFailed': '· 目录切换失败：{message}',
    'notice.llmUnavailable': '· llm 服务不可用',
    'notice.noModels': '· 未发现可用模型',
    'notice.catalogFailed': '· 模型目录获取失败：{message}',
    'notice.modelChangedNotice': '· 模型 → {route}{effort}',
    'notice.needFirstMessage': '· 发送第一条消息以创建会话',
    'notice.alreadyFresh': '· 已经是新会话（无需丢弃）',
    'notice.newSessionStarted': '· 已开启新会话 —— 之前的会话仍保留在 /session 中',
    'notice.agentError': '· error: {message}',
    'notice.permissionServiceUnavailable': '· 权限预设服务不可用',
  },
}

let current: Locale = 'en'

/** Translate one key with `{param}` interpolation in the active locale. */
export function t(key: string, params?: Record<string, string | number>): string {
  const table = tables[current] ?? en
  const template = table[key] ?? en[key as MessageKey] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match)
}

/** The active locale. */
export function locale(): Locale {
  return current
}

/** Switch the active locale; unknown codes keep the current one. */
export function setLocale(next: string): boolean {
  if ((AVAILABLE as readonly string[]).includes(next)) {
    current = next as Locale
    return true
  }
  return false
}

/** Selectable entries for the /language picker: every known locale, flagged. */
export function knownLocales(): readonly { id: string, label: string, available: boolean }[] {
  return KNOWN.map(id => ({
    id,
    label: LOCALE_LABELS[id] ?? id,
    available: (AVAILABLE as readonly string[]).includes(id),
  }))
}

/** Keys present in `en` but missing from `locale` (empty = complete table). */
export function missingKeys(localeCode: string): string[] {
  const table: Record<string, string> | undefined = tables[localeCode as Locale]
  if (table === undefined) return Object.keys(en)
  return Object.keys(en).filter(key => !(key in table))
}

/** Selectable entries for the /language picker. */
export function availableLocales(): readonly { id: Locale, label: string }[] {
  return AVAILABLE.map(id => ({ id, label: LOCALE_LABELS[id] ?? id }))
}

const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  zh: '中文',
  ja: '日本語 (reserved)',
}

/**
 * Resolve the system locale to a shipped one: detected codes map to their
 * primary language (`zh-CN` → `zh`), and anything without a message table
 * falls back to English.
 */
export function resolveSystemLocale(): Locale {
  const detected = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase()
  const primary = detected.split('-')[0] ?? 'en'
  if ((AVAILABLE as readonly string[]).includes(primary)) return primary as Locale
  return 'en'
}

/** Initialize the default locale from the system (once at boot). */
export function initSystemLocale(): Locale {
  current = resolveSystemLocale()
  return current
}

/** i18n keys carrying the web-parity label per well-known permission value. */
const PERMISSION_LABEL_KEYS: Record<string, string> = {
  'read-only': 'permission.readOnly',
  'workspace-write': 'permission.workspaceWrite',
  'danger-full-access': 'permission.fullAccess',
  auto: 'permission.auto',
}

/**
 * Display name for a permission preset value, matching the web client's
 * labels ("Read Only" / "Workspace Write" / "Full access" / "Auto review",
 * localized). Unknown or profile-configured custom values fall back to the
 * catalog-provided name (or the raw value).
 */
export function permissionDisplayName(value: string, fallback: string = value): string {
  const key = PERMISSION_LABEL_KEYS[value]
  return key === undefined ? fallback : t(key)
}
