# 07-ZF: withdraw a proforma the client has seen

Status: **APPROVED by the owner, 2026-10-31** (lines 1–20 as drafted; line 21 dropped, since no email is sent: Q2 = A). Change a line here first, then in the code. The switch `APPROVED_07ZF` is on. Lines in `{braces}` are filled in by the screen. The portal calls a proforma a "payment request" (07-U §1).

## Admin (staff)
1. Button: "Withdraw proforma"
2. Dialog title: "Withdraw proforma {number}"
3. Dialog body: "The client has already received this proforma, so it can't be voided. Withdrawing takes it back: it keeps its number and stays in your records, the client sees it as withdrawn in the portal, and its reminders stop. You can withdraw it only while nothing has been paid against it and no invoice has been made from it."
4. Reason box: the 07-ZA line 18 label, "Reason (required, kept with the proforma)". Empty reason: "Enter a reason for withdrawing."
5. Confirm button: "Withdraw proforma"
6. Toast: "Proforma {number} withdrawn." (then the existing milestone line)
7. Banner on a withdrawn proforma: "Withdrawn {date} by {name}: {reason}. The client sees it as withdrawn in the portal."
8. Status badge: "Withdrawn"
9. Audit and activity: "withdrew a proforma"
10. Refused, already withdrawn: "This proforma is already withdrawn."
11. Refused, paid: "This proforma can't be withdrawn because a payment has been recorded against it."
12. Refused, converted: "This proforma can't be withdrawn because an invoice has been made from it."
13. Refused, not yet delivered: "This proforma hasn't reached the client yet, so void it instead."
14. Refused, not an issued proforma: "Only an issued proforma can be withdrawn."
15. Replaces 07-Z §1's proforma line (void refused after a portal view): "The client has opened this proforma in the portal, so it can't be voided. Withdraw it instead."
16. Replaces the emailed-proforma void line: "This proforma has been emailed to the client, so it can't be voided. Withdraw it instead."
17. Replaces the end of the 07-ZA §10 locked banner: "If it's wrong and nothing has been paid or converted, void it if the client hasn't received it yet, or withdraw it if they have, then issue a new one."

## Portal (clients)
18. List status: "Withdrawn"
19. Page banner: "This payment request was withdrawn on {date}. You don't need to pay it."
20. PDF refused: "The PDF isn't available because this payment request was withdrawn."
21. ~~Only if Q2 = B (an email)~~ **Dropped (owner, 2026-10-31: no email).** Was: subject "Payment request {number} withdrawn"; body "We've withdrawn payment request {number} dated {date}. You don't need to pay it. If you have any questions, reply to this email."

Checked against the banned-phrase list (07 §1.3): none used; no "&", no arrow characters.
