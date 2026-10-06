"""One-off (Windows): find the print CMYK for each brand colour with a real ICC profile.

For each colour, searches the CMYK space (4 % steps, total ink <= 300 %, the SWOP limit) for the recipe whose
measured colour (the profile's CMYK -> Lab table, relative colorimetric + black-point compensation) is closest to
the brand colour, and records the remaining error (Delta E 1976; under ~2 is not visible side by side).
Profile: Microsoft's RSWOP.icm (SWOP coated), shipped with Windows; colour engine LittleCMS via Pillow.
Writes tokens/print-cmyk.json (committed, so CI never needs the profile).
Run: python packages/ui/scripts/measure-cmyk.py
"""
import itertools
import json
import math
import pathlib

from PIL import Image, ImageCms

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROFILE = r"C:\Windows\System32\spool\drivers\color\RSWOP.icm"
KEYS = ["ink-900", "ink-700", "ink-400", "ink-300", "verdigris-700", "verdigris-500", "verdigris-300", "mist", "stone-200"]
STEP, TAC = 4, 300

palette = json.loads((ROOT / "tokens/tokens.json").read_text(encoding="utf8"))["palette"]
lab = ImageCms.createProfile("LAB")
cmyk = ImageCms.getOpenProfile(PROFILE)
c2lab = ImageCms.buildTransform(cmyk, lab, "CMYK", "LAB", ImageCms.Intent.RELATIVE_COLORIMETRIC, ImageCms.Flags.BLACKPOINTCOMPENSATION)
r2lab = ImageCms.buildTransform(ImageCms.createProfile("sRGB"), lab, "RGB", "LAB")
to_lab = lambda px: (px[0] * 100 / 255, px[1] - 128, px[2] - 128)

combos = [c for c in itertools.product(range(0, 101, STEP), repeat=4) if sum(c) <= TAC]
grid = Image.new("CMYK", (len(combos), 1))
grid.putdata([tuple(round(v * 2.55) for v in c) for c in combos])
measured = [to_lab(px) for px in ImageCms.applyTransform(grid, c2lab).get_flattened_data()]

out = {
    "source": f"LittleCMS {ImageCms.core.littlecms_version} via Pillow; profile RSWOP.icm (SWOP coated); "
    f"search {STEP} % steps, total ink <= {TAC} %; relative colorimetric + BPC",
    "note": "Starting values for offset/digital print: approve a printed proof against the hex colours before a full run.",
    "colours": {},
}
for k in KEYS:
    hx = palette[k]
    target = to_lab(ImageCms.applyTransform(Image.new("RGB", (1, 1), tuple(int(hx[i : i + 2], 16) for i in (1, 3, 5))), r2lab).getpixel((0, 0)))
    i = min(range(len(combos)), key=lambda j: math.dist(measured[j], target))
    out["colours"][k] = {"hex": hx, "cmyk": list(combos[i]), "deltaE76": round(math.dist(measured[i], target), 1)}
    print(f"{k:14s} {hx}  CMYK {combos[i]}  dE76 {out['colours'][k]['deltaE76']}")
(ROOT / "tokens/print-cmyk.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf8", newline="\n")
