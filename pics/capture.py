#!/usr/bin/env python3
"""Capture 5 screenshots of the CSV to Sheets extension popup at 1280×800.

The popup is narrow (408 px) by design, so we render it at its natural width
and then composite it centered onto a 1280×800 canvas with the extension's
own background colour, producing presentation-ready images.

Run:
  python3 pics/capture.py          # if playwright+pillow are installed
"""
import pathlib
from io import BytesIO
from PIL import Image
from playwright.sync_api import sync_playwright

# Final output dimensions
OUT_W, OUT_H = 1280, 800
# The soft grey background from popup.css  --g-grey-50
BG_COLOR = (248, 249, 250, 255)

def composite(popup_png_bytes):
    """Centre a popup screenshot onto a 1280×800 canvas."""
    fg = Image.open(BytesIO(popup_png_bytes)).convert("RGBA")
    # If the popup is taller than the canvas, crop from the top
    if fg.height > OUT_H:
        fg = fg.crop((0, 0, fg.width, OUT_H))
    canvas = Image.new("RGBA", (OUT_W, OUT_H), BG_COLOR)
    x = (OUT_W - fg.width) // 2
    y = (OUT_H - fg.height) // 2
    canvas.paste(fg, (x, y), fg)
    return canvas.convert("RGB")

def save(img, path):
    img.save(str(path), "PNG")
    print(f"  ✓ {path.name}  ({img.width}×{img.height})")

def main():
    workspace = pathlib.Path(__file__).resolve().parent.parent
    popup_url = (workspace / "popup.html").resolve().as_uri()
    pics = workspace / "pics"
    pics.mkdir(exist_ok=True)
    csv_path = pics / "_sample.csv"

    csv_path.write_text(
        "Day,Campaign,Network,Clicks,Imps,Cost,Revenue\n"
        "2026-06-01,Search_Brand_US,Google Search,120,1500,$45.50,$180.00\n"
        "2026-06-01,Display_Prospecting,Google Display,450,15000,$112.10,$95.00\n"
        "2026-06-02,Search_Brand_US,Google Search,180,2300,$68.20,$250.00\n"
        "2026-06-02,Display_Prospecting,Google Display,320,12000,$90.40,$80.00\n"
        "2026-06-03,Search_Brand_US,Google Search,150,1900,$55.00,$210.00\n"
        "2026-06-03,Display_Prospecting,Google Display,410,14000,$105.30,$110.00\n"
    )

    print(f"Popup : {popup_url}")
    print(f"Output: {pics}  (1280×800)\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--force-color-profile=srgb"])
        page = browser.new_page(viewport={"width": 408, "height": 800})
        page.goto(popup_url)
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(600)

        # ---- 1. Empty state ----
        raw = page.screenshot(full_page=False)
        save(composite(raw), pics / "01_empty_state.png")

        # ---- 2. File uploaded ----
        page.set_input_files("#file-input", str(csv_path))
        page.wait_for_timeout(600)
        page.click("#head-upload")  # re-expand Step 1
        page.wait_for_timeout(400)
        raw = page.screenshot(full_page=False)
        save(composite(raw), pics / "02_file_uploaded.png")

        # ---- 3. Target headers entered ----
        page.click("#head-upload")  # collapse Step 1
        page.wait_for_timeout(300)
        page.fill("#input-target-headers",
                  "Date, Campaign, Clicks, Spend, Revenue, CTR")
        page.evaluate(
            "document.getElementById('input-target-headers')"
            ".dispatchEvent(new Event('input'))")
        page.wait_for_timeout(600)
        raw = page.screenshot(full_page=False)
        save(composite(raw), pics / "03_headers_entered.png")

        # ---- 4. Column mapping adjusted ----
        page.select_option("select[data-target='Spend']", "5")
        page.evaluate(
            "document.querySelector(\"select[data-target='Spend']\")"
            ".dispatchEvent(new Event('change'))")
        page.select_option("select[data-target='Date']", "0")
        page.evaluate(
            "document.querySelector(\"select[data-target='Date']\")"
            ".dispatchEvent(new Event('change'))")
        page.wait_for_timeout(600)
        # Scroll so the mapping section is prominent
        page.evaluate("document.querySelector('#module-headers')"
                      ".scrollIntoView({block:'start'})")
        page.wait_for_timeout(300)
        raw = page.screenshot(full_page=False)
        save(composite(raw), pics / "04_column_mapping.png")

        # ---- 5. Preview with totals + sorting ----
        page.evaluate("document.getElementById('chk-totals').click()")
        page.select_option("#select-sort-by", "2")
        page.evaluate(
            "document.getElementById('select-sort-by')"
            ".dispatchEvent(new Event('change'))")
        page.select_option("#select-sort-dir", "desc")
        page.evaluate(
            "document.getElementById('select-sort-dir')"
            ".dispatchEvent(new Event('change'))")
        page.wait_for_timeout(600)
        # Scroll to show the preview table
        page.evaluate("document.querySelector('#preview-card')"
                      ".scrollIntoView({block:'center'})")
        page.wait_for_timeout(300)
        raw = page.screenshot(full_page=False)
        save(composite(raw), pics / "05_preview_and_copy.png")

        browser.close()

    csv_path.unlink(missing_ok=True)
    print(f"\nDone — 5 screenshots at 1280×800 in {pics}/")

if __name__ == "__main__":
    main()
