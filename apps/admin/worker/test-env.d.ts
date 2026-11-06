// Test-only bindings injected by vitest.config.ts.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    /** An ISO instant to shift the test clock to (TA_TEST_CLOCK), or "". */
    TEST_CLOCK_AT: string;
    /** M7.4 (L23): the API Worker's one secret (a made-up value in vitest.config.ts). */
    ERASURE_HASH_KEY: string;
  }
}

// Files read as text by tests (Vite's `?raw`): the static headers, index.html and two SPA sources.
declare module "*?raw" {
  const text: string;
  export default text;
}
