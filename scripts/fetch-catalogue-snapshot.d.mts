export const SNAPSHOT_SQL: string;
export const DEFAULT_OUT: string;
export type WranglerRun = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error | undefined;
};
export function parseWranglerJson(text: string): unknown;
export function snapshotFromOutput(text: string): { id: string; json: string; sha256: string } | null;
export function runWrangler(): WranglerRun;
export function fetchSnapshot(run?: () => WranglerRun): { id: string; json: string; sha256: string } | null;
export function main(options?: {
  out?: string;
  githubOutput?: string | undefined;
  run?: () => WranglerRun;
  log?: (message: string) => void;
}): { found: false } | { found: true; id: string; sha256: string };
