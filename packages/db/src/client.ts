import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema/index.ts";

/** A typed Drizzle client over a D1 binding (`env.DB`). */
export const createDb = (d1: D1Database) => drizzle(d1, { schema });
export type Db = ReturnType<typeof createDb>;
