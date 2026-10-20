#!/usr/bin/env python3
"""Placeholder icon (450x450) and widget preview (328x552) as PNG, without extra libraries. Replace with real artwork."""
import struct, zlib, math, sys, os

def png(path, w, h, pixel):
    rows = []
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            row += bytes(pixel(x, y))
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(data)

def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def in_rounded(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

GEEL, AMBER, INKT, WIT = (255, 210, 0), (242, 150, 0), (20, 22, 28), (255, 255, 255)

def icon(x, y, w=450, h=450):
    t = (x + y) / (w + h)
    bg = mix(GEEL, AMBER, t)
    # a dark rounded "screen" with a sun and three bars
    if in_rounded(x, y, 70, 95, 380, 355, 34):
        if (x - 150) ** 2 + (y - 175) ** 2 <= 42 ** 2:
            return GEEL
        for i, (bx0, bx1) in enumerate([(220, 340), (220, 310), (220, 325)]):
            by = 150 + i * 36
            if in_rounded(x, y, bx0, by, bx1, by + 16, 8):
                return WIT
        if in_rounded(x, y, 100, 268, 350, 320, 18):
            return (58, 62, 72)
        return INKT
    return bg

def preview(x, y, w=328, h=552):
    if in_rounded(x, y, 10, 10, 318, 542, 28):
        # white card with a title bar, a big temperature block and three list lines
        if in_rounded(x, y, 28, 30, 200, 52, 8):
            return INKT
        if (x - 70) ** 2 + (y - 120) ** 2 <= 30 ** 2:
            return AMBER
        if in_rounded(x, y, 115, 92, 260, 150, 10):
            return INKT
        for i in range(3):
            by = 200 + i * 44
            if in_rounded(x, y, 28, by, 300 - i * 40, by + 18, 9):
                return (230, 231, 235)
        if in_rounded(x, y, 28, 470, 150, 512, 21):
            return GEEL
        if in_rounded(x, y, 165, 470, 300, 512, 21):
            return (245, 246, 248)
        return WIT
    return mix(GEEL, AMBER, (x + y) / (w + h))

out = sys.argv[1] if len(sys.argv) > 1 else 'assets'
os.makedirs(out, exist_ok=True)
png(os.path.join(out, 'icon-450.png'), 450, 450, icon)
png(os.path.join(out, 'preview-328x552.png'), 328, 552, preview)
print('geschreven:', os.path.join(out, 'icon-450.png'), os.path.join(out, 'preview-328x552.png'))
