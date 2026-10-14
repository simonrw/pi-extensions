# Auto-review extension

Vets every Pi tool call with a separate, small model before execution. Reviews fail closed: denial, timeout, invalid output, missing model, and missing credentials all block the tool.

## Install

For a security-related gate, copy the extension to the user-level directory rather than relying on a project-controlled copy:

```sh
mkdir -p ~/.pi/agent/extensions
cp .pi/extensions/auto-review.ts ~/.pi/agent/extensions/auto-review.ts
```

Then restart Pi, or run `/reload`. The extension starts enabled.

## Commands

```text
/auto status
/auto on
/auto off
/auto model openai/gpt-5-mini
```

Set `PI_AUTO_REVIEW_MODEL=provider/model` before starting Pi to choose the reviewer non-interactively. Without configuration, it tries `openai/gpt-5-mini`, then `google/gemini-2.5-flash`, then fails closed if neither is available.

The reviewer receives the exact tool name/input, working directory, and a clipped transcript of the 12 most recent context messages. It has no tools of its own. A denial is returned to the main agent with an instruction not to work around it.

## Security boundary

This is a probabilistic policy gate, **not a sandbox**. Pi and its extensions retain the full permissions of the Pi process. A malicious or mistaken model can approve a harmful call, and a project-local copy can be changed by the project itself. Use OS/container/VM isolation and least-privilege credentials for a real security boundary.
