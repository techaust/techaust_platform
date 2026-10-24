# 07-H: Admin email and notification copy for M3.1 that 07 doesn't have

_Drafted by the lead on 2026-10-24 from approved facts (07 §8; 04 ADM-AUTH-07, ADM-SET-07, ADM-G-09; the invite screens as built in M1.5). **Approved by the owner on 2026-10-24, word for word.** The staff-invite subject in 07 §8 stays as it is. Every email ends with the 07 §8 footer; these are transactional, so they carry no "Why you're receiving this" line and no unsubscribe link. `{{…}}` are filled in by the system._

## 1. Emails

| Email | Subject | Body |
|---|---|---|
| Staff invite (body for the 07 §8 outline) | (07 §8) "You've been invited to TecHaust admin" | "Hi, {{inviter_name}} has invited you to join TecHaust admin as {{role}}. To accept, choose a password and add TecHaust to an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password: every sign-in needs a code from it. The link works once and expires in 48 hours: [Accept the invite]. If you weren't expecting this, you can ignore this email." |
| Test email from Settings › Email | "Test: {{template_name}}" | A line above the normal email: "This is a test of the {{template_name}} email, sent from Settings to you only. It uses sample data, so the names, numbers and links below are not real." Then the template as it would be sent. |

## 2. Notifications (the bell)

| Event | Text | Links to |
|---|---|---|
| New lead | "New lead: {{lead_name}}, {{service_or_request}}" | the lead |
