# 07-K: Project, milestone, note and file screen copy for M3.4

_Drafted by the lead on 2026-10-25 from approved facts (04 ADM-PRJ-01…05; the owner's batch answers in docs/13). **PENDING the owner's word-for-word approval** (batch rule: built as drafts, approved before the final review). Staff-facing admin copy; clients never see it. `{…}` is filled in by the system._

## Lists and statuses
| Where | Copy |
|---|---|
| Projects list, empty | "No projects yet. A project starts from an accepted proposal, or you can add one by hand." |
| Projects list, nothing matches | "Try fewer filters, or search for the start of a project code or name." |
| Project statuses | "Planned" · "Active" · "On hold" · "Completed" · "Cancelled" |
| Milestone statuses | "Pending" · "Ready to bill" · "Invoiced" · "Paid" |
| Client page, Projects tab, empty | "No projects for this client yet." |
| Client page, Files tab, empty | "No files for this client yet." |
| Search group | "Projects" |

## Project page
| Where | Copy |
|---|---|
| Linked proposal, until proposals exist | "The linked proposal arrives with proposals." |
| Billed vs paid, until invoicing exists | "Billed and paid figures arrive with invoicing." |
| Hours logged, until time logs exist | "Hours logged arrive with time logs." |
| Milestone total differs from the budget | "The milestones add up to {total}, but the budget is {budget}. Check them before billing." |
| "Create invoice" on a milestone, until invoicing exists | "Invoices arrive with invoicing." |
| Complete confirmation | "Mark {project} as completed? You can't reopen a completed project." |
| Cancel confirmation | "Cancel {project}? You can't reopen a cancelled project." |
| Delete a milestone | "Delete the milestone {title}? This can't be undone." |

## Notes
| Where | Copy |
|---|---|
| Visibility labels | "Internal" · "Shared with client" |
| Sharing explainer | "Shared notes appear in the client portal for everyone at this client who has portal access." |
| Share confirmation | "Share this note with {client}? Their portal users will be able to read it." |
| Delete confirmation | "Delete this note? This can't be undone." |
| Formatting hint | "You can use **bold**, *italic*, lists and links." |

## Files
| Where | Copy |
|---|---|
| Upload hint | "PDF, PNG, JPG, WebP, Word, Excel, CSV, text or ZIP, up to 25 MB each." |
| Shared explainer | "Shared files can be downloaded from the client portal by everyone at this client who has portal access." |
| Delete confirmation | "Delete {filename}? This can't be undone." |

## Errors (by API code)
| Code | Copy |
|---|---|
| `file_type_not_allowed` | "This type of file can't be uploaded. Use PDF, PNG, JPG, WebP, Word, Excel, CSV, text or ZIP." |
| `file_type_mismatch` | "This file's contents don't match its name. Save it again in its real format and upload that." |
| `file_too_large` | "This file is larger than 25 MB." |
| `length_required`, `length_mismatch`, `checksum_mismatch` | "The upload didn't arrive complete. Try again." |
| `milestone_limit` | "A project can have up to 100 milestones." |
| `milestone_locked` | "This milestone is already invoiced, so it can't be changed or deleted." |
| `arrives_with_invoicing` | "Invoiced and Paid are set by invoicing, which arrives later." |
| `invalid_transition` | "A project can't move from {from} to {to}." |
| `order_mismatch` | "The milestones changed while you were reordering. Reload and try again." |

## Toasts
"Project added." · "Project saved." · "Milestone added." · "Milestone saved." · "Milestones reordered." · "Note added." · "Note saved." · "Note shared." · "File uploaded." · "File shared." · "File deleted."

## Addition to the erase and anonymise confirmations (07-J), VERIFY WITH CA/LEGAL
| Where | Copy |
|---|---|
| Shown when the contact is an individual client's last live contact | "This is {client}'s last contact, so their project notes and files are deleted too." |

## Audit labels (Activity)
"added a project" · "changed the project" · "changed the project status" · "added a milestone" · "changed a milestone" · "changed a milestone status" · "deleted a milestone" · "reordered the milestones" · "added a note" · "changed a note" · "shared a note" · "deleted a note" · "uploaded a file" · "shared a file" · "deleted a file"
