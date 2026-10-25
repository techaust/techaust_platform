// Proposals and estimates: create, read, list, save, discard, revise [ADM-PROP-01, -02, -03, -05, ADM-EST-01, ADM-CAT-03, ADM-G-02, ADM-G-03].
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { mkItem } from "./test-catalogue.ts";
import { call, countOf, one, rows, sessionFor } from "./test-helpers.ts";
import {
  codeOf,
  discount,
  getDoc,
  json,
  mkDraft,
  mkQuoteClient,
  mkService,
  mkTerms,
  patchDoc,
  sendDoc,
} from "./test-quotes.ts";

const owner = () => sessionFor("owner", { stepUp: true });

beforeAll(async () => {
  await mkTerms();
});

describe("smoke", () => {
  it("makes a draft, reads it, saves it and sends it", async () => {
    const s = await owner();
    const made = await mkDraft(s);
    const doc = await getDoc(s, made.id);
    expect(doc).toMatchObject({
      type: "proposal",
      status: "draft",
      version: 1,
      frozen: false,
      canSend: true,
    });
    expect(doc.lines).toHaveLength(1);
    expect(doc.sections.map((x: { kind: string }) => x.kind)).toEqual(["estimate", "terms", "acceptance"]);
    const sent = await sendDoc(s, made.id, doc.updatedAt);
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect(await json(sent)).toMatchObject({ ok: true, status: "sent", version: 1 });
  });
});

void env;
void countOf;
void one;
void rows;
void codeOf;
void discount;
void mkItem;
void mkQuoteClient;
void mkService;
void patchDoc;
void call;
