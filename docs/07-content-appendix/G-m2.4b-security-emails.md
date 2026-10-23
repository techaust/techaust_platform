# 07-G: Sign-in and security email copy for M2.4b that 07 doesn't have

_Drafted by the lead on 2026-10-23 from approved facts (07 §8; 04 POR-01, ADM-AUTH-06, ADM-AUTH-09; the admin and portal screens as built). **Waiting for the owner's word-for-word approval.** Subjects and the magic-link body already in 07 §8 stay as they are. Every email ends with the 07 §8 footer; these are transactional, so they carry no "Why you're receiving this" line and no unsubscribe link. `{{…}}` are filled in by the system._

## 1. Emails

| Email | Subject | Body |
|---|---|---|
| Magic link, extra line when one email has more than one client account | (07 §8) | Adds above the button: "This link signs you in to {{org_name}}." |
| Login alert (body for the 07 §8 outline) | (07 §8) "New sign-in to your TecHaust admin account" | "Hi {{first_name}}, your TecHaust admin account was just signed in to from a device or browser we haven't seen before. When: {{time_ist}}. Where (approximate): {{location}}. Device: {{device}}. If this was you, there's nothing to do." Then the "Not you?" line (§2). |
| 2FA change: a recovery code was used | (07 §8) "Security change on your account" | "Hi {{first_name}}, a recovery code was used to sign in to your TecHaust admin account on {{time_ist}}. That code can't be used again. When you can, sign in and create a new set of recovery codes under Account." Then the "Not you?" line. |
| 2FA change: new recovery codes created | (07 §8) "Security change on your account" | "Hi {{first_name}}, a new set of recovery codes was created for your TecHaust admin account on {{time_ist}}. Your old codes no longer work." Then the "Not you?" line. |
| 2FA change: reset by the owner | (07 §8) "Security change on your account" | "Hi {{first_name}}, the owner reset the password and two-step sign-in on your TecHaust admin account on {{time_ist}}, and you were signed out everywhere. To get back in, use the new link the owner sends you (it works for 48 hours) to choose a new password and set up your authenticator app again. If you didn't expect this, contact the owner." |
| Lockout (to the member) | (07 §8) "Your account is temporarily locked" | "Hi {{first_name}}, your TecHaust admin account was locked for 15 minutes on {{time_ist}} after 10 wrong sign-in attempts within an hour. Nothing else was changed. After 15 minutes you can sign in as usual." Then the "Not you?" line. |
| Lockout (to the owner) | "A team member's admin account is locked" | "{{member_name}}'s TecHaust admin account was locked for 15 minutes on {{time_ist}} after 10 wrong sign-in attempts within an hour. If {{member_name}} doesn't know about this, someone may be trying to guess the password. You can sign them out everywhere or deactivate the account under Users. [Open in admin]." |

## 2. "Not you?" line (security emails)

| Reader | Line |
|---|---|
| A team member | "Not you? Contact the owner immediately." (07 §8) |
| The owner | "Not you? Sign in now, choose Sign out everywhere under Account, and create new recovery codes." |

## 3. Sign-in screens

| Where | Text |
|---|---|
| Admin sign-in, when the check appears (after 3 wrong attempts) | "To keep your account safe, please complete the check below, then sign in again." |
| Portal sign-in, the check didn't pass | "We couldn't confirm the check. Please try it again, then request your link." |
| Portal sign-in, too many link requests (replaces the current line) | "Too many link requests. If a link already arrived, it still works for 15 minutes. Otherwise wait {{wait}}, then try again." |
