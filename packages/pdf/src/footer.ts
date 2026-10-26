// The footer line and the default address, in one place. Both the view (which the portal imports) and the layouts read them from here, so
// neither imports the other (the view entry must never pull in the layouts: test/m45.test.ts).

/** The address printed when Settings has none on the document (decision: hello@); the one place it is written. */
export const DEFAULT_CONTACT_EMAIL = "hello@techaust.com";

/** The page footer line (07-P PDF14, 07-Q Q11): the address is Settings "Email on documents". */
export const footerLine = (email: string): string => `TecHaust Technologies · techaust.com · ${email}`;
