#!/usr/bin/env python3
"""Render several white-on-dark icon options for review.

Outputs PNGs into scratchpad/icon-previews/ so we can compare and pick one.
Once chosen, the winning recipe is baked into scripts/make_icon.py.
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "assets", "lighthouse.png")
OUT_DIR = os.path.join(ROOT, "scratchpad", "icon-previews")

SIZE = 1024
MARGIN = 40
RADIUS = 224
ART_SCALE = 0.60
WHITE = (255, 255, 255)


def base_art() -> Image.Image:
    art = Image.open(SRC).convert("RGBA")
    target = int(SIZE * ART_SCALE)
    art = art.resize((target, target), Image.LANCZOS)
    light = Image.new("RGBA", art.size, (*WHITE, 255))
    light.putalpha(art.split()[3])
    return light


def rounded_mask() -> Image.Image:
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN), radius=RADIUS, fill=255
    )
    return mask


def vgrad(top, bottom) -> Image.Image:
    g = Image.new("RGBA", (SIZE, SIZE))
    d = ImageDraw.Draw(g)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        d.line(
            [(0, y), (SIZE, y)],
            fill=(
                round(top[0] + (bottom[0] - top[0]) * t),
                round(top[1] + (bottom[1] - top[1]) * t),
                round(top[2] + (bottom[2] - top[2]) * t),
                255,
            ),
        )
    return g


def compose(name: str, bg: Image.Image, ring: tuple | None = None) -> None:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(bg, (0, 0), rounded_mask())
    if ring is not None:
        ImageDraw.Draw(canvas).rounded_rectangle(
            (MARGIN + 6, MARGIN + 6, SIZE - MARGIN - 6, SIZE - MARGIN - 6),
            radius=RADIUS - 6,
            outline=ring,
            width=4,
        )
    canvas.alpha_composite(base_art(), ((SIZE - base_art().width) // 2,) * 2)
    path = os.path.join(OUT_DIR, f"{name}.png")
    canvas.save(path)
    print("wrote", path)


def flat(color) -> Image.Image:
    return Image.new("RGBA", (SIZE, SIZE), (*color, 255))


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    # 1: pure black, white art
    compose("1-pure-black", flat((0, 0, 0)))
    # 2: greyish black, flat
    compose("2-graphite", flat((26, 26, 26)))
    # 3: subtle vertical gradient (near-black -> charcoal)
    compose("3-gradient", vgrad((13, 13, 13), (38, 38, 38)))
    # 4: greyish black with a faint lighter ring
    compose("4-ring", flat((22, 22, 22)), ring=(70, 70, 70, 255))


if __name__ == "__main__":
    main()
