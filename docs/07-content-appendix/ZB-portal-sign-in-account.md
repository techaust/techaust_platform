# 07-ZB: the client portal's sign-in and account lines (M1.6)

Status: **APPROVED by the owner, 2026-10-30** (07-ZA item 13: "approve them as they show today"). Recorded word for word from `apps/portal/src/copy.ts` as it stood that day (final sweep, round 2; P8). Change a line here first, then in the code. Lines in `{braces}` are filled in by the screen. Client-facing.

Lines that already had their own approved source are marked with it; the rest were on screen since M1.6 and are approved by 07-ZA item 13.

## Frame
- Product name in the bar: "Client portal"
- Tab title suffix: "TecHaust client portal"
- Loading: "Loading the portal…"
- Portal unreachable: title "Couldn't reach the portal"; body "Check your connection, then reload the page."; button "Reload"
- How long to wait after too many requests: "a minute" · "{n} minutes" · "about an hour"

## Sign in
- Title: "Sign in"
- Lede: "There's no password. Enter the email address TecHaust has for you, and we'll send a sign-in link if it can use the portal."
- Label: "Email address"
- Button: "Email me a sign-in link"; while sending: "Requesting a link…"
- Empty field: "Enter your email address."
- Not an email address: "Enter a full email address, like name@example.com."
- After the request: title "Request received"; "If this email can use the portal, we've sent a sign-in link. It works once, for 15 minutes."; "Requested for"; "Nothing yet? It can take a minute or two. Check your spam folder, and check that this is the address TecHaust has for you."; "Use a different email address"
- Too many requests (07-G §3): "Too many link requests. If a link already arrived, it still works for 15 minutes. Otherwise wait {wait}, then try again." and "This limit protects your account from misuse."
- The check didn't pass (07-G §3): "We couldn't confirm the check. Please try it again, then request your link."

## Signed out
- "You've signed out."
- "You've signed out on every device."
- "Your session has ended. Ask for a new sign-in link to carry on."

## Finishing sign-in (the link)
- Title: "Finish signing in"
- Lede: "Continue to open the client portal on this device."
- Button: "Continue to the portal"; while working: "Signing in…"
- Why the click: "We ask for this click so that nothing else, such as an email security scanner, can use your link first."
- A used or expired link: title "This link has expired or was already used"; body "Sign-in links work once and expire after 15 minutes. Request a new link and use it straight away."; button "Request a new link"
- Too many attempts: "Too many sign-in attempts from this network. Wait {wait}, then request a new link."
- Network: "Couldn't reach the portal. Check your connection and press Continue again."

## Account
- "Signed in as"
- "More to come"; "Proposals, invoices and payments for {organisation} will appear here in a later update of the portal."
- "Your sign-in"
- "Sign out"; while working: "Signing out…"
- Sign-out failed: "Couldn't reach the portal, so you're still signed in. Check your connection and try again."
- "Sign out of all devices"; hint "Ends your sign-in for {organisation} on every phone, tablet and computer."
- Confirm: title "Sign out of all devices?"; body "This ends your portal sign-in for {organisation} on every device and browser, including this one. To come back, you'll need a new sign-in link."; buttons "Sign out of all devices" and "Cancel"

## Errors and missing pages
- Page not found: title "Page not found"; body "There's nothing at this address."; link "Go to the portal"
- A page that didn't load: title "This page didn't load"; body "Reload the page to try again."
- Network: "Couldn't reach the portal. Check your connection and try again."
- Our side: "Something went wrong on our side. Try again in a moment."
- "Reference" (before a request reference)
