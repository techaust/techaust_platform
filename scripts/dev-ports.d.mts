export type DevServer = "web" | "webWorker" | "webE2e" | "admin" | "portal" | "jobs";
export type InspectedServer = "admin" | "portal" | "jobs" | "webWorker" | "webE2e";
export const BASE_PORTS: Readonly<Record<DevServer, number>>;
export const INSPECTOR_BASE: number;
export const OFFSET_STEP: number;
export const MAX_OFFSET: number;
export const ALLOWED_OFFSETS: readonly number[];
export const REPO_ROOT: string;
export function parseOffset(raw: unknown): number;
export function portOffset(env?: Record<string, string | undefined>): number;
export function devPort(name: DevServer, offset?: number): number;
export function localOrigin(name: DevServer, offset?: number): string;
export function inspectorPort(name: InspectedServer, offset?: number): number;
export function isPortFree(port: number, host?: string): Promise<boolean>;
export function freeInspectorPort(
  name: InspectedServer,
  offset?: number,
  isFree?: (port: number) => Promise<boolean>,
): Promise<number | undefined>;
export function portsOf(offset: number): number[];
export function shiftLocalUrl(url: string, offset?: number): string;
export function registryEnv(repoRoot: string, offset?: number): Record<string, string>;
export function devCommand(
  name: DevServer,
  offset?: number,
  repoRoot?: string,
  opts?: { inspector?: number },
): { app: string; bin: [string, string]; args: string[]; env: Record<string, string> };
