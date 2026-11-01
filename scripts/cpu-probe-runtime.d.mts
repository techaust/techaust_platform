export const dbClock: { ms: number; statements: number };
export type ProbeD1 = D1LikeDatabase & { sqlite: import("node:sqlite").DatabaseSync };
type D1LikeResult = {
  success: true;
  results: Record<string, unknown>[];
  meta: { changes: number; last_row_id: number; rows_read: number; rows_written: number };
};
type D1LikeStatement = {
  bind(...values: unknown[]): D1LikeStatement;
  first(column?: string): Promise<unknown>;
  all(): Promise<D1LikeResult>;
  run(): Promise<D1LikeResult>;
  raw(options?: { columnNames?: boolean }): Promise<unknown[][]>;
};
type D1LikeDatabase = {
  prepare(sql: string): D1LikeStatement;
  batch(statements: D1LikeStatement[]): Promise<D1LikeResult[]>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
};
export function d1Over(path: string): ProbeD1;
export function r2In(dir: string): {
  head(key: string): Promise<{ key: string; size: number } | null>;
  get(key: string): Promise<{ key: string; size: number; text(): Promise<string> } | null>;
  put(
    key: string,
    value: unknown,
    options?: { onlyIf?: unknown },
  ): Promise<{ key: string; size: number } | null>;
  delete(keys: string | string[]): Promise<void>;
};
export function queueStub(): {
  sent: number;
  send(m: unknown): Promise<void>;
  sendBatch(m: unknown[]): Promise<void>;
};
export function rateLimitStub(): { limit(o: unknown): Promise<{ success: boolean }> };
export function installWorkersStandIns(): void;
