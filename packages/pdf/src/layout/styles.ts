// Template CSS of the skeleton (replaced by the designer). Colours and type come from print.css custom properties; bold is 600, never
// 700 (the fonts stop at 600). No url(), no @import: everything is inline.
export const TEMPLATE_CSS = `
body { margin: 0; font-weight: 400; }
strong, th { font-weight: 600; }
h1 { font-size: var(--print-title); margin: 6mm 0 2mm; }
h2 { font-family: var(--font-display); font-size: 12pt; font-weight: 600; margin: 6mm 0 2mm; break-after: avoid; }
p { margin: 0 0 2mm; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; }
.logo { width: var(--print-logo-width); }
.logo svg { width: 100%; height: auto; display: block; }
.supplier { text-align: right; font-size: var(--print-small); color: var(--color-text-muted); }
.supplier strong { color: var(--color-text); font-size: var(--print-body); }
.parties { display: flex; justify-content: space-between; gap: 8mm; margin-top: 4mm; }
.label { color: var(--color-text-muted); font-size: var(--print-small); }
.meta th { text-align: left; padding-right: 4mm; color: var(--color-text-muted); font-weight: 400; }
.notice { border: 0.3mm solid var(--color-text); padding: 2mm; font-weight: 600; }
.note, .muted { color: var(--color-text-muted); font-size: var(--print-small); }
table { width: 100%; }
th, td { padding: 1.2mm 1.5mm; text-align: left; vertical-align: top; border-bottom: 0.2mm solid var(--color-border); }
.r { text-align: right; }
.items td.num { width: 8mm; }
.totals { width: 70mm; margin-left: auto; margin-top: 3mm; }
.totals th { text-align: left; font-weight: 400; }
.totals .grand th, .totals .grand td { font-size: var(--print-totals); font-weight: 600; border-top: 0.4mm solid var(--color-text); }
.words { margin-top: 2mm; font-weight: 600; }
.sec p, .terms p { white-space: pre-line; }
.foot { margin-top: 8mm; padding-top: 2mm; border-top: 0.2mm solid var(--color-border); font-size: var(--print-small); color: var(--color-text-muted); }
pre { white-space: pre-wrap; font-family: var(--font-mono); font-size: var(--print-small); }
`;
