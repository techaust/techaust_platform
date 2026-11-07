// M6–M7 audit AU61 (review L7): the one capped body reader shared by the gateway clients, the SES client and the Turnstile check [ADM-PAY-02, ADM-MAIL-01,
// FRM-02]. Invented data.
import { describe, expect, it } from "vitest";
import { readBodyCapped, readTextCapped } from "../src/body.ts";

/** A stream of `n` chunks of `size` bytes that records whether it was cancelled and how many chunks were pulled. */
function chunks(n: number, size: number) {
  const seen = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (seen.pulled >= n) {
        c.close();
        return;
      }
      seen.pulled++;
      c.enqueue(new Uint8Array(size).fill(97));
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { stream, seen };
}

describe("readBodyCapped and readTextCapped", () => {
  it("a body up to the cap is read whole, across chunks; no body is empty", async () => {
    expect(await readTextCapped(new Response("abc"), 3)).toBe("abc");
    const { stream } = chunks(3, 4);
    expect(await readBodyCapped({ body: stream }, 12)).toEqual(new Uint8Array(12).fill(97));
    expect(await readTextCapped(new Response(null), 3)).toBe("");
    expect(await readBodyCapped({ body: null, headers: null }, 3)).toEqual(new Uint8Array(0));
    expect(await readTextCapped(new Response("₹"), 3)).toBe("₹");
  });

  it("a declared length over the cap is refused unread (the body cancelled); a streamed one at the chunk that passes it", async () => {
    const declared = chunks(1, 1);
    expect(
      await readBodyCapped({ body: declared.stream, headers: new Headers({ "Content-Length": "99" }) }, 3),
    ).toBeNull();
    expect(declared.seen.cancelled).toBe(true);
    expect(declared.seen.pulled).toBeLessThanOrEqual(1);
    const streamed = chunks(1_000, 4);
    expect(await readTextCapped({ body: streamed.stream }, 10)).toBeNull();
    expect(streamed.seen.cancelled).toBe(true);
    expect(streamed.seen.pulled).toBeLessThan(10);
    expect(await readTextCapped(new Response("abcd"), 3)).toBeNull();
  });

  it("a declared length that isn't a number is ignored (the stream's own size decides); a failing stream rejects", async () => {
    expect(await readTextCapped(new Response("ab", { headers: { "Content-Length": "x" } }), 3)).toBe("ab");
    const broken = new ReadableStream<Uint8Array>({
      pull(c) {
        c.error(new Error("reset"));
      },
    });
    await expect(readBodyCapped({ body: broken }, 3)).rejects.toThrow("reset");
  });
});
