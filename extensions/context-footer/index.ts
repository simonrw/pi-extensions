import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const formatTokens = (tokens: number | null | undefined): string =>
  tokens == null ? "?" : tokens < 1000 ? String(tokens) : `${Math.round(tokens / 1000)}k`;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setFooter((_tui, theme, footerData) => ({
      invalidate() {},
      render(width) {
        const usage = ctx.getContextUsage();
        const total = usage?.contextWindow ?? ctx.model?.contextWindow;
        const model = ctx.model?.id ?? "no-model";
        const reasoning = ctx.model?.reasoning ? ` • ${ctx.thinkingLevel ?? "off"}` : "";
        const summary = theme.fg("dim", `${formatTokens(usage?.tokens)}/${formatTokens(total)}  ${model}${reasoning}`);
        const statuses = [...footerData.getExtensionStatuses().entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, text]) => text.replace(/[\r\n\t]/g, " "));
        return [truncateToWidth([summary, ...statuses].join("  "), width)];
      },
    }));
  });
}
