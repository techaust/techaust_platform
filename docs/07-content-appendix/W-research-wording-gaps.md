# 07-W: Lines that 07-R to 07-V lacked (research and wording task, 2026-10-28)

_The designer of the research and wording task found these lines on screens with no approved 07 line and proposed words ([runs/research-and-wording](../runs/research-and-wording.md), "Designer report"). **Approved by the lead on 2026-10-28 under the owner's delegation** ([13-decisions](../13-decisions.md) 2026-10-28). Staff-facing unless marked. `{…}` is filled by the screen._

## 1. Invoices and notes (07-R, 07-S, 07-T)
- FX checkbox (rate date earlier than the document date): "No rate was published that day"
- Debit note reason label: "Reason (required, printed on the debit note)"
- Invoices list, filters hide every row: "No invoices match these filters"
- Blocker `line_text_placeholder`: "Line {n}: a line's wording isn't approved yet." (the safety net stays; with all copy approved it should never show)

## 2. Sending, reminders and care (07-U)
- Send dialog hint (replaces 07-U §4's hint; recipients need portal access and "Can see finance", POR-03): "Only contacts with portal access and "Can see finance" turned on can receive invoices and notes."
- No eligible contact (some have portal access, none can see finance): "No contact of this client with portal access can see finance. Turn on "Can see finance" for a contact on the client's page, then send."
- Under a contact who can't receive: ""Can see finance" is off for this contact"
- Queued before the PDF exists: "Waiting for the PDF. The email goes as soon as it's made." · status "Waiting for the PDF"
- Revoke links, extra line: "Payment reminders are paused too. You can resume them on this page."
- Toasts: "Reminders paused." · "Reminders resumed."
- Reminder schedule state: "Skipped: missed while reminders were paused"
- Care toggle hint (replaces 07-U §6's hint, which named the wrong people and recipients): "On the billing day, the invoice is issued and emailed to the client's billing contacts who have portal access and can see finance. Only an owner can turn this on; an owner or a staff member can turn it off."
- Toggle on, but the owner who turned it on is no longer active: "Not in effect"
- Care plan page, billing section: heading "Billing" · "Last billed period" · "Not billed yet" · "No invoice on record for this period" · "Next billing day" · "None, the plan is cancelled" · "The owner's choices allow this draft to be issued automatically." · "Any field still missing is listed on the draft's page." · "Open the draft"
- Care dead-letter bells (to owners): "A care invoice couldn't be drafted. Open the care plan to see why." · "A care invoice draft could not be issued by itself. Check the draft."
- Portal (client-facing), invoices sign-in hint: "Sign in to your client portal to see all your invoices and payment requests in one place."

## 3. Reports and statements (07-V)
- GST exports: column heads "Section" · "Documents" · "Overall" · heading "Files" · "Cancelled. No files were made." · "Download HSN/SAC summary (B2B) CSV" · "Download HSN/SAC summary (B2C) CSV" · Table 3.2 empty "None in this period."
- Sales register: button "Show" · preview heading "Output tax"
- Export realisation, "Show realised" on and nothing listed: "No export invoices in this list."
- Statement: button "Show" · table caption "Statement entries"
- Dashboard: "Export deadlines can't be worked out until the Tax settings are saved again." · "Open invoices"
- Settings › Tax, realisation errors: "Enter the months before the warning, from 1 to 1,200." · "Enter the months before escalating, from 1 to 1,200." · "Enter the days before the final reminder, from 0 to 36,500."

## 4. The researched-default note (admin `VerifyNote`; replaces the visible "VERIFY WITH CA/LEGAL" tag)
- Tag: "Researched default" (both kinds); accessible name "Researched default"
- Settings pages text: "These defaults follow official sources, researched on 28 October 2026. Questions the sources don't settle are on the list for your {CA | CA and lawyer}."
- Settings › Terms text: unchanged ("The wording of these blocks is yours and your lawyer's. …")
- Client forms and GST exports: their existing texts unchanged.

## 5. Lead answers to the designer's questions (2026-10-28)
1. Care toggle hint: §2's version replaces 07-U §6's.
2. Privacy "Changes" note "Complaints are resolved within one month, and you get a copy of your complaint as we recorded it.": kept.
3. After 31 October the deadline banner keeps only "Only {days} days left for a credit note on this invoice.": intended (the advice date has passed).
4. `VerifyNote`: §4.
5. The portal's privacy link: a portal `WEBSITE_ORIGIN` var (staging: the staging website; production: https://techaust.com), the builder's.
6. Checklist "Authorised signatory" switched off: the PDF leaves out the signature block ("For {company}", the image and "Authorised signatory"); an electronically issued invoice needs none (08-C RA-06).
7. No bell for a failed supplier copy: the admin's download asks jobs again, which is enough.
