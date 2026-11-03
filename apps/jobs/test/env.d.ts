// Test-only binding, injected by vitest.config.ts.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}

// Vite's `import.meta.glob`, used by tests that scan the Worker's own sources as text (`query: "?raw"`).
interface ImportMeta {
  glob(
    pattern: string,
    options?: { query?: string; import?: string; eager?: boolean },
  ): Record<string, unknown>;
}
