// JSON body validation with the shared zod/mini schemas (@techaust/auth): a bad body is the generic 400.
import { sValidator } from "@hono/standard-validator";
import { BAD_REQUEST, type Ctx, err } from "./context.ts";

export const json = <S extends Parameters<typeof sValidator>[1]>(schema: S) =>
  sValidator("json", schema, (result, c) => (result.success ? undefined : err(c as Ctx, BAD_REQUEST, 400)));
