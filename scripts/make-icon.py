#!/usr/bin/env python3
"""Generates Lehtratuh app icons (PNG + multi-resolution ICO) in Fluent style."""
from PIL import Image, ImageDraw, ImageFilter
import math, os

S = 1024
SS = 2  # supersample factor on top of S
W = S * SS

def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

# ---------- base gradient squircle (Win11 app icon proportions) ----------
pad = int(W * 0.055)
inner = W - pad * 2
base = Image.new('RGBA', (W, W), (0, 0, 0, 0))

grad = Image.new('RGBA', (inner, inner), (0, 0, 0, 255))
gd = ImageDraw.Draw(grad)
for y in range(inner):
    t = y / inner
    r = int(28 + (8 - 28) * t)
    g = int(96 + (34 - 96) * t)
    b = int(190 + (116 - 190) * t)
    gd.line([(0, y), (inner, y)], fill=(r, g, b, 255))
base.paste(grad, (pad, pad), rounded_mask(inner, int(inner * 0.235)))

# subtle top highlight (composited, not pasted, so the body keeps its colour)
hl = Image.new('RGBA', (inner, inner), (0, 0, 0, 0))
hd = ImageDraw.Draw(hl)
for y in range(int(inner * 0.62)):
    a = int(60 * (1 - y / (inner * 0.62)) ** 1.7)
    hd.line([(0, y), (inner, y)], fill=(255, 255, 255, a))
from PIL import ImageChops
hl.putalpha(ImageChops.multiply(hl.split()[3], rounded_mask(inner, int(inner * 0.235))))
base.alpha_composite(hl, (pad, pad))

# ---------- aperture / lens mark ----------
layer = Image.new('RGBA', (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(layer)
cx = cy = W // 2
R = int(W * 0.30)
ring = int(W * 0.030)

# outer ring
d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=(255, 255, 255, 255), width=ring)

# six-blade iris: hexagon ring joined to the outer ring by spokes
hexR = R * 0.52
verts = [(cx + math.cos(math.radians(60 * i - 90)) * hexR,
          cy + math.sin(math.radians(60 * i - 90)) * hexR) for i in range(6)]
stroke = int(W * 0.021)
d.line(verts + [verts[0]], fill=(255, 255, 255, 255), width=stroke, joint='curve')
for v in verts:
    d.line([(cx + (v[0] - cx) * 0.02, cy + (v[1] - cy) * 0.02), v],
           fill=(255, 255, 255, 255), width=stroke)

# centre lens dot
d.ellipse([cx - stroke * 1.9, cy - stroke * 1.9, cx + stroke * 1.9, cy + stroke * 1.9],
          fill=(255, 255, 255, 255))

# soft inner glow behind the mark
glow = layer.filter(ImageFilter.GaussianBlur(int(W * 0.012)))
base.alpha_composite(glow)
base.alpha_composite(layer)

# drop shadow-ish inner border
border = Image.new('RGBA', (W, W), (0, 0, 0, 0))
bd = ImageDraw.Draw(border)
bd.rounded_rectangle([pad, pad, pad + inner - 1, pad + inner - 1], radius=int(inner * 0.235),
                     outline=(255, 255, 255, 46), width=int(W * 0.004))
base.alpha_composite(border)

icon = base.resize((S, S), Image.LANCZOS)

out_dir = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets')
os.makedirs(out_dir, exist_ok=True)
icon.save(os.path.join(out_dir, 'app.png'))

sizes = [256, 128, 64, 48, 32, 24, 16]
ico_path = os.path.join(out_dir, 'app.ico')
icon.save(ico_path, format='ICO', sizes=[(s, s) for s in sizes])
print('wrote', out_dir, os.listdir(out_dir))
