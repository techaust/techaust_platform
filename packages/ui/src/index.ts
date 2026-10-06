// @techaust/ui: design tokens (single source: tokens/tokens.json), generated CSS/Tailwind/email/print outputs,
// self-hosted fonts and brand assets. CSS and assets are imported by path, e.g.
//   import "@techaust/ui/theme.css";  import "@techaust/ui/fonts.css";  "@techaust/ui/brand/logo-primary-color.svg"
export { emailTokens } from "../generated/email.ts";
export {
  contrastRatio,
  fontStack,
  luminance,
  resolveColor,
  semanticColors,
  type Theme,
  type Tokens,
  tokens,
} from "./tokens/model.ts";

export const PACKAGE_NAME = "@techaust/ui" as const;
