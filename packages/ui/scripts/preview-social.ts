// Preview sheets for the social media kit (owner review): every image, each one mocked inside its platform's
// layout (avatars over covers, crops, the YouTube device zones, the Instagram highlight row, a WhatsApp Business
// profile), small-size checks and 100 % crops. Output goes to <repo>/.logs/social/ (git-ignored), never to brand/.
// Run after rendering the kit there:
//   node packages/ui/scripts/build-social.ts --out .logs/social/kit
//   node packages/ui/scripts/preview-social.ts
// The mock-up chrome is neutral grey with generic labels ("Page name"); it is not the platforms' real UI and holds
// no account data.
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { SOCIAL_ITEMS, type SocialItem, type Zone } from "../src/brand/social.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "..", "..", ".logs", "social");
const kit = join(out, "kit");
mkdirSync(out, { recursive: true });

const FONT = "Segoe UI, Arial, sans-serif";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const text = (x: number, y: number, t: string, size: number, fill: string, extra = "") =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" ${extra}>${esc(t)}</text>`;
const svg = (w: number, h: number, body: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
const file = (platform: string, name: string) => join(kit, platform, `${name}.png`);
const item = (platform: string, name: string) =>
  SOCIAL_ITEMS.find((i) => i.platform === platform && i.name === name) as SocialItem;

type Layer = { input: Buffer; left: number; top: number };
type Panel = { title: string; buf: Buffer; w: number; h: number };

const resized = (f: string, w: number, h?: number) =>
  sharp(f)
    .resize(w, h ?? null, { kernel: "lanczos3", fit: "fill" })
    .png()
    .toBuffer();

/** An image cropped to a circle `d` px wide, with an optional ring (the platform's border). */
async function circle(f: string, d: number, ring?: { width: number; colour: string }) {
  const img = await resized(f, d, d);
  const masked = await sharp(img)
    .composite([
      {
        input: svg(d, d, `<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="#fff"/>`),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  if (!ring) return masked;
  const D = d + 2 * ring.width;
  return sharp({ create: { width: D, height: D, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      {
        input: svg(D, D, `<circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="${ring.colour}"/>`),
        left: 0,
        top: 0,
      },
      { input: masked, left: ring.width, top: ring.width },
    ])
    .png()
    .toBuffer();
}

async function rounded(f: string, d: number, radius: number, ring?: { width: number; colour: string }) {
  const img = await resized(f, d, d);
  const masked = await sharp(img)
    .composite([
      { input: svg(d, d, `<rect width="${d}" height="${d}" rx="${radius}" fill="#fff"/>`), blend: "dest-in" },
    ])
    .png()
    .toBuffer();
  if (!ring) return masked;
  const D = d + 2 * ring.width;
  return sharp({ create: { width: D, height: D, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      {
        input: svg(
          D,
          D,
          `<rect width="${D}" height="${D}" rx="${radius + ring.width}" fill="${ring.colour}"/>`,
        ),
        left: 0,
        top: 0,
      },
      { input: masked, left: ring.width, top: ring.width },
    ])
    .png()
    .toBuffer();
}

async function canvas(w: number, h: number, bg: string, layers: Layer[]) {
  return sharp({ create: { width: w, height: h, channels: 3, background: bg } })
    .composite(layers)
    .png()
    .toBuffer();
}

/** Zone outlines (dashed) scaled by `s`, with labels. */
function zones(list: { zone: Zone; colour: string; label?: string }[], s: number, w: number, h: number) {
  const body = list
    .map(({ zone: z, colour, label }) => {
      const shape =
        z.shape === "rect"
          ? `<rect x="${z.x * s + 1}" y="${z.y * s + 1}" width="${z.w * s - 2}" height="${z.h * s - 2}" fill="none" stroke="${colour}" stroke-width="2" stroke-dasharray="8 6"/>`
          : `<circle cx="${z.cx * s}" cy="${z.cy * s}" r="${z.r * s}" fill="none" stroke="${colour}" stroke-width="2" stroke-dasharray="8 6"/>`;
      const lx = z.shape === "rect" ? z.x * s + 8 : (z.cx - z.r) * s + 8;
      const ly = z.shape === "rect" ? z.y * s + 20 : (z.cy - z.r) * s + 20;
      return shape + (label ? text(lx, ly, label, 14, colour, 'font-weight="600"') : "");
    })
    .join("");
  return svg(w, h, body);
}

const SHEET_BG = "#D9DDDA";
const INK = "#1A1A1A";

async function sheet(name: string, title: string, panels: Panel[], cols = 1) {
  const gap = 40;
  const cap = 30;
  const colW = Math.max(...panels.map((p) => p.w));
  const rows: Panel[][] = [];
  for (let i = 0; i < panels.length; i += cols) rows.push(panels.slice(i, i + cols));
  const W = gap + cols * (colW + gap);
  let y = gap + 44;
  const layers: Layer[] = [
    { input: svg(W, 40, text(0, 30, title, 26, INK, 'font-weight="600"')), left: gap, top: gap },
  ];
  for (const row of rows) {
    const rh = Math.max(...row.map((p) => p.h));
    row.forEach((p, i) => {
      const x = gap + i * (colW + gap);
      layers.push({ input: svg(colW, cap, text(0, 20, p.title, 16, INK)), left: x, top: y });
      layers.push({ input: p.buf, left: x, top: y + cap });
    });
    y += cap + rh + gap;
  }
  const f = join(out, `${name}.png`);
  await sharp(await canvas(W, y, SHEET_BG, layers)).toFile(f);
  console.log(f);
}

const UI = {
  light: { bg: "#FFFFFF", text: "#1A1A1A", muted: "#6B6B6B", line: "#E3E3E3", block: "#EDEDED" },
  dark: { bg: "#000000", text: "#E7E9EA", muted: "#8B8F93", line: "#2F3336", block: "#202327" },
};
type Theme = keyof typeof UI;
/** Grey bars standing in for interface text. */
const bars = (x: number, y: number, widths: number[], colour: string, h = 12, step = 22) =>
  widths
    .map(
      (w, i) =>
        `<rect x="${x}" y="${y + i * step}" width="${w}" height="${h}" rx="${h / 2}" fill="${colour}"/>`,
    )
    .join("");

// ── LinkedIn ───────────────────────────────────────────────────────────────────────────────────────────────

async function linkedin(): Promise<Panel[]> {
  const panels: Panel[] = [];
  // Company Page, desktop: the cover 1128 px wide (scale 0.746), the logo tile over the lower left.
  for (const theme of ["light", "dark"] as Theme[]) {
    const u = UI[theme];
    const W = 1128;
    const ch = Math.round((256 * W) / 1512);
    const H = ch + 190;
    const cover = await resized(file("linkedin", "company-cover"), W, ch);
    const logo = await rounded(file("linkedin", "company-logo"), 128, 10, { width: 4, colour: u.bg });
    const chrome = svg(
      W,
      H,
      `${text(24, ch + 104, "Page name", 24, u.text, 'font-weight="600"')}${bars(24, ch + 124, [420, 300], u.block)}`,
    );
    panels.push({
      title: `LinkedIn company Page, desktop (${theme}): cover 1512 × 256 shown at 1128 px, logo tile over the lower left`,
      buf: await canvas(W, H, u.bg, [
        { input: cover, left: 0, top: 0 },
        { input: chrome, left: 0, top: 0 },
        { input: logo, left: 20, top: ch - 66 },
      ]),
      w: W,
      h: H,
    });
  }
  // Company Page, phone: the cover cropped to the screen width (375 px, centre), logo over the left.
  {
    const u = UI.light;
    const W = 375;
    const ch = 96;
    const coverFull = await resized(file("linkedin", "company-cover"), Math.round((1512 * ch) / 256), ch);
    const left = Math.round(((1512 * ch) / 256 - W) / 2);
    const cover = await sharp(coverFull).extract({ left, top: 0, width: W, height: ch }).png().toBuffer();
    const logo = await rounded(file("linkedin", "company-logo"), 72, 6, { width: 3, colour: u.bg });
    const H = ch + 140;
    panels.push({
      title: "LinkedIn company Page, phone 375 px: if the cover is trimmed to the screen, the centre stays",
      buf: await canvas(W, H, u.bg, [
        { input: cover, left: 0, top: 0 },
        {
          input: svg(
            W,
            H,
            `${text(16, ch + 72, "Page name", 20, u.text, 'font-weight="600"')}${bars(16, ch + 88, [260, 180], u.block)}`,
          ),
          left: 0,
          top: 0,
        },
        { input: logo, left: 13, top: ch - 40 },
      ]),
      w: W,
      h: H,
    });
  }
  // Founder's profile: desktop photo bottom-left, phone photo (per the brief) bottom-centre. Grey placeholder photo.
  for (const view of ["desktop", "phone"] as const) {
    const u = UI.light;
    const W = view === "desktop" ? 1128 : 375;
    const ch = Math.round((396 * W) / 1584);
    const d = view === "desktop" ? 152 : 92;
    const cover = await resized(file("linkedin", "founder-background"), W, ch);
    const H = ch + d / 2 + 100;
    const cx = view === "desktop" ? 24 + d / 2 : W / 2;
    const photo = svg(
      d + 8,
      d + 8,
      `<circle cx="${d / 2 + 4}" cy="${d / 2 + 4}" r="${d / 2 + 4}" fill="#fff"/><circle cx="${d / 2 + 4}" cy="${d / 2 + 4}" r="${d / 2}" fill="#B9BEC2"/>${text(d / 2 + 4, d / 2 + 9, "photo", 14, "#555", 'text-anchor="middle"')}`,
    );
    panels.push({
      title: `LinkedIn founder background, ${view}: 1584 × 396 at ${W} px with a placeholder photo`,
      buf: await canvas(W, H, u.bg, [
        { input: cover, left: 0, top: 0 },
        { input: photo, left: Math.round(cx - d / 2 - 4), top: Math.round(ch - d / 2 - 4) },
        {
          input: svg(W, H, bars(view === "desktop" ? 24 : 16, ch + d / 2 + 24, [240, 360], u.block)),
          left: 0,
          top: 0,
        },
      ]),
      w: W,
      h: H,
    });
  }
  return panels;
}

// ── X ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function x(): Promise<Panel[]> {
  const panels: Panel[] = [];
  for (const theme of ["light", "dark"] as Theme[]) {
    const u = UI[theme];
    const W = 600;
    const hh = 200;
    const header = await resized(file("x", "header"), W, hh);
    const avatar = await circle(file("x", "profile"), 134, { width: 4, colour: u.bg });
    const H = hh + 200;
    panels.push({
      title: `X profile, ${theme}: header 1500 × 500 at 600 px, profile photo over the lower left`,
      buf: await canvas(W, H, u.bg, [
        { input: header, left: 0, top: 0 },
        { input: avatar, left: 12, top: hh - 71 },
        {
          input: svg(
            W,
            H,
            `${text(16, hh + 104, "Account name", 20, u.text, 'font-weight="700"')}${bars(16, hh + 120, [140, 420, 300], u.block)}`,
          ),
          left: 0,
          top: 0,
        },
      ]),
      w: W,
      h: H,
    });
  }
  // The worst-case crop: 60 px off the top and bottom.
  {
    const s = 0.6;
    const W = 900;
    const H = 300;
    const header = await resized(file("x", "header"), W, H);
    const crop = svg(
      W,
      H,
      `<rect width="${W}" height="${60 * s}" fill="#C0392B" fill-opacity="0.55"/><rect y="${H - 60 * s}" width="${W}" height="${60 * s}" fill="#C0392B" fill-opacity="0.55"/>`,
    );
    panels.push({
      title: "X header with the 60 px top and bottom crop shaded, and the safe zone",
      buf: await canvas(W, H, "#fff", [
        { input: header, left: 0, top: 0 },
        { input: crop, left: 0, top: 0 },
        {
          input: zones(
            [{ zone: item("x", "header").safe[0] as Zone, colour: "#F5C542", label: "safe" }],
            s,
            W,
            H,
          ),
          left: 0,
          top: 0,
        },
      ]),
      w: W,
      h: H,
    });
  }
  return panels;
}

// ── Facebook ───────────────────────────────────────────────────────────────────────────────────────────────

async function facebook(): Promise<Panel[]> {
  const panels: Panel[] = [];
  const full = file("facebook", "cover");
  const it = item("facebook", "cover");
  // The whole image with the crops and the safe zone.
  {
    const s = 1;
    panels.push({
      title:
        "Facebook cover 851 × 315 at 100 %: safe zone (yellow), the left-aligned 16:9 and 2.4:1 crop edges (red)",
      buf: await canvas(851, 315, "#fff", [
        { input: await resized(full, 851, 315), left: 0, top: 0 },
        {
          input: zones(
            [
              { zone: it.safe[0] as Zone, colour: "#F5C542", label: "safe" },
              { zone: { shape: "rect", x: 0, y: 0, w: 560, h: 315 }, colour: "#E74C3C", label: "16:9 crop" },
              { zone: { shape: "rect", x: 0, y: 0, w: 756, h: 315 }, colour: "#FF8A80" },
            ],
            s,
            851,
            315,
          ),
          left: 0,
          top: 0,
        },
      ]),
      w: 851,
      h: 315,
    });
  }
  // Desktop, read literally: the cover fills a 16:9 box from the left (shown at 560 × 315).
  for (const view of [
    { name: "computer (16:9 from the left)", cw: 560, avatar: 176, ax: 16, overlap: 88 },
    { name: "phone (2.4:1 from the left, 375 px wide)", cw: 756, avatar: 0, ax: 16, overlap: 40 },
  ]) {
    const u = UI.light;
    const phone = view.avatar === 0;
    const W = phone ? 375 : 560;
    const ch = phone ? Math.round(375 / 2.4) : 315;
    const scale = ch / 315;
    const crop = await sharp(await resized(full, Math.round(851 * scale), ch))
      .extract({ left: 0, top: 0, width: W, height: ch })
      .png()
      .toBuffer();
    const d = phone ? 120 : 176;
    const avatar = await circle(file("facebook", "profile"), d, { width: 4, colour: u.bg });
    const top = ch - (phone ? 40 : d / 2) - 4;
    const H = top + d + 80;
    panels.push({
      title: `Facebook Page, ${view.name}`,
      buf: await canvas(W, H, u.bg, [
        { input: crop, left: 0, top: 0 },
        { input: avatar, left: phone ? 12 : 16, top },
        {
          input: svg(
            W,
            H,
            `${text(16, top + d + 40, "Page name", 20, u.text, 'font-weight="700"')}${bars(16, top + d + 52, [160], u.block)}`,
          ),
          left: 0,
          top: 0,
        },
      ]),
      w: W,
      h: H,
    });
  }
  return panels;
}

// ── YouTube ────────────────────────────────────────────────────────────────────────────────────────────────

async function youtube(): Promise<Panel[]> {
  const f = file("youtube", "banner");
  const it = item("youtube", "banner");
  const s = 0.4;
  const W = 1024;
  const H = 576;
  const tv = await canvas(W, H, "#000", [
    { input: await resized(f, W, H), left: 0, top: 0 },
    {
      input: zones(
        [
          { zone: { shape: "rect", x: 0, y: 509, w: 2560, h: 423 }, colour: "#5DADE2", label: "desktop" },
          { zone: it.safe[0] as Zone, colour: "#F5C542", label: "every device: 1546 × 423" },
        ],
        s,
        W,
        H,
      ),
      left: 0,
      top: 0,
    },
  ]);
  const desktop = await sharp(await resized(f, 1280, 720))
    .extract({ left: 0, top: 254, width: 1280, height: 212 })
    .png()
    .toBuffer();
  const phoneFull = await resized(f, Math.round(2560 * (375 / 1546)), Math.round(1440 * (375 / 1546)));
  const phone = await sharp(phoneFull)
    .extract({
      left: Math.round(507 * (375 / 1546)),
      top: Math.round(509 * (375 / 1546)),
      width: 375,
      height: Math.round(423 * (375 / 1546)),
    })
    .png()
    .toBuffer();
  const avatar = await circle(file("youtube", "profile"), 98);
  const u = UI.light;
  const ph = Math.round(423 * (375 / 1546));
  const phoneUi = await canvas(375, ph + 150, u.bg, [
    { input: phone, left: 0, top: 0 },
    { input: avatar, left: 16, top: ph + 16 },
    {
      input: svg(
        375,
        ph + 150,
        `${text(128, ph + 52, "Channel name", 20, u.text, 'font-weight="700"')}${bars(128, ph + 66, [150, 110], u.block)}`,
      ),
      left: 0,
      top: 0,
    },
  ]);
  return [
    {
      title:
        "YouTube banner 2560 × 1440 on a TV (the whole image), with the desktop band and the all-devices zone",
      buf: tv,
      w: W,
      h: H,
    },
    { title: "YouTube desktop: the full-width band (shown at 1280 px)", buf: desktop, w: 1280, h: 212 },
    {
      title: "YouTube phone 375 px: only the centre 1546 × 423, and the channel picture at 98 px",
      buf: phoneUi,
      w: 375,
      h: ph + 150,
    },
  ];
}

// ── Instagram ──────────────────────────────────────────────────────────────────────────────────────────────

const HIGHLIGHTS = ["services", "work", "about", "contact"] as const;

async function instagram(): Promise<Panel[]> {
  const panels: Panel[] = [];
  for (const theme of ["light", "dark"] as Theme[]) {
    const u = UI[theme];
    const W = 390;
    const H = 520;
    const avatar = await circle(file("instagram", "profile"), 86, { width: 3, colour: u.bg });
    const layers: Layer[] = [{ input: avatar, left: 16, top: 70 }];
    let body = `${text(W / 2, 36, "account_name", 17, u.text, 'text-anchor="middle" font-weight="700"')}`;
    body += `${text(124, 104, "Posts", 13, u.muted)}${text(204, 104, "Followers", 13, u.muted)}${text(300, 104, "Following", 13, u.muted)}`;
    body += `${text(16, 190, "Business name", 14, u.text, 'font-weight="600"')}${bars(16, 200, [300, 220], u.block, 10, 18)}`;
    // the highlight circles (Instagram draws a thin ring and prints the name underneath)
    const d = 64;
    for (const [i, h] of HIGHLIGHTS.entries()) {
      const x0 = 16 + i * 88;
      // Instagram crops the story's centre square into the circle
      const centre = await sharp(file("instagram", `highlight-${h}`))
        .extract({ left: 0, top: 420, width: 1080, height: 1080 })
        .png()
        .toBuffer();
      const tmp = join(out, `tmp-hl-${h}.png`);
      await sharp(centre).toFile(tmp);
      layers.push({
        input: await circle(tmp, d, { width: 3, colour: theme === "light" ? "#DBDBDB" : "#363636" }),
        left: x0,
        top: 262,
      });
      body += text(
        x0 + d / 2 + 3,
        262 + d + 26,
        `${h[0]?.toUpperCase()}${h.slice(1)}`,
        12,
        u.text,
        'text-anchor="middle"',
      );
    }
    // the first row of the grid: the two post templates, cropped 4:5 → the 3:4 grid tile
    const tile = 128;
    const sq = await resized(file("instagram", "post-template-square"), tile, tile);
    const pt = await sharp(
      await resized(file("instagram", "post-template-portrait"), tile, Math.round((tile * 1350) / 1080)),
    )
      .extract({ left: 0, top: Math.round(((tile * 1350) / 1080 - tile) / 2), width: tile, height: tile })
      .png()
      .toBuffer();
    layers.push({ input: sq, left: 0, top: 384 }, { input: pt, left: tile + 3, top: 384 });
    body += `<rect x="${2 * tile + 6}" y="384" width="${W - 2 * tile - 6}" height="${tile}" fill="${u.block}"/>`;
    panels.push({
      title: `Instagram profile (${theme}): photo, the four highlight covers with their names, two post frames in the grid`,
      buf: await canvas(W, H, u.bg, [{ input: svg(W, H, body), left: 0, top: 0 }, ...layers]),
      w: W,
      h: H,
    });
  }
  // the full stories and the post templates, scaled
  const row: Layer[] = [];
  for (const [i, h] of HIGHLIGHTS.entries())
    row.push({ input: await resized(file("instagram", `highlight-${h}`), 180, 320), left: i * 196, top: 0 });
  panels.push({
    title: "Highlight covers, the whole 1080 × 1920 story (Instagram shows only the centre circle)",
    buf: await canvas(4 * 196 - 16, 320, SHEET_BG, row),
    w: 4 * 196 - 16,
    h: 320,
  });
  panels.push({
    title: "Post templates 1080 × 1080 and 1080 × 1350 (headline area dashed; empty on purpose)",
    buf: await canvas(1000, 540, SHEET_BG, [
      { input: await resized(file("instagram", "post-template-square"), 432, 432), left: 0, top: 0 },
      {
        input: zones(
          [
            {
              zone: item("instagram", "post-template-square").overlays[0]?.zone as Zone,
              colour: "#F5C542",
              label: "headline",
            },
          ],
          0.4,
          432,
          432,
        ),
        left: 0,
        top: 0,
      },
      { input: await resized(file("instagram", "post-template-portrait"), 432, 540), left: 480, top: 0 },
      {
        input: zones(
          [
            {
              zone: item("instagram", "post-template-portrait").overlays[0]?.zone as Zone,
              colour: "#F5C542",
              label: "headline",
            },
          ],
          0.4,
          432,
          540,
        ),
        left: 480,
        top: 0,
      },
    ]),
    w: 1000,
    h: 540,
  });
  return panels;
}

// ── Threads (no cover or banner: the profile picture sits to the right of the name) ───────────────────────

async function threads(): Promise<Panel[]> {
  const panels: Panel[] = [];
  for (const theme of ["light", "dark"] as Theme[]) {
    const u = theme === "light" ? UI.light : { ...UI.dark, bg: "#101010" };
    const W = 390;
    const H = 260;
    const body =
      text(16, 64, "Business name", 24, u.text, 'font-weight="700"') +
      text(16, 88, "account_name", 14, u.muted) +
      bars(16, 112, [260, 200], u.block) +
      `<rect x="16" y="190" width="173" height="34" rx="10" fill="none" stroke="${u.line}"/><rect x="201" y="190" width="173" height="34" rx="10" fill="none" stroke="${u.line}"/>`;
    // a post row: the picture at 36 px
    panels.push({
      title: `Threads profile (${theme}): the picture at 84 px beside the name`,
      buf: await canvas(W, H, u.bg, [
        { input: svg(W, H, body), left: 0, top: 0 },
        { input: await circle(file("threads", "profile"), 84), left: W - 16 - 84, top: 36 },
      ]),
      w: W,
      h: H,
    });
  }
  {
    const u = UI.light;
    const W = 390;
    const H = 96;
    panels.push({
      title: "Threads feed: the picture at 36 px beside a post",
      buf: await canvas(W, H, u.bg, [
        { input: await circle(file("threads", "profile"), 36), left: 16, top: 16 },
        {
          input: svg(
            W,
            H,
            `${text(64, 30, "account_name", 14, u.text, 'font-weight="600"')}${bars(64, 42, [290, 220], u.block, 10, 18)}`,
          ),
          left: 0,
          top: 0,
        },
      ]),
      w: W,
      h: H,
    });
  }
  return panels;
}

// ── WhatsApp Business ──────────────────────────────────────────────────────────────────────────────────────

async function whatsapp(): Promise<Panel[]> {
  const panels: Panel[] = [];
  for (const theme of ["light", "dark"] as Theme[]) {
    const u = theme === "light" ? UI.light : { ...UI.dark, bg: "#0B141A", block: "#1F2C33" };
    const W = 390;
    const ch = Math.round((640 * W) / 1920); // assumed: the 3:1 band of the 16:9 cover (no official spec)
    const coverFull = await resized(file("whatsapp-business", "cover"), W, Math.round((W * 1080) / 1920));
    const cover = await sharp(coverFull)
      .extract({ left: 0, top: Math.round((220 * W) / 1920), width: W, height: ch })
      .png()
      .toBuffer();
    const d = 120;
    const avatar = await circle(file("whatsapp-business", "profile"), d, { width: 4, colour: u.bg });
    const H = ch + d / 2 + 200;
    const body =
      text(W / 2, ch + d / 2 + 44, "Business name", 22, u.text, 'text-anchor="middle" font-weight="600"') +
      text(W / 2, ch + d / 2 + 68, "Business account", 13, u.muted, 'text-anchor="middle"') +
      bars(24, ch + d / 2 + 96, [342, 300, 240], u.block, 12, 24);
    panels.push({
      title: `WhatsApp Business profile (${theme}), assumed: 3:1 band, photo centred on its edge`,
      buf: await canvas(W, H, u.bg, [
        { input: cover, left: 0, top: 0 },
        { input: avatar, left: W / 2 - d / 2 - 4, top: ch - d / 2 - 4 },
        { input: svg(W, H, body), left: 0, top: 0 },
      ]),
      w: W,
      h: H,
    });
  }
  // chat list: the photo at 49 px
  {
    const u = UI.light;
    const W = 390;
    const H = 72 * 3;
    const layers: Layer[] = [];
    let body = "";
    for (let i = 0; i < 3; i++) {
      const y = i * 72;
      if (i === 1)
        layers.push({ input: await circle(file("whatsapp-business", "profile"), 49), left: 14, top: y + 11 });
      else body += `<circle cx="${14 + 24.5}" cy="${y + 35.5}" r="24.5" fill="#C7CCD0"/>`;
      body += bars(76, y + 20, [i === 1 ? 140 : 110, 220], u.block, 11, 20);
    }
    panels.push({
      title: "WhatsApp chat list: the profile photo at 49 px (middle row)",
      buf: await canvas(W, H, u.bg, [{ input: svg(W, H, body), left: 0, top: 0 }, ...layers]),
      w: W,
      h: H,
    });
  }
  panels.push({
    title: "WhatsApp Business cover 1920 × 1080 (at 40 %): safe zone, a centred square crop and a 3:1 band",
    buf: await canvas(768, 432, "#fff", [
      { input: await resized(file("whatsapp-business", "cover"), 768, 432), left: 0, top: 0 },
      {
        input: zones(
          [
            { zone: item("whatsapp-business", "cover").safe[0] as Zone, colour: "#F5C542", label: "safe" },
            { zone: { shape: "rect", x: 420, y: 0, w: 1080, h: 1080 }, colour: "#E74C3C", label: "square" },
            { zone: { shape: "rect", x: 0, y: 220, w: 1920, h: 640 }, colour: "#5DADE2", label: "3:1" },
          ],
          0.4,
          768,
          432,
        ),
        left: 0,
        top: 0,
      },
    ]),
    w: 768,
    h: 432,
  });
  return panels;
}

// ── Google, Upwork, Clutch, GoodFirms, GitHub ──────────────────────────────────────────────────────────────

async function others(): Promise<Panel[]> {
  const panels: Panel[] = [];
  {
    const u = UI.light;
    const W = 420;
    const H = 360;
    panels.push({
      title: "Google Business Profile: cover at the top of the panel, logo as a circle",
      buf: await canvas(W, H, u.bg, [
        {
          input: await resized(file("google-business", "cover"), W, Math.round((W * 9) / 16)),
          left: 0,
          top: 0,
        },
        {
          input: await circle(file("google-business", "logo"), 64, { width: 3, colour: u.bg }),
          left: 16,
          top: Math.round((W * 9) / 16) - 34,
        },
        {
          input: svg(
            W,
            H,
            `${text(96, Math.round((W * 9) / 16) + 30, "Business name", 18, u.text, 'font-weight="600"')}${bars(96, Math.round((W * 9) / 16) + 44, [200, 140], u.block)}`,
          ),
          left: 0,
          top: 0,
        },
      ]),
      w: W,
      h: H,
    });
  }
  {
    const W = 1600;
    const bh = 160;
    const banner = await resized(file("upwork", "agency-banner"), W, bh);
    panels.push({
      title: "Upwork agency banner 3200 × 320 at 1600 px, with a narrow (1600 px, centred) crop outlined",
      buf: await canvas(W, bh + 110, "#fff", [
        { input: banner, left: 0, top: 0 },
        {
          input: zones(
            [
              {
                zone: { shape: "rect", x: 800, y: 0, w: 1600, h: 320 },
                colour: "#E74C3C",
                label: "narrow screen",
              },
            ],
            0.5,
            W,
            bh,
          ),
          left: 0,
          top: 0,
        },
        {
          input: await rounded(file("upwork", "agency-logo"), 100, 8, { width: 4, colour: "#fff" }),
          left: 24,
          top: bh - 50,
        },
        {
          input: svg(W, bh + 110, `${text(150, bh + 40, "Agency name", 22, INK, 'font-weight="600"')}`),
          left: 0,
          top: 0,
        },
      ]),
      w: W,
      h: bh + 110,
    });
  }
  {
    const W = 1000;
    const H = 230;
    const lock = await sharp(file("clutch", "lockup")).resize(480).png().toBuffer();
    const lockMeta = await sharp(lock).metadata();
    panels.push({
      title:
        "Clutch / GoodFirms: the square logo and the transparent lockup on white and on a light grey card",
      buf: await canvas(W, H, "#FFFFFF", [
        { input: await rounded(file("clutch", "logo"), 140, 12), left: 20, top: 40 },
        { input: lock, left: 200, top: 40 + Math.round((140 - (lockMeta.height ?? 0)) / 2) },
        { input: svg(300, 220, `<rect width="300" height="220" fill="#F2F3F5"/>`), left: 690, top: 5 },
        { input: await sharp(file("goodfirms", "lockup")).resize(260).png().toBuffer(), left: 710, top: 95 },
      ]),
      w: W,
      h: H,
    });
  }
  {
    const W = 840;
    const H = 300;
    const sizes = [260, 120, 48, 32, 20];
    const layers: Layer[] = [];
    let xx = 20;
    for (const d of sizes) {
      layers.push({
        input: await circle(file("github", "org-avatar"), d),
        left: xx,
        top: 20 + (260 - d) / 2,
      });
      xx += d + 30;
    }
    layers.push({ input: await rounded(file("github", "org-avatar"), 120, 8), left: xx, top: 90 });
    panels.push({
      title: "GitHub organisation avatar: circle at 260, 120, 48, 32 and 20 px; square at 120 px",
      buf: await canvas(W, H, "#F6F8FA", layers),
      w: W,
      h: H,
    });
  }
  return panels;
}

// ── Small sizes and 100 % crops ───────────────────────────────────────────────────────────────────────────

async function small(): Promise<Panel[]> {
  const W = 980;
  const H = 210;
  const layers: Layer[] = [];
  let body = "";
  let xx = 20;
  for (const [f, d, label] of [
    [file("x", "profile"), 134, "X 134"],
    [file("youtube", "profile"), 98, "YouTube 98"],
    [file("instagram", "profile"), 56, "Instagram feed 56"],
    [file("whatsapp-business", "profile"), 40, "WhatsApp 40"],
    [file("facebook", "profile"), 36, "Facebook 36"],
    [file("x", "profile"), 24, "24"],
  ] as const) {
    layers.push({ input: await circle(f, d), left: xx, top: 20 + (134 - d) / 2 });
    body += text(xx, 180, label, 13, INK);
    xx += Math.max(d, 90) + 30;
  }
  const dark = await canvas(W, H, "#000000", [...layers]);
  const light = await canvas(W, H, "#FFFFFF", [{ input: svg(W, H, body), left: 0, top: 0 }, ...layers]);
  // highlight circles at 60 px
  const hl: Layer[] = [];
  for (const [i, h] of HIGHLIGHTS.entries())
    hl.push({ input: await circle(join(out, `tmp-hl-${h}.png`), 60), left: 20 + i * 90, top: 20 });
  return [
    { title: "Profile pictures at their smallest display sizes (light)", buf: light, w: W, h: H },
    { title: "The same on black", buf: dark, w: W, h: H },
    { title: "Highlight covers at 60 px", buf: await canvas(400, 100, "#FFFFFF", hl), w: 400, h: 100 },
  ];
}

async function crops(): Promise<Panel[]> {
  const panels: Panel[] = [];
  for (const [platform, name, left, top, w, h] of [
    ["x", "header", 880, 150, 520, 200],
    ["linkedin", "company-cover", 700, 60, 520, 140],
    ["facebook", "cover", 260, 60, 280, 170],
    ["youtube", "banner", 1270, 560, 700, 320],
    ["instagram", "highlight-contact", 260, 680, 560, 560],
    ["instagram", "post-template-square", 60, 60, 520, 120],
    ["x", "profile@2x", 160, 160, 480, 480],
  ] as const) {
    const f = join(kit, platform, `${name}.png`);
    panels.push({
      title: `${platform}/${name}.png at 100 % (x ${left}, y ${top})`,
      buf: await sharp(f).extract({ left, top, width: w, height: h }).png().toBuffer(),
      w,
      h,
    });
  }
  return panels;
}

async function overview(): Promise<Panel[]> {
  const panels: Panel[] = [];
  for (const it of SOCIAL_ITEMS) {
    const maxW = 560;
    const maxH = 320;
    const s = Math.min(maxW / it.width, maxH / it.height, 1);
    const w = Math.round(it.width * s);
    const h = Math.round(it.height * s);
    const img = await resized(file(it.platform, it.name), w, h);
    const bg = it.transparent ? "#FFFFFF" : SHEET_BG;
    panels.push({
      title: `${it.platform}/${it.name} ${it.width} × ${it.height}`,
      buf: await canvas(maxW, h, bg, [{ input: img, left: 0, top: 0 }]),
      w: maxW,
      h,
    });
  }
  return panels;
}

await sheet(
  "01-overview",
  "TecHaust social kit: every image (scaled; transparent lockups on white)",
  await overview(),
  3,
);
await sheet("02-linkedin", "LinkedIn", await linkedin(), 1);
await sheet("03-x", "X", await x(), 2);
await sheet("04-facebook", "Facebook", await facebook(), 1);
await sheet("05-youtube", "YouTube", await youtube(), 1);
await sheet(
  "06-instagram-threads",
  "Instagram and Threads",
  [...(await instagram()), ...(await threads())],
  2,
);
await sheet(
  "07-whatsapp-business",
  "WhatsApp Business (no official spec: check on a real phone)",
  await whatsapp(),
  2,
);
await sheet(
  "08-google-upwork-directories-github",
  "Google Business Profile, Upwork, Clutch, GoodFirms, GitHub",
  await others(),
  1,
);
await sheet("09-small-sizes", "Small sizes", await small(), 1);
await sheet("10-crops-100", "100 % crops (edges and type at the real pixel size)", await crops(), 2);
// The centre squares cut from the highlight covers were only needed for the mock-ups.
for (const h of HIGHLIGHTS) rmSync(join(out, `tmp-hl-${h}.png`), { force: true });
