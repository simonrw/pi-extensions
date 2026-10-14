import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

// Use Pi's installed SDK without adding a second copy of the host packages.
const hostRoot = process.env.PI_PACKAGE_ROOT ?? dirname(findPackageJSON("@earendil-works/pi-coding-agent", import.meta.url));
const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import(pathToFileURL(join(hostRoot, "dist/index.js")));
const aiRoot = dirname(findPackageJSON("@earendil-works/pi-ai", pathToFileURL(join(hostRoot, "package.json"))));
const { createAssistantMessageEventStream, getCurrentTools } = await import(pathToFileURL(join(aiRoot, "dist/index.js")));

const usage = { input: 12, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 } };

async function createSession(t, { consultations = 1, advisorStopReason = "stop", waitForAbort = false } = {}) {
	const dir = await mkdtemp(join(tmpdir(), "pi-advisor-test-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const requests = [];
	const advisorStarted = Promise.withResolvers();
	let executorTurn = 0;
	const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
	modelRuntime.registerProvider("advisor-test", {
		baseUrl: "http://localhost.invalid",
		apiKey: "local-test-only",
		api: "advisor-test-api",
		models: ["executor", "strategist"].map((id) => ({ id, name: id, reasoning: true, input: ["text"], contextWindow: 200000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })),
		streamSimple(model, context, options) {
			requests.push({ model: model.id, messages: structuredClone(context.messages), tools: getCurrentTools(context.messages), options });
			const stream = createAssistantMessageEventStream();
			queueMicrotask(async () => {
				await options?.onPayload?.({ model: model.id }, model);
				await options?.onResponse?.({ status: 200, headers: new Headers() }, model);
				const isAdvisor = model.id === "strategist";
				if (isAdvisor) {
					advisorStarted.resolve();
					if (waitForAbort && !options.signal.aborted) {
						await new Promise((resolve) => options.signal.addEventListener("abort", resolve, { once: true }));
					}
				}
				const consult = !isAdvisor && executorTurn++ < consultations;
				const stopReason = options?.signal?.aborted ? "aborted" : isAdvisor ? advisorStopReason : consult ? "toolUse" : "stop";
				const message = {
					role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), usage,
					stopReason,
					content: [],
				};
				if (stopReason === "error" || stopReason === "aborted") {
					message.errorMessage = "Local provider failure";
					stream.push({ type: "error", reason: stopReason, error: message });
					stream.end();
					return;
				}
				stream.push({ type: "start", partial: message });
				const text = isAdvisor ? "Check the shutdown invariant, then implement and test it." : consult ? "I need help with the shutdown plan." : "Done.";
				message.content.push({ type: "text", text: "" });
				stream.push({ type: "text_start", contentIndex: 0, partial: message });
				message.content[0].text = text;
				stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
				stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
				if (isAdvisor) message.content.push({ type: "thinking", thinking: "Private advisor reasoning" });
				if (consult) {
					const call = { type: "toolCall", id: `consult-${executorTurn}`, name: "advisor", arguments: {} };
					message.content.push(call);
					stream.push({ type: "toolcall_start", contentIndex: 1, partial: message });
					stream.push({ type: "toolcall_end", contentIndex: 1, toolCall: call, partial: message });
				}
				stream.push({ type: "done", reason: stopReason, message });
				stream.end();
			});
			return stream;
		},
	});
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const resourceLoader = new DefaultResourceLoader({
		cwd: dir, agentDir: dir, settingsManager,
		noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
		additionalExtensionPaths: [fileURLToPath(new URL("../extensions/advisor.ts", import.meta.url))],
		systemPrompt: "Executor instruction: preserve existing public interfaces.",
	});
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	const { session } = await createAgentSession({
		cwd: dir, agentDir: dir, resourceLoader, settingsManager, modelRuntime,
		model: modelRuntime.getModel("advisor-test", "executor"), thinkingLevel: "off",
		tools: ["advisor"], sessionManager: SessionManager.inMemory(dir),
	});
	t.after(() => session.dispose());
	await session.bindExtensions({});
	await session.prompt("/advisor model advisor-test/strategist");
	return { session, requests, advisorStarted: advisorStarted.promise, resetExecutor: () => { executorTurn = 0; } };
}

const toolResults = (session) => session.messages.filter((message) => message.role === "toolResult");

test("executor consults a tool-free advisor with the current transcript and receives advice and usage", async (t) => {
	const { session, requests } = await createSession(t);
	await session.prompt("Build a worker pool with graceful shutdown.");
	const advisor = requests.find((request) => request.model === "strategist");
	assert.ok(advisor);
	assert.deepEqual(advisor.tools, []);
	const quoted = advisor.messages.find((message) => message.role === "user").content;
	assert.match(quoted, /preserve existing public interfaces/);
	assert.match(quoted, /Build a worker pool with graceful shutdown/);
	assert.match(quoted, /I need help with the shutdown plan/);
	assert.match(quoted, /toolsAdded/);
	const result = toolResults(session)[0];
	assert.equal(result.isError, false);
	assert.equal(result.content[0].text, "Check the shutdown invariant, then implement and test it.");
	assert.deepEqual(result.usage, usage);
	assert.equal(session.getLastAssistantText(), "Done.");
});

test("budget prevents a fourth consultation, resets on the next run, and off/on changes tool availability", async (t) => {
	const { session, requests, resetExecutor } = await createSession(t, { consultations: 4 });
	await session.prompt("Plan the worker pool.");
	assert.equal(requests.filter((request) => request.model === "strategist").length, 3);
	const secondAdvisor = requests.filter((request) => request.model === "strategist")[1];
	assert.match(secondAdvisor.messages.find((message) => message.role === "user").content, /Check the shutdown invariant/);
	assert.match(toolResults(session).at(-1).content[0].text, /budget exhausted/);
	resetExecutor();
	await session.prompt("Continue planning.");
	assert.equal(requests.filter((request) => request.model === "strategist").length, 6);
	await session.prompt("/advisor off");
	assert.equal(session.getActiveToolNames().includes("advisor"), false);
	await session.prompt("/advisor on");
	assert.equal(session.getActiveToolNames().includes("advisor"), true);
});

test("aborting the executor cancels the in-flight advisor request", { timeout: 5000 }, async (t) => {
	const { session, requests, advisorStarted } = await createSession(t, { waitForAbort: true });
	const running = session.prompt("Plan the worker pool.");
	await advisorStarted;
	await session.abort();
	await running;
	assert.equal(requests.find((request) => request.model === "strategist").options.signal.aborted, true);
	assert.notEqual(session.getLastAssistantText(), "Done.");
});

for (const advisorStopReason of ["error", "aborted"]) {
	test(`advisor ${advisorStopReason} is a failed tool result and the executor continues`, async (t) => {
		const { session } = await createSession(t, { advisorStopReason });
		await session.prompt("Plan the worker pool.");
		const result = toolResults(session)[0];
		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /Local provider failure/);
		assert.deepEqual(result.usage, usage);
		assert.equal(session.getLastAssistantText(), "Done.");
	});
}
