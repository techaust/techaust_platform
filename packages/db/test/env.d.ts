// Test-only binding, injected by vitest.config.ts.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}

// Vite's eager `?raw` glob (the migration files byte for byte, triggers.test.ts and data-protection-triggers.test.ts).
interface ImportMeta {
  glob(pattern: string, options: { query: "?raw"; import: "default"; eager: true }): Record<string, string>;
}

// Files read as text by tests (Vite's `?raw`): the approved copy a seeded text must repeat word for word (seed-terms-v4.test.ts).
declare module "*?raw" {
  const text: string;
  export default text;
}
