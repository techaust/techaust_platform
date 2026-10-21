// The signed-in contact's own identity [POR-02, POR-03]. Everything comes from the guard's single session read, so
// this route makes no D1 call of its own (the request's access row, with the session touch when due, is written on
// the way out). It returns only the session's contact and organisation: nothing in the request can name another.
import { Hono } from "hono/tiny";
import type { AppEnv } from "./context.ts";
import { scope } from "./scope.ts";

export const me = new Hono<AppEnv>().get("/", (c) => {
  const s = scope(c);
  const who = c.var.who;
  if (!who) throw new Error("guarded route reached without a session");
  return c.json({
    contact: { name: who.name, email: who.email },
    organisation: { displayName: who.organisation },
    canSeeFinance: s.canSeeFinance,
  });
});
