// The signed-in contact's offers (M4.5; POR-04, POR-05, ADM-PROP-07..10, ADM-EST-01): the list of proposals and estimates the organisation
// was sent, one offer with its view, the two downloads, and the decisions. Every query goes through `bound` with the organisation of the
// session (`client_id = ?1`); another organisation's offer is the same 404 as one that does not exist. The body of a decision names only
// what the client types: who they are, which organisation and which address come from the session and the database.
import { Hono } from "hono/tiny";
import { type AppEnv, BAD_REQUEST, type Ctx, err, NOT_FOUND } from "./context.ts";
import {
  acceptOffer,
  certificateDownload,
  declineOf,
  declineOffer,
  listOffers,
  loadOffer,
  nameOf,
  type Principal,
  pdfDownload,
  refuse,
} from "./offer-core.ts";
import { acceptRequest, declineRequest, LIST_QUERY } from "./offer-schemas.ts";
import { scope } from "./scope.ts";
import { json } from "./validate.ts";

const principal = (c: Ctx): Principal => {
  const s = scope(c);
  return { clientId: s.clientId, contactId: s.contactId, sessionId: s.sessionId, link: null, group: null };
};

/** An id the database could not hold is a 404 without a query. */
const idOf = (c: Ctx): string | null => {
  const id = c.req.param("id") ?? "";
  return id.length > 0 && id.length <= 64 ? id : null;
};

export const offers = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rawLimit = c.req.query("limit");
    const after = c.req.query("after") ?? null;
    if (rawLimit !== undefined && !LIST_QUERY.limit.test(rawLimit)) return err(c, BAD_REQUEST, 400);
    if (after !== null && !LIST_QUERY.after.test(after)) return err(c, BAD_REQUEST, 400);
    return c.json(await listOffers(c, principal(c), rawLimit === undefined ? 50 : Number(rawLimit), after));
  })
  .get("/:id", async (c) => {
    const id = idOf(c);
    const found = id ? await loadOffer(c, principal(c), id) : null;
    if (!found) return err(c, NOT_FOUND, 404);
    if (found.viewWrites.length) c.set("after", found.viewWrites);
    return c.json(found.body);
  })
  .get("/:id/pdf", async (c) => {
    const id = idOf(c);
    return id ? pdfDownload(c, principal(c), id) : err(c, NOT_FOUND, 404);
  })
  .get("/:id/certificate", async (c) => {
    const id = idOf(c);
    return id ? certificateDownload(c, principal(c), id) : err(c, NOT_FOUND, 404);
  })
  .post("/:id/accept", json(acceptRequest), async (c) => {
    const id = idOf(c);
    if (!id) return err(c, NOT_FOUND, 404);
    const name = nameOf(c, c.req.valid("json").typedName);
    if (name instanceof Response) return name;
    const r = await acceptOffer(c, principal(c), id, name);
    if (!r.ok) return refuse(c, r.refusal);
    return "record" in r ? c.json(r.record) : err(c, NOT_FOUND, 404);
  })
  .post("/:id/decline", json(declineRequest), async (c) => {
    const id = idOf(c);
    if (!id) return err(c, NOT_FOUND, 404);
    const body = c.req.valid("json");
    const d = declineOf(c, body.reason, body.note);
    if (d instanceof Response) return d;
    const r = await declineOffer(c, principal(c), id, d.reason, d.note);
    if (!r.ok) return refuse(c, r.refusal);
    return "declined" in r ? c.json({ declined: r.declined }) : err(c, NOT_FOUND, 404);
  });
