// The generated files and their renderers (shared by scripts/build-tokens.ts and the drift test).
import { renderEmailTs, renderPrintCss, renderTailwindTheme, renderTokensCss } from "./render.ts";

export function generatedFiles(): Record<string, string> {
  return {
    "generated/tokens.css": renderTokensCss(),
    "generated/theme.css": renderTailwindTheme(),
    "generated/email.ts": renderEmailTs(),
    "generated/print.css": renderPrintCss(),
  };
}
