// A document's state as a client sees it (docs/06 §5.5): icon + text + tone, never colour alone. Sent is info, Viewed
// info outline, Accepted success; Declined, Expired and Revised are neutral and muted.
import { WORDS } from "../copy-documents.ts";
import type { DocStatus } from "../lib/document-view.ts";
import { Archive, CheckCircle, Eye, Send, XCircle } from "./icons.tsx";

const LOOK = {
  sent: { tone: "info", Icon: Send },
  viewed: { tone: "info spill--outline", Icon: Eye },
  accepted: { tone: "success", Icon: CheckCircle },
  declined: { tone: "muted", Icon: XCircle },
  expired: { tone: "muted", Icon: XCircle },
  revised: { tone: "muted", Icon: Archive },
} as const;

export function StatusPill({ status }: { status: DocStatus }) {
  const { tone, Icon } = LOOK[status];
  return (
    <span className={`spill spill--${tone}`}>
      <Icon size={16} />
      {WORDS.status[status]}
    </span>
  );
}
