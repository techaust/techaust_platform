# 11: Brand audit, identity "Patina"

| | |
|---|---|
| **Phase** | 6, milestone M1.1 (design tokens and brand) |
| **Date** | 2026-10-06 |
| **Scope** | Every brand asset in `packages/ui/brand/`, the tokens behind them, and the rules in [06 §1–3](06-design-system.md) |
| **Status** | Audit done and fixes applied; **APPROVED** by the owner 2026-10-06 |
| **Decision record** | [ADR 0013](adr/0013-new-brand-identity.md) |

## 1. How the audit was done

- **The brief:** the owner asked for a new identity: "TecHaust" in mixed case, "calm, premium engineering". Three concepts were shown (Patina, Instrument, Nil), and the owner picked Patina.
- **Method:** each aspect below was scored out of 10 against what a professional identity studio would deliver. Wherever possible a score rests on a **measurement**, not taste:
  - WCAG contrast ratios
  - optical white-space areas between letters
  - pixel-grid fit at 16/32 px
  - ICC colour error (ΔE) for print
  - real rendering of every PNG and PDF
- **Tests:** every guarantee that can be checked by code is now a test in `packages/ui/test/` and `packages/ui/tokens/`. If anyone changes a number, CI says what broke.
- **What a score of 10 means:** nothing left that a professional would change, *within what can be done in code*. Where a 10 needs action outside code (legal, a printed proof), the score says so.

## 2. Findings and fixes

### 2.1 Mark geometry (the most important fix)
| Finding | Fix |
|---|---|
| Horizontal and vertical strokes were equal (19 / 19). The eye reads horizontals as heavier, so the T bar and crossbar looked thick. | Horizontals reduced 8 % (17.5). |
| The crossbar sat at the exact centre, which reads as low. | Raised 1.5 units. |
| The diagonal channel between the two 45° cuts was 26.9 units wide against a 19-unit stroke: two rhythms in one small mark. | The channel is now exactly **one stroke** (the T bar extends to 73.1). The mark now reads as one block split by one cut. A test checks the channel width. |

### 2.2 Small sizes
| Finding | Fix |
|---|---|
| The favicon and 16/32 px icons were scaled vectors, so edges fell between pixels and blurred. | **Pixel-fitted** marks: `favicon.svg` is drawn on a 16-unit grid; ICO frames (16/32/48) and every tile ≤ 64 px snap every coordinate to a whole pixel (tested). |

### 2.3 Wordmark spacing
Optical white area between each letter pair (depth-capped scanlines), compared with the font's own rhythm ("no" = 20.3):

| Pair | Before | Fix |
|---|---|---|
| cH | 24.1 (19 % loose: the c opens towards the H) | −4 |
| Ha | 23.2 | −2 |
| st | 23.1 (the t's crossbar overhang) | −2 |
| Te, ec, au, us | on rhythm (Te reads high by nature, already kerned −9) | none |

### 2.4 Lockup system
| Finding | Fix |
|---|---|
| The gap between mark and wordmark (46) was arbitrary. | Now **two mark strokes**. Clear space is one stroke. Both are documented and derived from `STROKE` in code. |

### 2.5 Colour
| Finding | Fix |
|---|---|
| Success green (hue 133°) sat 35° from brand verdigris (168°), so a success message could read as brand colour. | Success moved to `#47730F` / `#A9D46B` (hue 86°, 80° away), still AA on every surface. |
| Muted text was 6.8:1 (AA) while the design aimed for AAA. | `ink-400` darkened to `#485752` → 7.1:1. |
| The primary button was described as AAA in the old docs; it is AA (6.3:1). | Documented honestly as AA (the WCAG requirement for button labels); the test now checks AA. |

### 2.6 Print (the biggest gap found)
| Finding | Fix |
|---|---|
| No print files at all; no CMYK values. | Vector PDFs in CMYK with all text outlined: logos, a business card (3.5 × 2 in, 3 mm bleed, trim and bleed boxes), and an A4 letterhead. |
| A first attempt with the usual RGB→CMYK formula was **rendered and checked**: ink printed as blue slate and verdigris as blue. | CMYK is now found by searching the colour space through a real ICC profile (LittleCMS, SWOP coated, total ink ≤ 300 %). Core colours match at ΔE 0.0–1.3, and light verdigris at 3.8 (the closest printable). The method is in `scripts/measure-cmyk.py` and the results in `tokens/print-cmyk.json` (tested). |

### 2.7 Social, email and link previews
| Finding | Fix |
|---|---|
| The LinkedIn banner was 1584 × 396, which is the *personal* profile size. | Added the company cover at LinkedIn's official **1512 × 256** (LinkedIn help centre) and kept 1584 × 396 for the founder's profile. Added the X header (1500 × 500, content inside its 60 px crop) and a 400 × 400 page logo. |
| Covers had no message. | They carry the approved strapline "Build it right. Automate the rest." ([07 §3](07-content.md)), outlined in Archivo so they never depend on installed fonts. |
| The link preview was just a centred logo. | It's now a layout: lockup, the strapline on two lines, the domain, and the tone-on-tone mark bleeding off the edge (light and dark). |
| Email clients that force dark mode invert transparent logos. | Added `logo-email-badge@2x.png` with a white plate. |

### 2.8 Documentation and legal
| Finding | Fix / status |
|---|---|
| docs/06 still described the retired navy/orange identity. | §1–3 rewritten, plus every stale reference in §4–9 and docs/07 (shadow values fixed 2026-10-07). |
| Font licence for the logo | The OFL allows a font to be used to make a logo; the outlined wordmark is artwork, not Font Software. Recorded in 06 §3.1. |
| Trademark | **VERIFY WITH LEGAL.** Before printing at scale or launching, search the Trade Marks Registry (IP India public search) for the word mark "TecHaust" and for similar TH device marks, in classes 9, 35 and 42. Then consider filing for the word mark and the device mark. Not done; this needs a trademark professional. |

## 3. Scorecard

| # | Aspect | Before | After | Why it isn't 10 (if it isn't) |
|---|---|---|---|---|
| 1 | Concept and meaning | 8 | 9.5 | Meaning is clear when explained; only real-audience feedback can prove it lands unexplained |
| 2 | Distinctiveness / ownability | 7.5 | 8.5 | TH monograms are common; the one-stroke diagonal channel is specific, but only a trademark search can confirm it's clear |
| 3 | Mark geometry and optical precision | 6.5 | **10** | |
| 4 | Small-size performance (16–64 px) | 7 | **10** | |
| 5 | Wordmark letterforms | 7.5 | 9 | Built on a typeface with one bespoke detail; a fully custom-drawn wordmark (type-designer work) would be the last point |
| 6 | Wordmark spacing | 7 | 9.5 | Measured and corrected; a final review at print size by eye on paper is still worth doing |
| 7 | Lockup system and rules | 7.5 | **10** | |
| 8 | Colour palette (screen) | 8 | **10** | |
| 9 | Dark mode | 8.5 | **10** | |
| 10 | Typography | 8.5 | 9.5 | One family is calm and fast; a second, contrasting display face was deliberately not used |
| 11 | Favicons and app icons | 7.5 | **10** | |
| 12 | Social media assets | 6 | **10** | |
| 13 | Email assets | 7 | 9.5 | The HTML email signature comes with the email templates in M2.4 |
| 14 | Print and stationery | 3 | 9 | Needs a printed proof, a Pantone match from a physical guide, and the phone number for the card (owner actions) |
| 15 | Link previews | 6 | **10** | |
| 16 | Guidelines and documentation | 5 | **10** | |
| 17 | Accessibility | 9 | **10** | |
| 18 | Technical quality and reproducibility | 8.5 | **10** | |
| 19 | Legal readiness | 6 | 7 | Trademark search and filing: VERIFY WITH LEGAL |
| | **Average** | **7.0** | **9.6** | |

## 4. Owner actions (what takes the remaining scores to 10)

1. **Trademark search** for "TecHaust" (word) and the TH device, then consider filing (VERIFY WITH LEGAL).
2. **Print proof:** order one proof of the business card and letterhead and check the colours against the screen. For premium stationery, have the printer match verdigris `#1E6B5C` to a Pantone Solid Coated swatch, and record the number in 06 §1.6.
3. **Phone / WhatsApp number** for the business card (it's left off until you confirm it).
4. Optional: show the logo to two or three clients and note whether they read "TH" unprompted.
