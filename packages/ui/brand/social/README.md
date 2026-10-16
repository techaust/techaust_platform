# TecHaust social media kit

The bios and profile text for each platform: [docs/07-content-appendix/B-social-profiles.md](../../../../docs/07-content-appendix/B-social-profiles.md).

Generated from the brand sources by `pnpm --filter @techaust/ui build:social`. Do not edit these files by hand;
change `packages/ui/src/brand/social.ts` and rebuild. One folder per platform. Files ending in `@2x` are the same
image at double size: upload the `@2x` file where the platform accepts it (it looks sharper on high-resolution
screens), otherwise the plain one.

Menu names change from time to time. If a step doesn't match what you see, look for Edit profile or the camera
icon on the picture.

## LinkedIn (`linkedin/`)

- Company Page: open the Page as an admin, then Edit page. Upload `company-logo.png` as the logo and `company-cover.png` as the cover image.
- Founder's profile: on the profile, click the camera icon on the background and upload `founder-background.png`.

| File | Size (px) | Notes |
|---|---|---|
| `company-logo.png` | 400 × 400 | Page logo. LinkedIn shows it on light and dark backgrounds; the ink tile works on both. Size from the platform's own help page. |
| `company-logo@2x.png` | 800 × 800 | Size from the platform's own help page. |
| `company-cover.png` | 1512 × 256 | Page cover. LinkedIn may trim it to fit the screen; everything sits in the middle band. Size from the platform's own help page. |
| `company-cover@2x.png` | 3024 × 512 | Size from the platform's own help page. |
| `founder-background.png` | 1584 × 396 | Background image for a personal profile (the founder's). The photo itself is not part of this kit. Size from several guides, not an official page: **check on a real device**. |
| `founder-background@2x.png` | 3168 × 792 | Size from several guides, not an official page: **check on a real device**. |

## X (`x/`)

- Profile, then Edit profile. Upload `profile.png` as the photo and `header.png` as the header, then Apply.

| File | Size (px) | Notes |
|---|---|---|
| `profile.png` | 400 × 400 | Profile photo, shown as a circle. Size from the platform's own help page. |
| `profile@2x.png` | 800 × 800 | Size from the platform's own help page. |
| `header.png` | 1500 × 500 | Header. X may crop 60 px off the top and bottom; everything sits in the middle 380 px. Size from the platform's own help page. |
| `header@2x.png` | 3000 × 1000 | Size from the platform's own help page. |

## Facebook (`facebook/`)

- On the Page, click the camera icon on the profile picture and upload `profile.png`.
- Click Edit cover photo, then Upload photo, and choose `cover.png` (sharpest) or `cover.jpg` (smallest).

| File | Size (px) | Notes |
|---|---|---|
| `profile.png` | 320 × 320 | Page profile picture: shown at 176 px on computers and 196 px on phones, cropped to a circle. Size from the platform's own help page. |
| `profile@2x.png` | 640 × 640 | Size from the platform's own help page. |
| `cover.png` | 851 × 315 | Page cover. Upload the PNG for the sharpest type; the JPG (under 100 KB) is Facebook's fastest-loading format. Size from the platform's own help page. |
| `cover@2x.png` | 1702 × 630 | Size from the platform's own help page. |
| `cover.jpg` | 851 × 315 | Under 100 KB, Facebook's fastest-loading size. Size from the platform's own help page. |

## Instagram (`instagram/`)

- Profile, then Edit profile, then Change profile picture: `profile.png` (or `profile-1080.png`).
- Highlights: press and hold a highlight, then Edit highlight, then Edit cover, and choose the matching `highlight-*.png` from your photos. Name them Services, Work, About and Contact.
- Posts: open `post-template-square.svg` or `post-template-portrait.svg` in a design app, add a headline in the empty area, and export a PNG at the same size.

| File | Size (px) | Notes |
|---|---|---|
| `profile.png` | 320 × 320 | Profile photo, shown as a circle. Size from several guides, not an official page: **check on a real device**. |
| `profile-1080.png` | 1080 × 1080 | The same profile photo at 1080 × 1080, for apps that ask for a larger file. Size from several guides, not an official page: **check on a real device**. |
| `highlight-services.png` | 1080 × 1920 | Story highlight cover for "Services". Instagram prints the highlight's name under the circle, so the image has no text. Size from several guides, not an official page: **check on a real device**. |
| `highlight-work.png` | 1080 × 1920 | Story highlight cover for "Work". Instagram prints the highlight's name under the circle, so the image has no text. Size from several guides, not an official page: **check on a real device**. |
| `highlight-about.png` | 1080 × 1920 | Story highlight cover for "About". Instagram prints the highlight's name under the circle, so the image has no text. Size from several guides, not an official page: **check on a real device**. |
| `highlight-contact.png` | 1080 × 1920 | Story highlight cover for "Contact". Instagram prints the highlight's name under the circle, so the image has no text. Size from several guides, not an official page: **check on a real device**. |
| `post-template-square.png` | 1080 × 1080 | Square post frame. Add a headline in the empty area (edit the SVG, or place the PNG in any editor). Size from several guides, not an official page: **check on a real device**. |
| `post-template-square.svg` | 1080 × 1080 | Editable version of the same frame. Size from several guides, not an official page: **check on a real device**. |
| `post-template-portrait.png` | 1080 × 1350 | Portrait (4:5) post frame, the tallest Instagram shows in the feed. Size from several guides, not an official page: **check on a real device**. |
| `post-template-portrait.svg` | 1080 × 1350 | Editable version of the same frame. Size from several guides, not an official page: **check on a real device**. |

## Threads (`threads/`)

- Threads uses the Instagram profile picture by default. To set it separately: Threads, then Profile, then Edit profile, and upload `profile.png` (or `profile-1080.png`). Threads has no cover or banner.

| File | Size (px) | Notes |
|---|---|---|
| `profile.png` | 320 × 320 | Profile picture, shown as a circle (the same art as Instagram's). Size from several guides, not an official page: **check on a real device**. |
| `profile-1080.png` | 1080 × 1080 | The same profile picture at 1080 × 1080. Size from several guides, not an official page: **check on a real device**. |

## WhatsApp Business (`whatsapp-business/`)

- Settings, then Business tools, then Business profile. Tap the photo to upload `profile.png`; add `cover.png` as the cover photo where the app offers it.

| File | Size (px) | Notes |
|---|---|---|
| `profile.png` | 640 × 640 | Business profile photo, shown very small as a circle: the mark only. Size from several guides, not an official page: **check on a real device**. |
| `profile-1080.png` | 1080 × 1080 | The same profile photo at 1080 × 1080. Size from several guides, not an official page: **check on a real device**. |
| `cover.png` | 1920 × 1080 | Cover photo. No official size is published: check on a real phone after uploading. Size from several guides, not an official page: **check on a real device**. |

## Google Business Profile (`google-business/`)

- Search Google for the business name and city, then Photos. Choose Add a logo for `logo.png` and Add a cover photo for `cover.png` (official steps). Google may still show another photo first.

| File | Size (px) | Notes |
|---|---|---|
| `logo.png` | 720 × 720 | Logo: square, often shown as a circle. Size from the platform's own help page. |
| `logo@2x.png` | 1440 × 1440 | Size from the platform's own help page. |
| `cover.png` | 1920 × 1080 | Cover photo (16:9). Google may show another photo first; the lockup stays centred for any crop. Size from several guides, not an official page: **check on a real device**. |

## YouTube (`youtube/`)

- YouTube Studio, then Customization, then Profile. Upload `profile.png` as the picture and `banner.png` as the banner image, then Publish (official steps).

| File | Size (px) | Notes |
|---|---|---|
| `profile.png` | 800 × 800 | Channel picture, shown as a circle as small as 98 px. Size from several guides, not an official page: **check on a real device**. |
| `profile@2x.png` | 1600 × 1600 | Size from several guides, not an official page: **check on a real device**. |
| `banner.png` | 2560 × 1440 | Channel banner. Only the centre 1546 × 423 shows on every device (TV shows the whole image). Size from the platform's own help page. |

## Upwork (`upwork/`)

- Agency profile, then edit the logo (`agency-logo.png`) and the banner (`agency-banner.png`).

| File | Size (px) | Notes |
|---|---|---|
| `agency-logo.png` | 250 × 250 | Agency logo (square). Size from the platform's own guide. |
| `agency-logo@2x.png` | 500 × 500 | Size from the platform's own guide. |
| `agency-banner.png` | 3200 × 320 | Agency banner. Upwork scales and crops it to the screen; the lockup sits centre-right. Size from the platform's own guide. |

## Clutch (`clutch/`)

- Vendor dashboard, then the profile editor: upload `logo.png`. Use `lockup.png` wherever a wide logo is asked for. Clutch takes 1–2 minutes to show a new logo.

| File | Size (px) | Notes |
|---|---|---|
| `logo.png` | 1000 × 1000 | Company logo (square tile). The platform publishes no size: **check on a real device**. |
| `lockup.png` | 1535 × 282 | The primary lockup in full colour on a transparent background, for places that ask for a wide logo. The platform publishes no size: **check on a real device**. |

## GoodFirms (`goodfirms/`)

- Company profile editor: upload `logo.png`; use `lockup.png` wherever a wide logo is asked for.

| File | Size (px) | Notes |
|---|---|---|
| `logo.png` | 1000 × 1000 | Company logo (square tile). The platform publishes no size: **check on a real device**. |
| `lockup.png` | 1535 × 282 | The primary lockup in full colour on a transparent background. The platform publishes no size: **check on a real device**. |

## GitHub (`github/`)

- The organisation's Settings, then Profile picture: upload `org-avatar.png`.

| File | Size (px) | Notes |
|---|---|---|
| `org-avatar.png` | 1000 × 1000 | Organisation profile picture; GitHub shows it as a circle in places. The platform publishes no size: **check on a real device**. |
