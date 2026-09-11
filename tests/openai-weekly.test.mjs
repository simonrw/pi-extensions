import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import extension, { weeklyStatus } from "../extensions/openai-weekly/index.ts";

const window = (used, seconds = 604800) => ({ used_percent: used, limit_window_seconds: seconds });
const payload = (used) => ({ rate_limit: { primary_window: window(95, 18000), secondary_window: window(used) } });
const token = `test.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.test`;

function setup(t, hasUI = true) {
  const handlers = {};
  const statuses = [];
  const timers = [];
  const cleared = [];
  t.mock.method(globalThis, "setTimeout", (callback, ms) => {
    const timer = { callback, ms, unref() {} };
    timers.push(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer) => cleared.push(timer));
  const ctx = {
    hasUI,
    ui: { setStatus: (key, text) => statuses.push([key, text]) },
    modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey: token } }) },
  };
  extension({ on: (event, handler) => { handlers[event] = handler; } });
  return { handlers, ctx, statuses, timers, cleared };
}

test("weekly percentage and bar use the weekly window, never the five-hour limit", () => {
  assert.equal(weeklyStatus(payload(21)), "OpenAI weekly [████████░░] 79% left");
  assert.equal(weeklyStatus(payload(0)), "OpenAI weekly [██████████] 100% left");
  assert.equal(weeklyStatus(payload(100)), "OpenAI weekly [░░░░░░░░░░] 0% left");
  assert.equal(weeklyStatus({ rate_limit: { primary_window: window(21) } }), weeklyStatus(payload(21)));
  for (const value of [null, {}, { rate_limit: { primary_window: window(21, 18000) } }, ...[null, "21", NaN, -1, 101].map(payload)]) {
    assert.equal(weeklyStatus(value), "OpenAI weekly unavailable");
  }
});

test("refreshes once per minute, recovers after errors, and hides without credentials", async (t) => {
  const { handlers, ctx, statuses, timers, cleared } = setup(t);
  const request = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(options.headers["ChatGPT-Account-Id"], "test-account");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(payload(21));
  });
  handlers.session_start({}, ctx);
  await setImmediate();
  assert.equal(statuses.at(-1)[1], weeklyStatus(payload(21)));
  assert.equal(request.mock.callCount(), 1);
  assert.equal(timers[0].ms, 60_000);

  request.mock.mockImplementation(async () => new Response("Unauthorized", { status: 401 }));
  timers.at(-1).callback();
  await setImmediate();
  assert.equal(statuses.at(-1)[1], "OpenAI weekly unavailable");

  request.mock.mockImplementation(async () => Response.json(payload(30)));
  timers.at(-1).callback();
  await setImmediate();
  assert.equal(statuses.at(-1)[1], weeklyStatus(payload(30)));

  ctx.modelRegistry.getProviderAuth = async () => undefined;
  timers.at(-1).callback();
  await setImmediate();
  assert.equal(statuses.at(-1)[1], undefined);
  assert.equal(request.mock.callCount(), 3);
  handlers.session_shutdown({}, ctx);
  assert.equal(cleared.at(-1), timers.at(-1));
});

test("shutdown aborts in-flight requests and prevents late status updates", async (t) => {
  const { handlers, ctx, statuses, timers } = setup(t);
  let finish;
  let signal;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    signal = options.signal;
    return new Promise((resolve) => { finish = resolve; });
  });
  handlers.session_start({}, ctx);
  await setImmediate();
  handlers.session_shutdown({}, ctx);
  assert.equal(signal.aborted, true);
  finish(Response.json(payload(21)));
  await setImmediate();
  assert.deepEqual(statuses, [["openai-weekly", undefined]]);
  assert.equal(timers.length, 0);
});

test("headless sessions do not resolve credentials or poll", async (t) => {
  const { handlers, ctx, timers } = setup(t, false);
  ctx.modelRegistry.getProviderAuth = () => assert.fail("Unexpected auth resolution");
  handlers.session_start({}, ctx);
  await setImmediate();
  assert.equal(timers.length, 0);
});
