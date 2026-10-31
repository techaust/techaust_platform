# 07-ZG: erasing a person's details from never-accepted offers (T7)

Status: lines 1–3 **APPROVED by the owner, 2026-10-31** (as drafted); line 4 waits for the owner. Change a line here first, then in the code. Lines in `{braces}` are filled in by the screen. All three lines are staff-facing (admin only); the portal gets no new wording, because an erased offer simply disappears from it.

Context: when you anonymise a person (Clients › contact › Erase or anonymise), every proposal or estimate that was sent to them but **never accepted** loses their name, email and address, and its PDF is deleted (08-C RB-37(a)). The number, status, dates and amounts stay. Accepted offers and every invoice stay exactly as they are.

1. Admin, the read view of such an offer (a banner at the top): "Personal details erased on {date}. The number, status, dates and amounts are kept."
   - **Recommended: as written.**
2. Admin, the offer's PDF panel (and the error when someone asks for its PDF): "The PDF was deleted when the personal details were erased."
   - **Recommended: as written.**
3. Admin, the Erase or anonymise dialog, when the person is named on more than 10 offers (nothing is changed): "This person is named on more than 10 offers, so they can't be anonymised in one go. Nothing was changed. Ask your developer to anonymise them in parts."
   - **Recommended: as written.** (The limit keeps one request inside the Cloudflare free plan's 10 ms CPU allowance. A person with more than 10 offers is unlikely; if it ever happens, the developer splits the work.)

The existing anonymise confirmation (07-J) stays as it is: it already says the details are removed "wherever we can" and that issued invoices and acceptances keep what the law requires.

4. Admin, the audit log's label for the new action `document.redact` (added 2026-10-31, **waiting for the owner**; "[Placeholder]" until approved): "erased personal details from a proposal or estimate"
   - **Recommended: as written.** (It sits next to "viewed a proposal or estimate".)
