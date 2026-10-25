// This package's own type check runs in Node (`types: ["node"]`), without the Workers runtime types. It imports the shapes of the loaded
// document from `@techaust/db/documents`, whose source also names D1's types. These minimal declarations let that file type-check here; they are
// NOT part of any app's program (the jobs and admin Workers have the real, generated types) and nothing at runtime uses them.
declare class D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}
declare class D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
}
interface D1Result<T = unknown> {
  results: T[];
}
