#!/usr/bin/env python3
"""Build the branded WatchPost source icon from the lighthouse line-art.

Composites `src/assets/lighthouse.png` (black art on transparency) onto a
rounded graphite (#1a1a1a) background with a white lighthouse.

Output: `app-icon.png` (1024x1024). Feed it to `npx tauri icon app-icon.png`
to regenerate every platform icon under `src-tauri/icons/`.

Usage:
    python scripts/make_icon.py
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "assets", "lighthouse.png")
OUT = os.path.join(ROOT, "app-icon.png")

SIZE = 1024
MARGIN = 40                     # transparent margin around the rounded square
RADIUS = 224                    # corner radius (~macOS squircle feel)
ART_SCALE = 0.60                # lighthouse size relative to the canvas
BG_RGB = (26, 26, 26)           # graphite (greyish black) #1A1A1A
ART_RGB = (255, 255, 255)       # white lighthouse


def main() -> None:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # Rounded-square graphite background.
    bg = Image.new("RGBA", (SIZE, SIZE), (*BG_RGB, 255))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN), radius=RADIUS, fill=255
    )
    canvas.paste(bg, (0, 0), mask)

    # Recolor the lighthouse to light, preserving its anti-aliased alpha.
    art = Image.open(SRC).convert("RGBA")
    target = int(SIZE * ART_SCALE)
    art = art.resize((target, target), Image.LANCZOS)
    light = Image.new("RGBA", art.size, (*ART_RGB, 255))
    light.putalpha(art.split()[3])

    pos = ((SIZE - target) // 2, (SIZE - target) // 2)
    canvas.alpha_composite(light, pos)

    canvas.save(OUT)
    print(f"wrote {OUT} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
