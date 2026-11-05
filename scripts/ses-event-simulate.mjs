// Local only (M7.2, run file F): pretends SES published an event for an email the local stack sent, by posting the EventBridge envelope (the recorded shape of the
// SES Developer Guide: `version`, `id`, `detail-type`, `source` aws.ses, `time`, `detail` with `eventType`, `mail.messageId`, `mail.tags.env` and the bounce or
// complaint) to the local jobs Worker's `POST /ses` with the LOCAL token (apps/jobs/.dev.vars, written by `pnpm dev:secrets`). The hook then applies it as it
// would on staging: the email log row moves, a Permanent bounce or a complaint stops the address and rings the owners. Never reaches AWS or anything but localhost.
//
//   node scripts/ses-event-simulate.mjs --type delivery|bounce|complaint --message-id <email_log.ses_message_id> --to <the address> [--bounce-type Permanent|Transient|Undetermined]
//
// The message id and address are in the local `email_log` row (status `sent`; the log transport writes a made-up id). TECHAUST_PORT_OFFSET moves the port as
// `pnpm dev` does. Prints the status and the hook's answer only.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { devPort, portOffset } from "./dev-ports.mjs";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
const type = String(args.type ?? "");
const messageId = String(args["message-id"] ?? "");
const to = String(args.to ?? "").toLowerCase();
const bounceType = String(args["bounce-type"] ?? "Permanent");

function usage() {
  console.error(
    "usage: node scripts/ses-event-simulate.mjs --type delivery|bounce|complaint --message-id <id> --to <address> [--bounce-type Permanent|Transient|Undetermined]",
  );
  process.exit(2);
}
const KINDS = {
  delivery: ["Email Delivered", "Delivery"],
  bounce: ["Email Bounced", "Bounce"],
  complaint: ["Email Complaint Received", "Complaint"],
};
if (
  !Object.hasOwn(KINDS, type) ||
  !/^[\x21-\x7e]{1,128}$/.test(messageId) ||
  !/^[^\s@]+@[^\s@]+$/.test(to) ||
  !["Permanent", "Transient", "Undetermined"].includes(bounceType)
)
  usage();

const vars = readFileSync(new URL("../apps/jobs/.dev.vars", import.meta.url), "utf8");
const token = /^SES_EVENTS_TOKEN=(.+)$/m.exec(vars)?.[1]?.trim();
if (!token) {
  console.error("apps/jobs/.dev.vars has no SES_EVENTS_TOKEN: run `pnpm dev:secrets` first.");
  process.exit(2);
}
const url = `http://localhost:${devPort("jobs", portOffset())}/ses`;
if (!url.startsWith("http://localhost:")) throw new Error("ses-event-simulate posts to localhost only");

const [detailType, eventType] = KINDS[type];
const now = new Date().toISOString();
const detail = {
  eventType,
  mail: {
    timestamp: now,
    source: "TecHaust Technologies <no-reply@techaust.com>",
    messageId,
    destination: [to],
    tags: { env: ["local"], "ses:configuration-set": ["techaust-transactional"] },
  },
};
if (type === "delivery") detail.delivery = { timestamp: now, recipients: [to], smtpResponse: "250 2.0.0 OK" };
if (type === "bounce")
  detail.bounce = {
    bounceType,
    bounceSubType: "General",
    bouncedRecipients: [
      { emailAddress: to, status: "5.1.1", diagnosticCode: "smtp; 550 5.1.1 user unknown" },
    ],
    timestamp: now,
  };
if (type === "complaint")
  detail.complaint = {
    complainedRecipients: [{ emailAddress: to }],
    timestamp: now,
    complaintFeedbackType: "abuse",
  };
const body = JSON.stringify({
  version: "0",
  id: randomUUID(),
  "detail-type": detailType,
  source: "aws.ses",
  account: "000000000000",
  time: now,
  region: "ap-south-1",
  resources: [],
  detail,
});
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8", "x-techaust-ses-token": token },
  body,
});
console.log(`POST /ses ${res.status} ${await res.text()}`);
