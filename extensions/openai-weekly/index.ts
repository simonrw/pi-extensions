import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Codex's account-wide usage endpoint, not session token usage.
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_MS = 60_000;

export function weeklyStatus(payload: unknown): string {
  const data = payload as {
    rate_limit?: {
      primary_window?: { limit_window_seconds?: unknown; used_percent?: unknown };
      secondary_window?: { limit_window_seconds?: unknown; used_percent?: unknown };
    };
  } | null;
  const limits = data?.rate_limit;
  // Some plans put the weekly limit in the primary window.
  const weekly = [limits?.primary_window, limits?.secondary_window]
    .find((window) => window?.limit_window_seconds === 7 * 24 * 60 * 60);
  const used = weekly?.used_percent;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > 100) {
    return "OpenAI weekly unavailable";
  }
  const remaining = Math.round(100 - used);
  const filled = Math.round(remaining / 10);
  return `OpenAI weekly [${"█".repeat(filled)}${"░".repeat(10 - filled)}] ${remaining}% left`;
}

export default function(pi: ExtensionAPI) {
  let stop: (() => void) | undefined;
  let cachedStatus: string | undefined;

  function render(ctx: ExtensionContext) {
    if (!ctx.hasUI) return;
    const isOpenAI = ctx.model?.provider === "openai" || ctx.model?.provider === "openai-codex";
    ctx.ui.setStatus("openai-weekly",
      isOpenAI && cachedStatus ? ctx.ui.theme.fg("dim", cachedStatus) : undefined);
  }

  pi.on("model_select", (_event, ctx) => render(ctx));

  pi.on("session_start", (_event, ctx) => {
    stop?.();
    cachedStatus = undefined;
    if (!ctx.hasUI) return;

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    stop = () => {
      controller.abort();
      clearTimeout(timer);
    };

    async function refresh() {
      let status: string | undefined;
      try {
        // Let pi resolve and refresh its own credentials. Never log the token.
        const auth = await ctx.modelRegistry.getProviderAuth("openai-codex");
        if (controller.signal.aborted) return;
        const token = auth?.auth.apiKey;
        if (token) {
          const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
          const accountId = claims?.["https://api.openai.com/auth"]?.chatgpt_account_id;
          if (typeof accountId !== "string" || !accountId) throw new Error("Missing account ID");
          const response = await fetch(USAGE_URL, {
            headers: {
              Authorization: `Bearer ${token}`,
              "ChatGPT-Account-Id": accountId,
              "User-Agent": "codex-cli",
              Accept: "application/json",
            },
            redirect: "error",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          });
          if (!response.ok) throw new Error("Usage request failed");
          status = weeklyStatus(await response.json());
        }
      } catch {
        status = "OpenAI weekly unavailable";
      }
      if (controller.signal.aborted) return;
      cachedStatus = status;
      render(ctx);
      // Schedule after completion so requests never overlap.
      timer = setTimeout(() => void refresh(), REFRESH_MS);
      timer.unref();
    }

    void refresh();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stop?.();
    stop = undefined;
    ctx.ui.setStatus("openai-weekly", undefined);
  });
}
