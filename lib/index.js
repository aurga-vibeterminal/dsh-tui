import process from "node:process";
import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brandString } from "@deepseek-ai/dsh-brand";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
//#region src/recorder.ts
/**
* dsh-tui fixture recorder — dev tooling behind `--record <dir>`.
*
* Drives exactly one real agent turn in-process (the same way the Phase 1
* interactive loop will) and captures the raw surfaces the TUI renders from,
* so component/fold tests run against genuine protocol shapes:
*
* - `events.jsonl`  — every durable `SessionEvent` of the recorded session
* - `stream.jsonl`  — every live `agent/assistant-stream` frame
* - `statuses.jsonl`— every `agent/status` transition (idle/running spinner)
* - `meta.json`     — session identity, prompt, route, counts
*
* Regenerate with `pnpm record <name> "<prompt>"` (tools/record.mjs), which
* points the DeepSeek adapter at dsh-llm-mock-server, so no API key is needed.
* See docs/PLAN.md §8 (testing) and §8.4 (contract tests on dependency bumps).
* @module dsh-tui/recorder
*/
/**
* Run one owned agent turn and write the fixture files.
* @param ctx - plugin context carrying the core services.
* @param options - output directory and the driving prompt.
*/
async function recordFixture(ctx, options) {
	process.stderr.write(`record: fixture run (interruptAfterMs=${String(options.interruptAfterMs)})\n`);
	await ctx.get("loader")?.await();
	const agents = ctx.get("agents");
	const defaultModel = ctx.get("agentDefaultModel");
	const sessions = ctx.get("sessions");
	if (agents === void 0 || defaultModel === void 0 || sessions === void 0) throw new Error("tui-recorder: core services (agents, agentDefaultModel, sessions) are unavailable");
	const selection = defaultModel.currentSelection();
	const agentOptions = {
		provider: selection.provider,
		model: selection.model
	};
	const setup = (agentCtx) => {
		installModelSelection(agentCtx, {
			current: selection,
			assembled: void 0
		});
	};
	const sessionId = brandString(`session-${randomUUID()}`);
	const fs = ctx.get("fs");
	const cwd = fs === void 0 ? process.cwd() : fs.processPath(await fs.resolve("."));
	const { agent } = await agents.create({
		sessionId,
		meta: { cwd },
		agentOptions,
		setup
	});
	await agent.whenIdle();
	const events = [];
	const stream = [];
	const statuses = [];
	const stopEvents = ctx.on("session/event", (session, event) => {
		if (session === agent.session) events.push(event);
	});
	const stopStream = ctx.on("agent/assistant-stream", ({ agent: subject, frame }) => {
		if (subject === agent) stream.push({ frame });
	});
	const stopStatuses = ctx.on("agent/status", ({ agent: subject, status }) => {
		if (subject === agent) statuses.push(status);
	});
	try {
		agent.followup(createUserMessage({
			content: [{
				type: "text",
				text: options.prompt
			}],
			source: { kind: "user" }
		}));
		process.stderr.write("record: prompt sent\n");
		const stopProgress = ctx.on("agent/status", ({ agent: subject, status }) => {
			if (subject === agent) process.stderr.write(`record: status=${status}\n`);
		});
		if (options.interruptAfterMs !== void 0) setTimeout(() => {
			try {
				agent.cancel({ kind: "user" }, { keepInbox: true });
				process.stderr.write("record: cancel requested\n");
			} catch (error) {
				process.stderr.write(`record: cancel threw: ${error instanceof Error ? error.message : String(error)}\n`);
			}
		}, options.interruptAfterMs).unref();
		const subagents = ctx.get("subagents");
		while (true) {
			await agent.whenIdle();
			const idleSeq = agent.session.seq;
			if (!await subagents?.waitForChildren(agent) && agent.status === "idle" && agent.session.seq === idleSeq) break;
		}
		process.stderr.write("record: idle reached\n");
		stopProgress();
	} finally {
		stopEvents();
		stopStream();
		stopStatuses();
	}
	await sessions.flush(agent.session);
	await mkdir(options.outDir, { recursive: true });
	const write = async (name, rows) => {
		const body = rows.map((row) => JSON.stringify(row)).join("\n");
		await writeFile(join(options.outDir, name), `${body}\n`, "utf8");
	};
	await write("events.jsonl", events);
	await write("stream.jsonl", stream);
	await write("statuses.jsonl", statuses);
	await writeFile(join(options.outDir, "meta.json"), `${JSON.stringify({
		sessionId,
		prompt: options.prompt,
		cwd,
		provider: selection.provider,
		model: selection.model,
		reasoningEffort: selection.reasoningEffort,
		recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
		eventCount: events.length,
		frameCount: stream.length,
		statusCount: statuses.length
	}, null, 2)}\n`, "utf8");
}
//#endregion
//#region src/index.ts
/**
* dsh-tui runner — the app plugin.
*
* Two modes, switched by the startup provider's flags:
* - `--record <dir> "<prompt>"` — dev fixture recording (src/recorder.ts).
* - interactive fullscreen session (src/app.ts), the product.
* Both exit through the launcher's `ctx.appExit`.
* @module dsh-tui
*/
/** Stable Cordis plugin name. */
const name = "tui-runner";
/** Services required before the app can run. */
const inject = ["agentDefaultModel"];
const Config = z.object({
	resume: z.string(),
	resumePicker: z.boolean(),
	model: z.string(),
	theme: z.string(),
	prompt: z.string(),
	record: z.string(),
	interruptAfterMs: z.number()
});
/** Split one `provider/model` config string into its route parts. */
function parseModelRoute(raw) {
	const separator = raw.indexOf("/");
	return {
		provider: raw.slice(0, separator),
		model: raw.slice(separator + 1)
	};
}
function apply(ctx, config) {
	const exit = ctx.get("appExit");
	if (exit === void 0) throw new Error("tui-runner: the launcher must provide ctx.appExit before the tree mounts");
	(async () => {
		if (config.record !== void 0) {
			if (config.prompt === void 0 || config.prompt.trim() === "") throw new Error("tui-runner: --record requires a prompt");
			await recordFixture(ctx, {
				outDir: config.record,
				prompt: config.prompt,
				interruptAfterMs: config.interruptAfterMs
			});
			process.stdout.write(`dsh-tui: fixture recorded to ${config.record}\n`);
			exit(0);
			return;
		}
		if (process.stdin.isTTY !== true) throw new Error("tui: an interactive terminal is required (stdin is not a TTY)");
		const { TuiApp } = await import("./app-DLu-SnAG.js");
		const result = await (await TuiApp.create(ctx, {
			resume: config.resume,
			preset: config.preset,
			model: config.model === void 0 ? void 0 : parseModelRoute(config.model),
			theme: config.theme,
			prompt: config.prompt
		})).run(config.prompt, config.resumePicker === true);
		exit(result.exitCode);
	})().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`dsh-tui: ${message}\n`);
		exit(1);
	});
}
//#endregion
export { Config, apply, inject, name };
