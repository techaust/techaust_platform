# 07-L: Catalogue, templates and publish screen copy for M4.1

_Drafted by the lead on 2026-10-25 from approved facts (04 ADM-CAT-01…05, WEB-G-07; the owner's answer on publishing in docs/13). **Approved by the owner word for word on 2026-10-26 ([07-Q](Q-batch-review-copy.md), "approve all")**. Staff-facing admin copy; clients never see it. `{…}` is filled in by the system. SAC and GST items are VERIFY WITH CA._

## Catalogue list and item
| Where | Copy |
|---|---|
| Catalogue list, intro | "Your services, their prices and what each one includes. Proposals and estimates start from these, and the website shows the ones marked for it." |
| Catalogue list, nothing matches | "Try fewer filters, or search for the start of a service code or name." |
| Status labels | "Active" · "Retired" · "On the website" · "Not on the website" |
| Category labels | "Advise" · "Build" · "Automate" · "Connect" · "Run" |
| Unit labels | "Fixed price" · "Per milestone" · "Per month" · "Per hour" · "Per workflow" · "Per connector" · "Per document" |
| SAC field hint | "The six-digit service code printed on invoices. VERIFY WITH CA." |
| GST rate field hint | "Leave empty to use the rate in Settings › Tax." |
| "From" prices hint | "The starting price shown on the website. Leave a currency empty if you don't offer it there." |
| Default lines hint | "The lines a proposal starts with when this service is chosen. Each needs a different description." |
| Schedule hint | "How this service is usually paid. The steps must add up to 100 %." |
| Show on website hint | "Turning this off removes the service's page from the website at the next publish." |
| Retire confirmation | "Retire {code} {name}? It can't be added to new proposals or estimates. Documents that already include it don't change." |
| Reactivate confirmation | "Make {code} {name} active again? It can be added to new proposals and estimates." |
| Code locked line | "The code can't change once the service is saved." |

## Price history
| Where | Copy |
|---|---|
| Heading | "Price history" |
| Row | "{field} changed from {old} to {new} by {person}" |
| Empty | "No price changes yet." |

## Templates
| Where | Copy |
|---|---|
| Intro | "The starting wording for proposals and estimates in each category, plus the care plan and terms blocks. Saving creates a new version; documents keep the version they were made with." |
| Placeholders hint | "Use placeholders such as {{client.name}} or {{service.deliverables}}. They're filled in when a proposal is made." |
| Version line | "Version {n}, saved by {person} on {date}" |
| Empty | "No templates for this category yet." |

## Publish to website
| Where | Copy |
|---|---|
| Intro | "Publishing sends the current prices of every active service marked for the website to the staging website. The staging website picks them up within 30 minutes. The live website changes only with the next approved deploy." |
| Publish button | "Publish prices" |
| Published | "Published. The staging website shows these prices within 30 minutes." |
| Unchanged | "No change: these prices are already the newest published." |
| Republished an earlier list | "Published. These are the same prices as an earlier list; the staging website goes back to them within 30 minutes." |
| History heading | "Published price lists" |
| History row | "Published by {person} on {date}" |
| Empty | "Nothing published yet. The website uses the starting prices until you publish." |

## Errors (by API code)
| Code | Copy |
|---|---|
| `code_in_use` | "Another service already has this code." |
| `slug_in_use` | "Another service already uses this website address." |
| `unknown_placeholder` | "This template uses a placeholder that doesn't exist: {placeholder}." |
| `template_category` | "This template's category doesn't fit its kind. Proposal and estimate templates need a category; the care plan and terms blocks don't." |
| `snapshot_invalid` | "The prices can't be published yet. Fix the services listed below." |
| `conflict` | "Someone else saved at the same moment. Reload and try again." |

## Toasts
"Service added." · "Service saved." · "Service retired." · "Service active again." · "Template saved as version {n}." · "Prices published."

## Audit labels (Activity)
"added a service" · "changed a service" · "retired a service" · "made a service active again" · "saved a template version" · "published prices"

## Added after the review (lead, 2026-10-25; approved 2026-10-26, 07-Q)
| Where | Copy |
|---|---|
| Retire or take off the website, when the website uses this service | "The website shows this service. Retiring it, or taking it off the website, stops the next publish until the website no longer needs it." |
| `snapshot_invalid` for a service the website needs | "The website needs {code}: {what is missing}." |
| A save that is too long (413) | "This is too long. Shorten the longest texts and save again." |
| Template version with no person | "Version {n}, saved on {date}" |
| What the website needs (after "The website needs {code}:") | "this service, active and on the website" · "a from price in rupees" · "a default line that starts with "{word}"" · "a rate in rupees on the default line that starts with "{word}"" · "only one default line that starts with "{word}"" |
