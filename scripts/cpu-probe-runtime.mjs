// The stand-ins of the local first-request probe (scripts/cpu-probe.mjs; CPU warm-up task (b)4, 2026-11-01): a D1 over `node:sqlite` that keeps the time it
// spends inside SQLite (D1 runs outside the Worker, so the probe subtracts it), a folder-backed R2, queues and rate limiters that accept everything, and
// the `cloudflare:workers` module. Local only, advisory, never in CI's pass/fail; made-up data only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Milliseconds spent inside SQLite since the last reset (the probe subtracts them: on Workers the query runs in D1, not in the Worker's CPU). */
export const dbClock = { ms: 0, statements: 0, capture: null };

const d1Error = (e) => {
  const err = new Error(`D1_ERROR: ${e?.message ?? String(e)}`);
  err.cause = e;
  return err;
};

/** A bound value as D1 takes it: booleans become 1 or 0; undefined is refused (D1_TYPE_ERROR), as D1 does. */
function bindValue(v) {
  if (v === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return v;
}
/** A row as D1 returns it: a plain object, a blob as an array of numbers. */
function outRow(r) {
  const o = {};
  for (const k of Object.keys(r)) {
    const v = r[k];
    o[k] = v instanceof Uint8Array ? Array.from(v) : v;
  }
  return o;
}

/** A D1Database over one `node:sqlite` file. Only the surface the Workers use: prepare/bind/first/all/run/raw, batch (one transaction) and exec. */
export function d1Over(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  const cache = new Map();
  const prepared = (sql) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const totalChanges = db.prepare("SELECT total_changes() AS t");
  const changesNow = db.prepare("SELECT changes() AS c, last_insert_rowid() AS r");
  /** One statement, synchronously, timed; the D1 result shape. */
  function execOne(sql, params, mode) {
    const t0 = performance.now();
    dbClock.statements++;
    try {
      const s = prepared(sql);
      const hasRows = s.columns().length > 0;
      let rows = [];
      let changes = 0;
      let lastRowId = 0;
      if (hasRows) {
        const before = totalChanges.get().t;
        if (mode === "raw") {
          s.setReturnArrays(true);
          try {
            rows = s.all(...params);
          } finally {
            s.setReturnArrays(false);
          }
        } else rows = s.all(...params).map(outRow);
        if (totalChanges.get().t !== before) {
          const c = changesNow.get();
          changes = c.c;
          lastRowId = c.r;
        }
      } else {
        const r = s.run(...params);
        changes = Number(r.changes);
        lastRowId = Number(r.lastInsertRowid);
      }
      const columns = hasRows ? s.columns().map((c) => c.name) : [];
      dbClock.capture?.push({ sql, params, rows: mode === "raw" ? rows : rows.slice(0, 5), changes });
      return {
        rows,
        columns,
        meta: {
          duration: 0,
          changes,
          last_row_id: lastRowId,
          changed_db: changes > 0,
          rows_read: rows.length,
          rows_written: changes,
          size_after: 0,
          served_by: "cpu-probe",
        },
      };
    } catch (e) {
      throw d1Error(e);
    } finally {
      dbClock.ms += performance.now() - t0;
    }
  }
  class Statement {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...values) {
      return new Statement(this.sql, values.map(bindValue));
    }
    async first(column) {
      const { rows } = execOne(this.sql, this.params, "all");
      const r = rows[0] ?? null;
      if (column === undefined) return r;
      return r === null ? null : (r[column] ?? null);
    }
    async all() {
      const { rows, meta } = execOne(this.sql, this.params, "all");
      return { success: true, results: rows, meta };
    }
    async run() {
      return this.all();
    }
    async raw(options) {
      const { rows, columns } = execOne(this.sql, this.params, "raw");
      return options?.columnNames ? [columns, ...rows] : rows;
    }
  }
  return {
    sqlite: db,
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      const t0 = performance.now();
      db.exec("BEGIN");
      dbClock.ms += performance.now() - t0;
      try {
        const out = statements.map((s) => {
          const { rows, meta } = execOne(s.sql, s.params, "all");
          return { success: true, results: rows, meta };
        });
        const t1 = performance.now();
        db.exec("COMMIT");
        dbClock.ms += performance.now() - t1;
        return out;
      } catch (e) {
        const t2 = performance.now();
        db.exec("ROLLBACK");
        dbClock.ms += performance.now() - t2;
        throw e;
      }
    },
    async exec(sql) {
      const t0 = performance.now();
      try {
        db.exec(sql);
      } catch (e) {
        throw d1Error(e);
      } finally {
        dbClock.ms += performance.now() - t0;
      }
      return { count: 0, duration: 0 };
    },
  };
}

async function bytesOf(value) {
  if (value === null || value === undefined) return new Uint8Array(0);
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  throw new TypeError("cpu-probe R2: unsupported value");
}

/** An R2 bucket kept in a folder (the probe's seed writes the signature image; reads see it in every later process). */
export function r2In(dir) {
  mkdirSync(dir, { recursive: true });
  const file = (key) => join(dir, createHash("sha256").update(key).digest("hex"));
  const object = (key, meta, data) => ({
    key,
    size: meta.size,
    etag: meta.etag,
    httpEtag: `"${meta.etag}"`,
    uploaded: new Date(meta.uploaded),
    httpMetadata: meta.httpMetadata ?? {},
    customMetadata: meta.customMetadata ?? {},
    checksums: {},
    writeHttpMetadata(h) {
      if (meta.httpMetadata?.contentType) h.set("content-type", meta.httpMetadata.contentType);
    },
    ...(data
      ? {
          body: new Response(data).body,
          bodyUsed: false,
          arrayBuffer: async () => data.slice().buffer,
          bytes: async () => data.slice(),
          text: async () => new TextDecoder().decode(data),
          json: async () => JSON.parse(new TextDecoder().decode(data)),
          blob: async () => new Blob([data]),
        }
      : {}),
  });
  const read = (key) => {
    const f = file(key);
    if (!existsSync(f)) return null;
    return { meta: JSON.parse(readFileSync(`${f}.json`, "utf8")), data: new Uint8Array(readFileSync(f)) };
  };
  return {
    async head(key) {
      const r = read(key);
      return r ? object(key, r.meta) : null;
    },
    async get(key) {
      const r = read(key);
      return r ? object(key, r.meta, r.data) : null;
    },
    async put(key, value, options = {}) {
      const data = await bytesOf(value);
      if (options.onlyIf && existsSync(file(key))) return null;
      const meta = {
        size: data.byteLength,
        etag: createHash("md5").update(data).digest("hex"),
        uploaded: Date.now(),
        httpMetadata: options.httpMetadata ?? {},
        customMetadata: options.customMetadata ?? {},
      };
      writeFileSync(file(key), data);
      writeFileSync(`${file(key)}.json`, JSON.stringify(meta));
      return object(key, meta);
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        rmSync(file(k), { force: true });
        rmSync(`${file(k)}.json`, { force: true });
      }
    },
    async list() {
      return { objects: [], truncated: false, delimitedPrefixes: [] };
    },
  };
}

/** A queue producer that accepts every message (nothing is consumed). */
export const queueStub = () => ({
  sent: 0,
  async send() {
    this.sent++;
  },
  async sendBatch(m) {
    this.sent += m.length;
  },
});
export const rateLimitStub = () => ({ limit: async () => ({ success: true }) });

const STUB_MODULE = `
export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
export class WorkflowEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
export class RpcTarget {}
export const env = {};
export function waitUntil() {}
`;
let hooked = false;
/** `cloudflare:workers` (and any other `cloudflare:` module) resolves to small stand-ins; Workers-only globals the code names get stand-ins too. */
export function installWorkersStandIns() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith("cloudflare:")) return { url: `probe-stub:${specifier}`, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith("probe-stub:")) return { format: "module", source: STUB_MODULE, shortCircuit: true };
      return next(url, context);
    },
  });
  if (typeof globalThis.FixedLengthStream === "undefined") {
    globalThis.FixedLengthStream = class FixedLengthStream extends TransformStream {
      constructor(_length) {
        super();
      }
    };
  }
}

const REFUSED = "Disallowed operation called within global scope (cpu-probe: workerd's global-scope rule)";
const refuse = () => {
  throw new Error(REFUSED);
};
/**
 * Runs `load` (a Worker module's import and its start-up) under workerd's global-scope rules, checked in local workerd 1.20261001.1 on 2026-11-02: a Response or
 * a Request WITH a body, `Response.json`, random values, timers and `fetch` are refused, and `Date.now()` reads 0. A bodiless Response or Request, Headers,
 * WebCrypto's `subtle`, Intl and microtasks are allowed. Then lets the start-up's async chain finish (Node's WebCrypto answers on its thread pool; workerd's
 * within the start-up) before restoring the real globals, so a warm-up that would fail at real start-up fails here too.
 */
export async function underGlobalScopeRules(load, settleMs = 150) {
  const saved = {
    Response: globalThis.Response,
    Request: globalThis.Request,
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    fetch: globalThis.fetch,
    now: Date.now,
  };
  const RealResponse = saved.Response;
  const RealRequest = saved.Request;
  globalThis.Response = class Response extends RealResponse {
    constructor(body, init) {
      if (body !== null && body !== undefined) refuse();
      super(body, init);
    }
    static json() {
      return refuse();
    }
  };
  globalThis.Request = class Request extends RealRequest {
    constructor(input, init) {
      if (init?.body !== null && init?.body !== undefined) refuse();
      super(input, init);
    }
  };
  globalThis.setTimeout = refuse;
  globalThis.setInterval = refuse;
  globalThis.fetch = refuse;
  Date.now = () => 0;
  crypto.getRandomValues = refuse;
  crypto.randomUUID = refuse;
  try {
    const mod = await load();
    const until = performance.now() + settleMs;
    while (performance.now() < until) await new Promise((r) => setImmediate(r));
    return mod;
  } finally {
    globalThis.Response = saved.Response;
    globalThis.Request = saved.Request;
    globalThis.setTimeout = saved.setTimeout;
    globalThis.setInterval = saved.setInterval;
    globalThis.fetch = saved.fetch;
    Date.now = saved.now;
    delete crypto.getRandomValues;
    delete crypto.randomUUID;
  }
}
