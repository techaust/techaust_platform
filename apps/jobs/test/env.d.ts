// Test-only binding, injected by vitest.config.ts.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}

// Vite's `import.meta.glob`, used by tests that scan the Worker's own sources as text.
interface ImportMeta {
  glob(pattern: string, options: { query: "?raw"; import: "default"; eager: true }): Record<string, string>;
}
