import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Credential = {
  type?: string;
  access?: string;
  access_token?: string;
  key?: string;
  accountId?: string;
};

function decodeClaims(token: string): Record<string, unknown> | undefined {
  const part = token.split(".")[1];
  if (!part) return;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return;
  }
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("whoami", {
    description: "Show the OpenAI account used by pi",
    handler: async (_args, ctx) => {
      const authPath = join(getAgentDir(), "auth.json");
      let auth: Record<string, Credential>;
      try {
        auth = JSON.parse(readFileSync(authPath, "utf8"));
      } catch {
        ctx.ui.notify(`No pi credentials found at ${authPath}`, "warning");
        return;
      }

      const provider = ["openai-codex", "openai"].find((name) => auth[name]);
      if (!provider) {
        ctx.ui.notify("No OpenAI credential is configured in pi.", "warning");
        return;
      }

      const credential = auth[provider];
      const token = credential.access ?? credential.access_token;
      const claims = token ? decodeClaims(token) : undefined;
      const openaiAuth = claims?.["https://api.openai.com/auth"];
      const identity = openaiAuth && typeof openaiAuth === "object"
        ? openaiAuth as Record<string, unknown>
        : {};
      const profile = claims?.["https://api.openai.com/profile"];
      const email = profile && typeof profile === "object"
        ? (profile as Record<string, unknown>).email
        : claims?.email;
      const values = {
        email: typeof email === "string" ? maskEmail(email) : undefined,
        subject: claims?.sub,
        account_id: identity.chatgpt_account_id ?? credential.accountId,
        user_id: identity.chatgpt_user_id ?? identity.user_id,
        plan: identity.chatgpt_plan_type ?? identity.plan_type,
      };
      const lines = Object.entries(values)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}: ${String(value)}`);

      if (!lines.length) {
        lines.push(credential.type === "api_key"
          ? "API key authentication does not expose a ChatGPT account identity."
          : "The OpenAI credential has no readable identity claims.");
      }
      ctx.ui.notify(`OpenAI (${provider})\n${lines.join("\n")}`, "info");
    },
  });
}
