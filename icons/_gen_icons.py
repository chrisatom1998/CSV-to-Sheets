#!/usr/bin/env python3
"""Generate the extension icons (16/32/48/128).

Design: deep-slate squircle tile (visible on a white toolbar) + the gTech
four-color ring + bold white "CSV" wordmark inside it. Composed in HTML so the
bundled Outfit font is used, rendered at high res via Playwright, then
downscaled with PIL/LANCZOS. 16px is ring-only (CSV is illegible that small).

Run from the icons/ folder:  python3 _gen_icons.py
"""
import math
import pathlib
from io import BytesIO
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
FONTS = (HERE.parent / "fonts").as_uri()

# Palette --------------------------------------------------------------------
BG       = "#1E2436"   # deep slate tile
BG2      = "#11151F"   # squircle gradient bottom (subtle depth)
BLUE     = "#4285F4"
RED      = "#EA4335"
YELLOW   = "#FBBC05"
GREEN    = "#34A853"
INK      = "#FFFFFF"   # CSV wordmark

MASTER = 512           # render size before downscale


def pol(cx, cy, r, deg):
    a = math.radians(deg - 90)          # 0deg = top, clockwise
    return cx + r * math.cos(a), cy + r * math.sin(a)


def arc(cx, cy, r, start, end):
    x1, y1 = pol(cx, cy, r, start)
    x2, y2 = pol(cx, cy, r, end)
    large = 1 if (end - start) % 360 > 180 else 0
    return f"M {x1:.2f} {y1:.2f} A {r} {r} 0 {large} 1 {x2:.2f} {y2:.2f}"


def ring_svg(cx, cy, r, sw):
    """Four-color gTech ring with a gap at the top and small gaps between."""
    segs = [
        (BLUE,   12,   88.5),
        (GREEN,  98.5, 175),
        (YELLOW, 185,  261.5),
        (RED,    271.5, 348),
    ]
    out = []
    for color, s, e in segs:
        out.append(
            f'<path d="{arc(cx, cy, r, s, e)}" stroke="{color}" '
            f'stroke-width="{sw}" stroke-linecap="round" fill="none"/>'
        )
    return "\n".join(out)


def build_html(ring_only):
    c = MASTER / 2
    r = 158          # ring centerline radius
    sw = 74          # ring stroke width
    csv = "" if ring_only else (
        f'<text x="{c}" y="{c}" text-anchor="middle" '
        f'dominant-baseline="central" fill="{INK}" '
        f'font-family="Outfit, sans-serif" font-weight="700" '
        f'font-size="132" letter-spacing="-6" '
        f'style="font-feature-settings:\'kern\'">CSV</text>'
    )
    return f"""<!doctype html><html><head><meta charset="utf-8">
<style>
  @import url("{FONTS}/fonts.css");
  html,body{{margin:0;padding:0;background:transparent}}
  #tile{{width:{MASTER}px;height:{MASTER}px}}
</style></head>
<body>
<svg id="tile" width="{MASTER}" height="{MASTER}" viewBox="0 0 {MASTER} {MASTER}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{BG}"/>
      <stop offset="1" stop-color="{BG2}"/>
    </linearGradient>
  </defs>
  <rect x="14" y="14" width="{MASTER-28}" height="{MASTER-28}" rx="116"
        fill="url(#bg)"/>
  {ring_svg(c, c, r, sw)}
  {csv}
</svg>
</body></html>"""


def render(ring_only):
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width": MASTER, "height": MASTER},
                        device_scale_factor=2)
        pg.set_content(build_html(ring_only))
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(400)
        png = pg.locator("#tile").screenshot(omit_background=True)
        b.close()
    return Image.open(BytesIO(png)).convert("RGBA")


def main():
    full = render(ring_only=False)
    ring = render(ring_only=True)
    targets = {16: ring, 32: full, 48: full, 128: full}
    for size, src in targets.items():
        img = src.resize((size, size), Image.LANCZOS)
        img.save(HERE / f"icon{size}.png")
        print(f"wrote icon{size}.png")
    # contact sheet for visual review
    full.resize((128, 128), Image.LANCZOS).save("/tmp/icon_preview_full.png")
    ring.resize((128, 128), Image.LANCZOS).save("/tmp/icon_preview_ring.png")


if __name__ == "__main__":
    main()
