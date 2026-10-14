# Advisor extension

A client-side implementation of [Claude's advisor-tool pattern](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool) for Pi 1.0.3+. Your normal model remains the executor. It decides when to call the empty-input `advisor` tool, receives strategic guidance from a separate model, then continues working.

The advisor has no tools. It receives the current text context, including system instructions, tool declarations, user messages, assistant messages, and tool results. The assistant message containing the consultation is included. Advisor thinking is not returned to the executor; only advice is returned. Nested usage is included in Pi's session totals.

## Load

From this repository:

```sh
pi -e ./extensions/advisor.ts
```

Or install for all sessions, then restart Pi or run `/reload`:

```sh
mkdir -p ~/.pi/agent/extensions
cp ./extensions/advisor.ts ~/.pi/agent/extensions/advisor.ts
```

It starts enabled and defaults to `anthropic/claude-opus-4-6`. Authenticate that provider through Pi as usual. You can use any chat model/provider in Pi's registry, including OAuth and custom providers. Choose a stronger advisor than your executor when useful; the extension does not change the executor's model.

```text
/advisor status
/advisor model openai-codex/gpt-6-sol
/advisor off
/advisor on
```

Commands apply to the current loaded extension runtime. `/reload` or restarting restores defaults.

## Non-interactive configuration

```sh
pi -e ./extensions/advisor.ts \
  --advisor-model anthropic/claude-opus-4-6 \
  --advisor-max-uses 3 \
  --advisor-max-tokens 4096
```

`PI_ADVISOR_MODEL=provider/model` supplies the default model; the CLI flag overrides it. Model IDs can contain additional slashes after the provider name.

The default budget is three attempted consultations per agent run, reset on the next run. Failed provider calls also consume budget. Output defaults to 4096 tokens including thinking, with a minimum setting of 1024 and a ceiling of the model's output limit. High reasoning is requested through Pi's provider-neutral API. Missing models, invalid settings, provider failures, and empty advice produce failed tool results so the executor can continue without advice. Cancellation propagates to the advisor request.

## Differences from Anthropic's server tool

- Each consultation is a separate client-side model request, using Pi's configured authentication. No Anthropic beta header is needed, and either model can use another provider.
- Advice is visible in the tool result, not encrypted. The advisor uses this extension's system prompt, not Anthropic's private prompt.
- The call cap applies to the entire agent run, not each executor API request. This prevents long tool loops from repeatedly resetting the budget.
- The advisor receives Pi's current context, not archived messages removed by compaction or context editing. Compaction summaries and retained messages are included. Images are represented by omission markers.
- Context is captured through `context_with_system`. Later handlers and Pi's final hidden-tool projection can change what the executor actually receives. The current effective system prompt is supplied separately to handle forced prompt overrides.
- No extra transcript clipping or advisor-side compaction is performed. A transcript that exceeds the advisor's context window fails rather than silently losing context.

The text context is sent to the selected advisor provider. Selecting a different provider therefore shares that context with it. Normal provider charges apply to advisor requests and to advice subsequently read by the executor.

## Tests

`tests/advisor.test.mjs` exercises real in-memory Pi SDK sessions against a local deterministic provider, with no external requests or paid credentials. It covers transcript and prior-result forwarding, tool-free advice, usage, budget enforcement/reset, on/off controls, in-flight cancellation, and provider error/abort results.

```sh
node --test tests/advisor.test.mjs
```

If Pi is installed globally and not resolvable from the repository, set `PI_PACKAGE_ROOT` to its installed `@earendil-works/pi-coding-agent` package directory when running the tests.
