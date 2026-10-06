# ADR 0008: Payment provider interface; verified webhooks only

- **Status:** Accepted (2026-10-06)
- **Context and decision:** Razorpay/Stripe/PayPal/manual behind one interface; signatures verified on the raw body; idempotent; nothing is marked paid on a redirect.
- **Details:** [05 §9](../05-architecture.md) (payment flows).
