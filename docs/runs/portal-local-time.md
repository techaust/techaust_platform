Status: open (starts after M6.2 merges: M6.2 is changing portal screens)
Tier: C
Usage:

# Portal times in the client's own time zone (2026-11-01)

## Brief (lead, 2026-11-01; to be completed against the merged M6.2 code)
**Owner's decision (2026-11-01, [13](../13-decisions.md)):** the client portal shows on-screen **times** in the client's own clock with their zone's short name, and **only that one time** (an IST clock sees IST): e.g. London "25 Oct 2026, 07:12 GMT", India "25 Oct 2026, 11:42 IST". If the local date differs, the local date is shown.

- **Where:** every on-screen date-and-time the server writes as "dd Mon yyyy, HH:MM IST" (acceptance and decision times, the signed deed's moment, payment and Paid-online times, any other timestamp found); send the instant (UTC ms) to the SPA or format a returned instant in the browser, falling back to the server's IST text without scripts or a zone.
- **Unchanged:** deadline and due **dates** (validity "(IST)", due dates; 07-ZE lines 1–2 fix them to Indian dates); PDFs, emails and the admin stay IST.
- **Designer** (portal screens, both themes, 390 and 1280, axe 0); tests for IST, London winter and summer, Los Angeles (date before), Tokyo (date after), missing zone name.
