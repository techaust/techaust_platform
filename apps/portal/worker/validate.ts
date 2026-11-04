// JSON body validation with the shared zod/mini schemas (@techaust/auth): a bad body is the generic 400.
import { sValidator } from "@hono/standard-validator";
import { BAD_REQUEST, type Ctx, err } from "./context.ts";

export const json = <S extends Parameters<typeof sValidator>[1]>(schema: S) =>
  sValidator("json", schema, (result, c) => (result.success ? undefined : err(c as Ctx, BAD_REQUEST, 400)));

type Issue = { readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined };

/** The top-level body fields the issues name, once each, in their order (an issue on the body itself, such as an unknown key, names none). */
export function fieldsOf(issues: readonly Issue[]): string[] {
  const out: string[] = [];
  for (const i of issues) {
    const head = i.path?.[0];
    const key = typeof head === "object" && head !== null ? head.key : head;
    if (typeof key === "string" && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * As `json`, but the 400 names the refused fields beside the error (review 1, M1: "I've paid" words a refused note apart from a refused reference):
 * `{ error: { code: "bad_request", message }, fields: ["note"], request_id }`. Field names only, never a value.
 */
export const jsonFields = <S extends Parameters<typeof sValidator>[1]>(schema: S) =>
  sValidator("json", schema, (result, c) =>
    result.success
      ? undefined
      : (c as Ctx).json(
          {
            error: { code: BAD_REQUEST.code, message: BAD_REQUEST.message },
            fields: fieldsOf(result.error),
            request_id: (c as Ctx).var.rid,
          },
          400,
        ),
  );
