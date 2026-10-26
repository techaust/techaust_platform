// The email templates the system knows (docs/05 §11.1). A plain list in its own file so code that only needs the names (the
// settings schemas, the admin Worker) does not pull in the queue-message schemas and classic zod with them.
export const EMAIL_TEMPLATES = [
  "lead.acknowledgement",
  "lead.alert",
  // M2.4b: the client portal's sign-in link and the staff security emails (ADM-MAIL-01)
  "portal.magic_link",
  "staff.new_device",
  "staff.2fa_change",
  "staff.lockout",
  "staff.lockout_owner",
  // M3.1: the invitation to join the admin (ADM-AUTH-07, ADM-MAIL-01; body in 07-H)
  "staff.invite",
  // M3.2: a reply written on the lead page (ADM-LEAD-06; the starting texts are in 07-I)
  "lead.reply",
  // M4.5: a proposal or estimate sent, its acceptance (to the client and to TecHaust) and the approval emails (07 §8)
  "offer.sent",
  "offer.accepted.client",
  "offer.accepted.staff",
  "offer.declined.staff",
  "approval.requested",
  "approval.decided",
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];
