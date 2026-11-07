export type CliScope = "local" | "staging" | "production";
export const ADMIN_ORIGINS: Readonly<Record<CliScope, string>>;
export const PRODUCTION_WORD: "PRODUCTION";
export function cliScope(values: { staging?: boolean; production?: boolean }): CliScope;
export function d1Target(scope: CliScope): string[];
export function adminOrigin(scope: CliScope, shiftLocal?: (url: string) => string): string;
export function productionRefusal(env: Record<string, string | undefined>): string;
export function isProductionConfirmed(answer: unknown): boolean;
export function confirmProduction(p: {
  what: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}): Promise<boolean>;
export function requireProductionConfirmation(p: {
  what: string;
  env?: Record<string, string | undefined>;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  exit?: (code: number) => unknown;
  error?: (msg: string) => void;
}): Promise<void>;
export function refuseProductionArgs(argv: readonly string[], tool: string): string;
