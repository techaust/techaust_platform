export type TurnstileConfig = {
  vars?: Record<string, string>;
  env?: Record<string, { vars?: Record<string, string> }>;
};
export function siteKeyOf(config: TurnstileConfig, env?: string): string;
export function siteKeyForApp(appDir: URL, env?: string): string;
