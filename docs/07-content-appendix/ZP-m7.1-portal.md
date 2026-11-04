# 07-ZP: M7.1 the full client portal

Status: **DRAFT for the owner (2026-11-05).** Client lines C1–C25 (run file [m7.1-portal](../runs/m7.1-portal.md) section H) and the lead's proposed words for G1–G10 (lines a screen needs that section H lacked). Until the owner approves, every line shows "[Placeholder]" on screen (`APPROVED_07ZP` in `apps/portal/src/copy-zp.ts`; G lines stay marked until their words are approved). Staff lines (S1–S7) are the lead's under the owner's delegation and are listed in the run file. English (India/UK spelling), "and" never "&", no banned phrases (07 §1.3), no card or bank-account field anywhere (ADM-PAY-12).

## Client lines (draft, section H word for word)

### Navigation and Home
- C1. Navigation: "Receipts" (shown only to contacts who can see finance)
- C2. "Invoices to pay" · empty: "Nothing to pay right now."
- C3. "Recent receipts" · "All receipts" · empty: "Receipts for your payments appear here."
- C4. "Your projects" (07-N's projects line is the empty state)
- C5. "Shared with you" · "Notes and files we share with you appear here." · empty: "Nothing shared yet."

### Projects
- C6. Project statuses: "Planned" · "In progress" · "On hold" · "Completed" · "Cancelled"
- C7. Milestone statuses: "Upcoming" · "Delivered" · "Invoiced" · "Paid"
- C8. "Started {date}" · "Target date {date}" · "Milestones" · "Due {date}" · "View invoice"
- C9. "Notes" · "From TecHaust, {date}" · "Updated {date}" · "No shared notes yet."
- C10. "Files" · "Name" · "Size" · "Added" · "Download" · "No shared files yet." · "This file is no longer shared. Ask us if you still need it."

### Receipts
- C11. "Receipts and credit notes" · "Number" · "Date" · "Amount" · "For" · "Download PDF" · "No receipts yet. You get one for every payment we confirm."

### Paying by bank transfer and "I've paid"
- C12. In the payment chooser: "Bank transfer" (with 07-U's "How to pay" line under it)
- C13. "I've paid" · dialog title "Tell us about your payment" · "Amount paid" · "Date paid" · "Transaction reference (UTR or similar)" · "Note (optional)" · hint "Never type card or bank account numbers here." · "Send" · "Cancel"
- C14. "Thanks. We'll check our bank and confirm the payment. Until then the balance stays as it is."
- C15. Refusals: "That's more than the balance due ({amount})." · "The date can't be in the future." · "The date can't be before the invoice date." · "We already have a notice with this reference." · "You've told us about 3 payments for this document. We'll confirm them soon." · "This document can't take a payment notice."
  - The date is judged on India's calendar day (L21): a client east of India may see "can't be in the future" for a few hours after their own midnight.

### Profile and requests
- C16. "Profile" · "Your details" · "Name" · "Phone (optional)" · "Email" · hint "You sign in with this email. To change it, send us a request below." · "Save" · "Saved."
- C17. "Your details changed in another window. Reload to see them."
- C18. "People from {organisation} with portal access" · "(you)"
- C19. "Requests" · "New request" · the kinds: "Add, remove or change a person's access" · "Get a copy of my personal data" · "Correct my personal data" · "Erase my personal data" · "Raise a concern about how we handle my data"
- C20. "Details" · hint "Tell us what you need. Don't include passwords, card or bank account numbers."
- C21. "Request sent. We'll reply by email within 30 days." (the published privacy page says 30 days; M7.4 replaces it with a dated line)
- C22. With an erasure request: "Some records, such as invoices, must be kept by law even after an erasure request." (Researched 2026-10-28, 08-C RA-25; RB-37)
- C23. "Open" · "Closed {date}" · "Done" · "Declined"
- C24. "You already have an open request of this kind. We'll answer it first." · "You've sent several requests today. Try again tomorrow, or email contact@techaust.com."

### The emailed "View & pay" page
- C25. ~~Footer: "Sign in to see all your invoices, receipts and projects."~~ **Withdrawn (lead, 2026-11-05, L27):** the "View & pay" page already shows an approved sign-in notice at the top that says the same; the page keeps that one.

## Lines the screens need that section H lacked (lead's proposed words)
- G1. A receipt that covers more invoices than the list names: "and {n} more"
- G2. The name left empty on Profile: "Enter your name."
- G3. A name or phone the server refuses: "We couldn't save these details. Check your name and phone number."
- G4. No kind chosen in "New request": "Choose what your request is about."
- G5. Details missing: "Tell us a little about what you need." · over 1,000 characters: "Keep it under 1,000 characters."
- G6. "I've paid" with no amount: "Enter the amount you paid." · an amount that can't be read: "Enter the amount in numbers, for example 23,600.00."
- G7. "I've paid" with no date: "Enter the date you paid."
- G8. No reference: "Enter the transaction reference from your bank." · a reference refused: "We couldn't read this reference. Check it and try again."
- G9. The date field's own lines, as approved for staff: "Enter the date as DD/MM/YYYY, for example 26/10/2026." · "Choose a date"
- G10. A project with no milestones: "No milestones yet."
