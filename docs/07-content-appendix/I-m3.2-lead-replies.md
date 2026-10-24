# 07-I: Lead reply templates for M3.2 (ADM-LEAD-06)

_Drafted by the lead on 2026-10-24 from approved facts (07 §1 voice and honesty rules; 07 §8 lead acknowledgement: one business day, Mon–Sat 10:00–19:00 IST; 04 ADM-LEAD-06). **Approved by the owner on 2026-10-24, word for word.** A template only fills the reply box: the sender reads and edits it before sending. Sent from `hello@`, Reply-To `hello@`, with the 07 §8 footer. These are replies to an enquiry the person sent, so they carry no "Why you're receiving this" line and no unsubscribe link. `{{…}}` are filled in by the system; `[…]` is a gap the sender fills before sending (the reply can't be sent while one is left)._

| Template | Subject | Body |
|---|---|---|
| Book a call | "Re: your enquiry ({{ref}})" | "Hi {{first_name}}, thanks for telling us about {{service_or_request}}. The next step is a short call, about 30 minutes, so we can understand what you need and tell you honestly whether we're a good fit. Could you reply with two or three times that suit you? We're available Mon–Sat, 10:00–19:00 IST. Regards, {{sender_name}}, TecHaust Technologies" |
| A few questions first | "Re: your enquiry ({{ref}})" | "Hi {{first_name}}, thanks for getting in touch about {{service_or_request}}. Before we suggest an approach and a price, it would help to know a little more: [your questions]. A few lines on each is plenty. Regards, {{sender_name}}, TecHaust Technologies" |
| Not the right fit | "Re: your enquiry ({{ref}})" | "Hi {{first_name}}, thank you for considering us for {{service_or_request}}. Having looked at what you need, we don't think we're the right team for it, and we'd rather tell you now than take up your time. [Optional: a suggestion of where to look instead.] We wish you the best with it. Regards, {{sender_name}}, TecHaust Technologies" |

**Layout (owner, 2026-10-25):** each email puts "Hi {{first_name}}," on its own line, then the message as its own paragraph (starting with a capital: "Thanks", "Thank you"), then "Regards," and on the next line "{{sender_name}}, TecHaust Technologies". The words are unchanged.

**System fields:** `{{first_name}}` is the first word of the lead's name; `{{service_or_request}}` is the service name (or the request type) as in the 07-H bell text; `{{sender_name}}` is the signed-in member's name; `{{ref}}` is the lead reference.
