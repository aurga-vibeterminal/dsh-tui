import { Command, Option } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";
//#region src/startup.ts
/**
* dsh-tui startup provider: parses this app's flag family from the launcher's
* immutable argument snapshot and publishes the {@link TUI_STARTUP_SERVICE}
* the runner row injects. Modeled on `@deepseek-ai/dsh-headless/startup`.
* @module dsh-tui/startup
*/
/** Stable Cordis plugin name. */
const name = "tui-startup";
/** Services required before the flags can be parsed. */
const inject = ["cmdlineArgs"];
/** Service provided by this plugin and injected by the TUI runner row. */
const TUI_STARTUP_SERVICE = "tuiStartup";
const PRESET_IDS = [
	"standard",
	"ptc",
	"minimal",
	"cordis"
];
/**
* This app's command: its flags and help text. Fresh per call, so one process
* can parse more than once (tests).
* @returns the commander program without an action.
*/
function tuiCommand() {
	return new Command().name("dsh --profile tui").description("Interactive terminal UI for a DeepSeek Harness agent.").helpOption("-h, --help", "show this help").option("-r, --resume [id]", "resume a session: with an id resume that one; bare -r opens the session picker at startup").option("--preset <id>", "agent preset mode: standard | ptc | minimal | cordis (default: standard)").option("--model <provider/model>", "explicit model route; overrides the profile default").option("--reasoning-effort <id>", "adapter-owned reasoning effort for the selected route").option("--theme <name>", "UI theme name (default: dark)").addOption(new Option("--record <dir>", "dev: record one turn of raw events to <dir> as test fixtures, then exit").hideHelp()).addOption(new Option("--interrupt-after <ms>", "dev: with --record, interrupt the turn after this many milliseconds").hideHelp()).argument("[prompt...]", "initial prompt text; required with --record").addHelpText("after", `
Examples:
  dsh --profile tui                                    start a fresh session
  dsh --profile tui --resume session-…                 continue a stored session
  dsh --profile tui --model deepseek-official/deepseek-flash
`);
}
/**
* Validate and normalize parsed options into startup values.
* @param options - commander's parsed option set.
* @param error - rejects the invocation (commander control-flow error).
* @returns the values the runner consumes.
*/
function valuesFromOptions(options, args, error) {
	const resumeRaw = options.resume;
	let resume;
	const resumePicker = resumeRaw === true;
	if (typeof resumeRaw === "string") {
		resume = resumeRaw;
		if (resume.trim() === "") error("--resume requires a non-empty session id");
	}
	const modelRaw = options.model;
	let model;
	if (modelRaw !== void 0) {
		const separator = modelRaw.indexOf("/");
		const provider = separator <= 0 ? "" : modelRaw.slice(0, separator).trim();
		const modelId = separator < 0 ? "" : modelRaw.slice(separator + 1).trim();
		if (provider === "" || modelId === "") error(`--model expects <provider>/<model>, received ${JSON.stringify(modelRaw)}`);
		model = {
			provider,
			model: modelId
		};
	}
	const preset = options.preset;
	if (preset !== void 0 && !PRESET_IDS.includes(preset)) error(`--preset expects one of ${PRESET_IDS.join(" | ")}, received ${JSON.stringify(preset)}`);
	const reasoningEffort = options.reasoningEffort;
	if (reasoningEffort !== void 0 && reasoningEffort.trim() === "") error("--reasoning-effort requires a non-empty id");
	const theme = options.theme;
	if (theme !== void 0 && theme.trim() === "") error("--theme requires a non-empty name");
	const record = options.record;
	if (record !== void 0 && record.trim() === "") error("--record requires a non-empty output directory");
	const rawInterruptAfter = options.interruptAfter;
	let interruptAfterMs;
	if (rawInterruptAfter !== void 0) {
		const parsed = Number(rawInterruptAfter);
		if (rawInterruptAfter.trim() === "" || !Number.isInteger(parsed) || parsed < 0) error("--interrupt-after expects a non-negative integer milliseconds value");
		interruptAfterMs = parsed;
	}
	if (interruptAfterMs !== void 0 && record === void 0) error("--interrupt-after requires --record");
	const prompt = args.length === 0 ? void 0 : args.join(" ");
	if (prompt !== void 0 && prompt.trim() === "") error("a prompt must contain non-whitespace text");
	if (record !== void 0 && prompt === void 0) error("--record requires a prompt to drive the recorded turn");
	return {
		resume,
		resumePicker,
		model,
		reasoningEffort,
		theme,
		preset,
		prompt,
		record,
		interruptAfterMs
	};
}
/**
* Parse and provide the startup values as an ordinary Cordis service. The
* command's action publishes the values; help and rejections owe the process
* an exit, which `parseCmdline` requests from the launcher.
* @param ctx - plugin context carrying the command line.
*/
function apply(ctx) {
	const program = tuiCommand();
	program.action(() => {
		ctx.provide(TUI_STARTUP_SERVICE, valuesFromOptions(program.opts(), program.args, (message) => program.error(`error: ${message}`)));
	});
	parseCmdline(ctx, program);
}
/**
* Parse an argument snapshot without a Cordis context (unit tests).
* @param argv - raw inner arguments, as `ctx.cmdlineArgs` would return them.
* @returns the parsed startup values.
* @throws commander's control-flow error on help, version, or a rejection.
*/
function parseTuiArgs(argv) {
	const program = tuiCommand().exitOverride();
	let captured;
	program.action(() => {
		captured = valuesFromOptions(program.opts(), program.args, (message) => program.error(`error: ${message}`));
	});
	program.parse([...argv], { from: "user" });
	if (captured === void 0) throw new Error("dsh-tui startup: parse completed without publishing values");
	return captured;
}
//#endregion
export { TUI_STARTUP_SERVICE, apply, inject, name, parseTuiArgs, tuiCommand };
