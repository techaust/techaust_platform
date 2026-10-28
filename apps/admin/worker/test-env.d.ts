// Test-only bindings injected by vitest.config.ts.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    /** An ISO instant to shift the test clock to (TA_TEST_CLOCK), or "". */
    TEST_CLOCK_AT: string;
  }
}

// Files read as text by tests (Vite's `?raw`): the static headers, index.html and two SPA sources.
declare module "*?raw" {
  const text: string;
  export default text;
}
