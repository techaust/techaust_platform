import { createApp } from "./app.ts";
import { mountApi } from "./routes-api.ts";
import { mountFront } from "./routes-front.ts";

// Layer 1 of M5.0: still one Worker (both route sets); layer 2 turns this into the front entry.
const app = createApp((a) => {
  mountFront(a);
  mountApi(a);
});
export default app satisfies ExportedHandler<Env>;
