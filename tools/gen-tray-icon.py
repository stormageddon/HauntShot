"""Generate the HauntShot menubar template icon.

A capture frame with "HS" inside, both dissolving toward the right. Template
icons are drawn from alpha only, so everything is black with varying opacity.
No font rasterizer is available locally, so the letters are stroked geometry.
"""

import math
import pathlib
import struct
import zlib

OUTPUT = (
    pathlib.Path(__file__).resolve().parents[1]
    / "apps/desktop/src-tauri/icons/tray-template.png"
)

SIZE = 44
SS = 3  # supersampling per axis, on top of analytic edge antialiasing

FRAME_INSET = 4.0
FRAME_RADIUS = 7.0
FRAME_STROKE = 3.8

LETTER_TOP = 15.0
LETTER_BOTTOM = 29.0
LETTER_STROKE = 2.7
LETTER_WIDTH = 7.5
LETTER_GAP = 2.0

FADE_START = 0.42  # fraction of width where the mark starts dissolving
FADE_MIN = 0.12


def rounded_rect_sdf(x, y, cx, cy, half_w, half_h, r):
    dx = abs(x - cx) - (half_w - r)
    dy = abs(y - cy) - (half_h - r)
    return math.hypot(max(dx, 0.0), max(dy, 0.0)) + min(max(dx, dy), 0.0) - r


def segment_sdf(x, y, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = x - ax, y - ay
    len_sq = vx * vx + vy * vy
    t = 0.0 if len_sq == 0.0 else max(0.0, min(1.0, (wx * vx + wy * vy) / len_sq))
    return math.hypot(wx - vx * t, wy - vy * t)


def arc_points(cx, cy, r, start_deg, end_deg, steps):
    pts = []
    for i in range(steps + 1):
        a = math.radians(start_deg + (end_deg - start_deg) * i / steps)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def polyline_segments(points):
    return list(zip(points, points[1:]))


def build_letter_segments():
    """H and S as stroked centerlines, laid out side by side and centered."""
    total_w = LETTER_WIDTH * 2 + LETTER_GAP
    left = (SIZE - total_w) / 2.0
    top, bottom = LETTER_TOP, LETTER_BOTTOM
    middle = (top + bottom) / 2.0

    h_left = left
    h_right = left + LETTER_WIDTH
    segments = [
        ((h_left, top), (h_left, bottom)),
        ((h_right, top), (h_right, bottom)),
        ((h_left, middle), (h_right, middle)),
    ]

    # S: two tangent circles, top bowl swept one way and bottom bowl the other.
    r = (bottom - top) / 4.0
    s_cx = left + LETTER_WIDTH + LETTER_GAP + LETTER_WIDTH / 2.0
    segments += polyline_segments(arc_points(s_cx, top + r, r, -40, -270, 24))
    segments += polyline_segments(arc_points(s_cx, bottom - r, r, -90, 140, 24))
    return segments


LETTER_SEGMENTS = build_letter_segments()


def mark_sdf(x, y):
    """Signed distance to the whole mark: negative inside a stroke."""
    center = SIZE / 2.0
    half = SIZE / 2.0 - FRAME_INSET
    frame = abs(rounded_rect_sdf(x, y, center, center, half, half, FRAME_RADIUS))
    d = frame - FRAME_STROKE / 2.0

    for (ax, ay), (bx, by) in LETTER_SEGMENTS:
        d = min(d, segment_sdf(x, y, ax, ay, bx, by) - LETTER_STROKE / 2.0)
    return d


def fade(px):
    t = (px + 0.5) / SIZE
    if t <= FADE_START:
        return 1.0
    f = (t - FADE_START) / (1.0 - FADE_START)
    return max(FADE_MIN, 1.0 - f * f)


def pixel_alpha(px, py):
    total = 0.0
    for sy in range(SS):
        for sx in range(SS):
            x = px + (sx + 0.5) / SS
            y = py + (sy + 0.5) / SS
            total += max(0.0, min(1.0, 0.5 - mark_sdf(x, y)))
    return (total / (SS * SS)) * fade(px)


def write_png(path, rows):
    raw = b"".join(b"\x00" + bytes(v for px in row for v in px) for row in rows)

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def main():
    rows = [
        [(0, 0, 0, int(round(pixel_alpha(x, y) * 255))) for x in range(SIZE)]
        for y in range(SIZE)
    ]
    write_png(OUTPUT, rows)
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
