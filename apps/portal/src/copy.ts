// Every word the M1.6 portal screens show, in one place. PLACEHOLDER COPY (English, India/UK spelling): the lead
// checks it against docs/07 §1.3 (banned phrases) and the §8 magic-link email wording before it is final. The
// sign-in reply never says whether an email belongs to a client (POR-01): one generic sentence for every outcome.
import { RequestError } from "./api.ts";

export const PRODUCT = "Client portal";
export const DOC_TITLE_SUFFIX = "TecHaust client portal";

/** "a minute", "6 minutes", "about an hour": how long a 429 lasts, from `Retry-After`. */
export function waitText(seconds: number | null): string {
  if (!seconds || seconds <= 60) return "a minute";
  if (seconds < 3300) return `${Math.ceil(seconds / 60)} minutes`;
  return "about an hour";
}

export const COPY = {
  loading: "Loading the portal…",
  unreachableTitle: "Couldn't reach the portal",
  unreachableBody: "Check your connection, then reload the page.",
  reload: "Reload",

  signIn: {
    title: "Sign in",
    lede: "There's no password. Enter the email address TecHaust has for you, and we'll send a sign-in link if it can use the portal.",
    label: "Email address",
    submit: "Email me a sign-in link",
    busy: "Requesting a link…",
    empty: "Enter your email address.",
    invalid: "Enter a full email address, like name@example.com.",
    sentTitle: "Request received",
    // The brief's generic sentence (POR-01): true for known and unknown emails alike.
    sent: "If this email can use the portal, we've sent a sign-in link. It works once, for 15 minutes.",
    sentFor: "Requested for",
    sentHelp:
      "Nothing yet? It can take a minute or two. Check your spam folder, and check that this is the address TecHaust has for you.",
    again: "Use a different email address",
    // 07-G §3 (owner-approved, M2.4b): replaces the M1.6 line.
    rateLimited: (wait: string) =>
      `Too many link requests. If a link already arrived, it still works for 15 minutes. Otherwise wait ${wait}, then try again.`,
    rateLimitedMore: "This limit protects your account from misuse.",
    // 07-G §3: the Turnstile check didn't pass (the server's `turnstile_failed`, or no token from the widget in time).
    checkFailed: "We couldn't confirm the check. Please try it again, then request your link.",
  },

  signedOut: "You've signed out.",
  signedOutEverywhere: "You've signed out on every device.",
  sessionEnded: "Your session has ended. Ask for a new sign-in link to carry on.",

  callback: {
    title: "Finish signing in",
    lede: "Continue to open the client portal on this device.",
    submit: "Continue to the portal",
    busy: "Signing in…",
    why: "We ask for this click so that nothing else, such as an email security scanner, can use your link first.",
    // Missing token and 401 `link_invalid` read the same (the server's own words, as a heading and a next step).
    invalidTitle: "This link has expired or was already used",
    invalidBody:
      "Sign-in links work once and expire after 15 minutes. Request a new link and use it straight away.",
    requestNew: "Request a new link",
    rateLimited: (wait: string) =>
      `Too many sign-in attempts from this network. Wait ${wait}, then request a new link.`,
    network: "Couldn't reach the portal. Check your connection and press Continue again.",
  },

  home: {
    signedInAs: "Signed in as",
    laterTitle: "More to come",
    later: (org: string) =>
      `Proposals, invoices and payments for ${org} will appear here in a later update of the portal.`,
    sessionTitle: "Your sign-in",
    signOut: "Sign out",
    signingOut: "Signing out…",
    signOutFailed:
      "Couldn't reach the portal, so you're still signed in. Check your connection and try again.",
    allDevices: "Sign out of all devices",
    allDevicesHint: (org: string) => `Ends your sign-in for ${org} on every phone, tablet and computer.`,
    confirmTitle: "Sign out of all devices?",
    confirmBody: (org: string) =>
      `This ends your portal sign-in for ${org} on every device and browser, including this one. To come back, you'll need a new sign-in link.`,
    confirm: "Sign out of all devices",
    cancel: "Cancel",
  },

  notFound: { title: "Page not found", body: "There's nothing at this address.", home: "Go to the portal" },
  failed: { title: "This page didn't load", body: "Reload the page to try again." },

  network: "Couldn't reach the portal. Check your connection and try again.",
  server: "Something went wrong on our side. Try again in a moment.",
  reference: "Reference",
} as const;

/** What the sign-in form shows after a request: the generic reply, or why nothing was requested. */
export type LinkOutcome =
  | { kind: "sent" }
  | { kind: "rate_limited"; text: string; more: string }
  | { kind: "check_failed"; text: string }
  | { kind: "error"; text: string; requestId: string | null };

/** `undefined`: the request went through (the generic reply); otherwise the error it failed with. */
export function linkOutcome(error?: unknown): LinkOutcome {
  if (error === undefined) return { kind: "sent" };
  if (!(error instanceof RequestError) || error.code === "network")
    return { kind: "error", text: COPY.network, requestId: null };
  if (error.code === "turnstile_failed") return checkFailed();
  if (error.status === 429)
    return {
      kind: "rate_limited",
      text: COPY.signIn.rateLimited(waitText(error.retryAfterS)),
      more: COPY.signIn.rateLimitedMore,
    };
  return { kind: "error", text: COPY.server, requestId: error.requestId };
}

/** The Turnstile check didn't pass: the server said so, or the widget gave no token in time (nothing was sent). */
export function checkFailed(): LinkOutcome {
  return { kind: "check_failed", text: COPY.signIn.checkFailed };
}

/** A simple shape check before sending (the server validates properly): something@something.something. */
export function emailProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return COPY.signIn.empty;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return COPY.signIn.invalid;
  return null;
}
