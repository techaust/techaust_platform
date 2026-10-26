// The portal's offer helpers [POR-04, POR-05, POR-06, ADM-PROP-08, ADM-PROP-10]: the offer link's token (taken from the fragment, never
// left in the address), the list's split, the 07-N words of every API error, and the API client's shapes (the token only in a body).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileNameOf, type OfferItem, offerLinkApi, offersApi, RequestError } from "../api.ts";
import { COPY } from "../copy.ts";
import { N, PENDING } from "../copy-documents.ts";
import {
  dateText,
  errorText,
  isPendingText,
  pdfName,
  splitOffers,
  takeOfferToken,
  titleOf,
} from "./offers.ts";

const TOKEN = "S".repeat(43);

function store(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

describe("the offer link's token [POR-06]", () => {
  it("is read from #t= on /o, and the fragment leaves the address and the history entry at once", () => {
    const replaceState = vi.fn();
    const s = store();
    expect(takeOfferToken({ pathname: "/o", search: "", hash: `#t=${TOKEN}` }, { replaceState }, s)).toBe(
      TOKEN,
    );
    expect(replaceState).toHaveBeenCalledWith(null, "", "/o");
    expect(s.m.get("ta.offer-link")).toBe(TOKEN);
  });
  it("a reload in the same tab finds it again; a token of the wrong shape is no token", () => {
    const replaceState = vi.fn();
    expect(
      takeOfferToken(
        { pathname: "/o", search: "", hash: "" },
        { replaceState },
        store({ "ta.offer-link": TOKEN }),
      ),
    ).toBe(TOKEN);
    expect(
      takeOfferToken({ pathname: "/o", search: "", hash: "#t=short" }, { replaceState }, store()),
    ).toBeNull();
    expect(
      takeOfferToken({ pathname: "/proposals", search: "", hash: `#t=${TOKEN}` }, { replaceState }, store()),
    ).toBeNull();
  });
});

describe("lists", () => {
  const item = (id: string, status: OfferItem["status"]): OfferItem => ({
    id,
    kind: "proposal",
    title: null,
    numberDisplay: "TH/PRP/2627/0001",
    version: 1,
    status,
    total: "₹1.00",
    validUntil: "2026-11-10",
    decidedAt: null,
  });
  it("open ones (and one whose new version is coming) await a decision; the rest are decided, in order", () => {
    const { awaiting, decided } = splitOffers([
      item("a", "sent"),
      item("b", "accepted"),
      item("c", "revised"),
      item("d", "expired"),
      item("e", "viewed"),
      item("f", "declined"),
    ]);
    expect(awaiting.map((o) => o.id)).toEqual(["a", "c", "e"]);
    expect(decided.map((o) => o.id)).toEqual(["b", "d", "f"]);
  });
  it("a document without a title is called by its kind and number; dates read as 06 Oct 2026", () => {
    expect(titleOf(item("a", "sent"))).toBe("Proposal TH/PRP/2627/0001");
    expect(dateText("2026-10-06")).toBe("06 Oct 2026");
    expect(dateText(null)).toBe("");
    expect(pdfName("TH/PRP/2627/0003", 2, "-certificate")).toBe("TH-PRP-2627-0003-v2-certificate.pdf");
    expect(fileNameOf('attachment; filename="TH-PRP-2627-0003-v2.pdf"')).toBe("TH-PRP-2627-0003-v2.pdf");
    expect(fileNameOf(null)).toBeNull();
  });
});

describe("errors in 07-N's words (§7)", () => {
  const e = (status: number, code: string, retry: number | null = null) =>
    new RequestError(status, code, "x", "r", retry);
  it("by code", () => {
    expect(errorText(e(409, "already_accepted"))).toBe("This has already been accepted.");
    expect(errorText(e(409, "expired"))).toBe("This has expired and can't be accepted.");
    expect(errorText(e(409, "superseded"))).toBe("There's a newer version. Open the latest one.");
    expect(errorText(e(409, "certificate_pending"))).toBe(
      "The certificate is still being made. Try again in a minute.",
    );
    expect(errorText(e(400, "name_too_short"))).toBe(N.nameMissing);
    expect(errorText(e(400, "note_required"))).toBe(N.otherMissing);
    expect(errorText(new RequestError(0, "network", "network"))).toBe(COPY.network);
    expect(errorText(e(500, "server"))).toBe(COPY.server);
  });
  it("the lines 07-N doesn't have are pending (shown with their tag)", () => {
    const t = errorText(e(400, "name_too_long"));
    expect(t).toBe(PENDING.nameTooLong);
    expect(isPendingText(t)).toBe(true);
    expect(isPendingText(errorText(e(429, "rate_limited", 120)))).toBe(true);
    expect(isPendingText(N.errors.expired)).toBe(false);
  });
});

describe("the API client", () => {
  afterEach(() => vi.unstubAllGlobals());
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("a link's token goes in the body only, never in the address", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        json(200, { typedName: "A", email: "a@example.test", acceptedAt: 1, fingerprint: "f" }),
      );
    vi.stubGlobal("fetch", fetchFn);
    await offerLinkApi.accept(TOKEN, "doc-1", "Asha Rao");
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/t/offer/accept");
    expect(url).not.toContain(TOKEN);
    expect(JSON.parse(String(init.body))).toEqual({
      token: TOKEN,
      documentId: "doc-1",
      typedName: "Asha Rao",
      agree: true,
    });
  });

  it("a refusal keeps its extra fields (the latest version, who accepted)", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          json(409, { error: { code: "superseded", message: "m" }, request_id: "r", latestId: "doc-2" }),
        ),
    );
    const err = await offersApi.accept("doc-1", "Asha").catch((x: unknown) => x);
    expect(err).toBeInstanceOf(RequestError);
    expect((err as RequestError).code).toBe("superseded");
    expect((err as RequestError).extra.latestId).toBe("doc-2");
  });

  it("a decline sends the note only when there is one", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(json(200, { declined: { reason: "price", at: 1, by: "Sample Contact" } }));
    vi.stubGlobal("fetch", fetchFn);
    await offersApi.decline("doc-1", "price", null);
    expect(JSON.parse(String((fetchFn.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      reason: "price",
    });
  });

  it("a download is a blob with the server's file name; an error answer is the same RequestError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("%PDF", {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment; filename="x-v1.pdf"',
          },
        }),
      ),
    );
    const d = await offersApi.pdf("doc-1");
    expect(d.fileName).toBe("x-v1.pdf");
    expect(await d.blob.text()).toBe("%PDF");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json(409, { error: { code: "pdf_pending", message: "m" } })),
    );
    const err = await offerLinkApi.pdf(TOKEN, "doc-1").catch((x: unknown) => x);
    expect((err as RequestError).code).toBe("pdf_pending");
  });
});
