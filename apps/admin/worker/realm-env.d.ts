// realm.test.ts runs the PORTAL Worker's code inside the admin's test pool, with the portal's one secret passed in by the
// test. This only tells the admin's type check that the portal's code may read it.
declare namespace Cloudflare {
  interface Env {
    PORTAL_KEY_PEPPER: string;
  }
}
