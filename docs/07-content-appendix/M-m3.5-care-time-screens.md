# 07-M: Care plan, time log and dashboard screen copy for M3.5

_Drafted by the lead on 2026-10-25 from approved facts: 04 ADM-CARE-01, -03, ADM-TIME-01…03 and ADM-DASH-01, plus the owner's M3.5 answers in docs/13. **PENDING the owner's word-for-word approval** (batch rule: built as drafts, approved before the final review). This is staff-facing admin copy that clients never see. `{…}` is filled in by the system. Overage amounts are before GST; GST on overage is VERIFY WITH CA/LEGAL._

## Care plans
| Where | Copy |
|---|---|
| Care plans list, empty | "No care plans yet. A care plan starts when a client signs up for monthly support." |
| Care plans list, nothing matches | "Try fewer filters." |
| Statuses | "Active" · "Paused" · "Cancelled" |
| New plan, currency line | "The plan uses the client's currency." |
| Included hours hint | "In steps of 15 minutes. Leave empty if the plan has no included hours." |
| Overage rate hint | "Charged per hour above the included hours, before GST." |
| Rollover hint | "Unused hours carry over to the next billing period only." |
| Billing day hint | "Day 1 to 28. The plan's hours count from this day to the day before it in the next month." |
| Current period card | "{start} to {end}" · "Included" · "Carried over" · "Used" · "Remaining" · "Overage" |
| Flags | "Near the limit" (80 % used) · "Limit reached" (100 % used) |
| No rate set | "No overage rate set, so the overage can't be priced." |
| Before GST | "Amounts are before GST." |
| Pending change | "New terms from {date}." |
| Add overage to invoice, until recurring invoices exist | "Adding overage to the next invoice arrives with recurring invoices." |
| Terms change confirmation | "Change the terms of {plan} from {date}? The current billing period keeps its terms." |
| Pause confirmation | "Pause {plan} from {date}? No time can be logged to it while it's paused." |
| Resume confirmation | "Resume {plan} from {date}?" |
| Cancel confirmation | "Cancel {plan} from {date}? This can't be undone. To restart, create a new plan." |
| Client page, Care plans tab, empty | "No care plans for this client yet." |

## Time
| Where | Copy |
|---|---|
| Timesheet heading | "Week of {date}" |
| Totals | "Total" · "Billable" · "Non-billable" |
| Entry dialog hints | "Minutes in steps of 15, up to 24 hours a day." · "Choose a project or a care plan." |
| Logging for someone else | "Log time for" |
| Locked entry | "Entries lock 7 days after they're made. Only the owner can change them after that." |
| Owner override notice | "This entry is locked for its author. Your change is recorded in the audit log." |
| Empty week | "No time logged this week." |
| CSV columns | "Date" · "Person" · "Project or care plan" · "Minutes" · "Billable" · "Note" |

## Errors (by API code)
| Code | Copy |
|---|---|
| `day_cap` | "That would take this person over 24 hours on that day." |
| `plan_not_active` | "The care plan isn't active on that date." |
| `project_closed` | "The project is cancelled, so its time can't change." |
| `time_locked` | "This entry is locked. Only the owner can change it now." |
| `owner_only_date` | "Only the owner can log time more than 7 days back." |
| `future_date` | "Time can't be logged for a future date." |
| `one_target` | "Choose a project or a care plan, not both." |
| `plan_cancelled` | "This care plan is cancelled." |
| `invalid_transition` | "A care plan can't move from {from} to {to}." |
| `client_anonymised` | "This client's personal details were removed, so nothing new can be added to it." |
| `bad_user` | "Choose an active member of staff." |

## Dashboard
| Where | Copy |
|---|---|
| Tiles | "Leads" · "Pipeline value" · "Invoiced and collected" · "Projects" · "Milestones due in 14 days" · "Care plan hours" · "My time" · "Recent activity" |
| Pipeline value, until proposals exist | "Pipeline value arrives with proposals." |
| Finance, until invoicing exists | "Invoiced and collected figures arrive with invoicing." · "Payments waiting for checks arrive with payments." |
| Care plans, not started | "Not started" |
| Activity actor for automatic changes | "System" |
| Truncated lists | "Showing the first {n}." |
| Empty tiles | "No open leads." · "No milestones due in the next 14 days." · "No active care plans." · "No time logged this week." · "No recent activity." |

## Project page (replaces the 07-K line)
| Where | Copy |
|---|---|
| Hours figure | "Hours logged: {total}, of which {billable} billable" |

## Toasts
"Care plan added." · "Terms changed from {date}." · "Care plan paused." · "Care plan resumed." · "Care plan cancelled." · "Time logged." · "Time entry saved." · "Time entry deleted."
