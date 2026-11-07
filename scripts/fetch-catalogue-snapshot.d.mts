export const SNAPSHOT_SQL: string;
export const DEFAULT_OUT: string;
export type SnapshotEnv = "staging" | "production";
export const ENVIRONMENTS: SnapshotEnv[];
export type WranglerRun = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error | undefined;
};
export function parseWranglerJson(text: string): unknown;
export function snapshotFromOutput(text: string): { id: string; json: string; sha256: string } | null;
export function envOf(value: string | undefined): SnapshotEnv;
export function wranglerArgs(env?: string): string[];
export function runWrangler(env?: string): WranglerRun;
export function fetchSnapshot(run?: () => WranglerRun): { id: string; json: string; sha256: string } | null;
export function main(options?: {
  out?: string;
  githubOutput?: string | undefined;
  env?: string;
  run?: () => WranglerRun;
  log?: (message: string) => void;
}): { found: false } | { found: true; id: string; sha256: string };
