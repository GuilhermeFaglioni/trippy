#!/usr/bin/env python3
"""Generate an original, deterministic travel-photo fixture using Python stdlib."""

from __future__ import annotations

import math
import random
import struct
import zlib
from pathlib import Path

WIDTH = 720
HEIGHT = 1280
random.seed(19)
pixels = bytearray(WIDTH * HEIGHT * 3)


def blend(top: tuple[int, int, int], bottom: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(round(a * (1 - amount) + b * amount) for a, b in zip(top, bottom))


def put(x: int, y: int, color: tuple[int, int, int]) -> None:
    if 0 <= x < WIDTH and 0 <= y < HEIGHT:
        offset = (y * WIDTH + x) * 3
        pixels[offset : offset + 3] = bytes(color)


def polygon(points: list[tuple[int, int]], color: tuple[int, int, int]) -> None:
    min_y = max(0, min(y for _, y in points))
    max_y = min(HEIGHT - 1, max(y for _, y in points))
    for y in range(min_y, max_y + 1):
        intersections: list[float] = []
        for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
            if (y1 <= y < y2) or (y2 <= y < y1):
                intersections.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        intersections.sort()
        for left, right in zip(intersections[::2], intersections[1::2]):
            for x in range(max(0, math.floor(left)), min(WIDTH, math.ceil(right))):
                put(x, y, color)


def rectangle(left: int, top: int, right: int, bottom: int, color: tuple[int, int, int]) -> None:
    for y in range(max(0, top), min(HEIGHT, bottom)):
        start = (y * WIDTH + max(0, left)) * 3
        end = (y * WIDTH + min(WIDTH, right)) * 3
        pixels[start:end] = bytes(color) * max(0, min(WIDTH, right) - max(0, left))


def chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)


for y in range(HEIGHT):
    amount = y / HEIGHT
    color = blend((112, 157, 177), (217, 194, 161), min(1, amount * 1.8))
    start = y * WIDTH * 3
    pixels[start : start + WIDTH * 3] = bytes(color) * WIDTH

# Low hills and the far edge of the courtyard.
polygon([(0, 500), (80, 445), (165, 476), (270, 420), (385, 475), (520, 430), (720, 482), (720, 670), (0, 670)], (91, 111, 103))
polygon([(0, 530), (150, 490), (310, 520), (470, 475), (720, 520), (720, 790), (0, 790)], (117, 129, 112))

# Main hall walls, roof and layered eaves.
polygon([(86, 492), (634, 492), (634, 884), (86, 884)], (170, 79, 52))
polygon([(54, 508), (154, 350), (568, 350), (668, 508)], (54, 47, 42))
polygon([(26, 504), (148, 338), (573, 338), (695, 504), (654, 514), (557, 390), (160, 390), (66, 514)], (130, 63, 42))
polygon([(16, 504), (66, 493), (152, 370), (570, 370), (654, 493), (704, 504), (693, 524), (637, 514), (557, 410), (164, 410), (83, 514), (27, 524)], (187, 126, 67))
polygon([(79, 518), (641, 518), (641, 556), (79, 556)], (74, 54, 43))

# Door bays and sunlit columns.
for x in (120, 250, 380, 510):
    rectangle(x, 566, x + 68, 860, (72, 49, 41))
    rectangle(x + 8, 576, x + 60, 847, (101, 57, 42))
    rectangle(x + 31, 580, x + 37, 848, (162, 117, 73))
    rectangle(x - 10, 550, x + 78, 568, (206, 158, 94))
    rectangle(x - 10, 858, x + 78, 878, (69, 49, 42))

# Courtyard stone floor and converging paving seams.
polygon([(0, 810), (720, 810), (720, 1280), (0, 1280)], (133, 126, 108))
polygon([(180, 810), (540, 810), (720, 1280), (0, 1280)], (156, 145, 122))
for y in range(860, HEIGHT, 54):
    spread = int((y - 790) * 0.44)
    polygon([(max(0, 360 - spread), y), (min(WIDTH, 360 + spread), y), (min(WIDTH, 360 + spread), y + 3), (max(0, 360 - spread), y + 3)], (117, 112, 100))
for x in range(70, WIDTH, 110):
    polygon([(360 + (x - 360) * 0.25, 810), (360 + (x - 360) * 0.25 + 2, 810), (x + 2, HEIGHT), (x, HEIGHT)], (119, 113, 100))

# Add restrained sensor-like grain so the generated raster reads as a photo fixture.
for y in range(HEIGHT):
    for x in range(WIDTH):
        if random.random() < 0.42:
            offset = (y * WIDTH + x) * 3
            grain = random.choice((-2, -1, 1, 2))
            pixels[offset : offset + 3] = bytes(max(0, min(255, channel + grain)) for channel in pixels[offset : offset + 3])

raw = b''.join(b'\0' + pixels[y * WIDTH * 3 : (y + 1) * WIDTH * 3] for y in range(HEIGHT))
png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', WIDTH, HEIGHT, 8, 2, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(raw, level=9))
png += chunk(b'IEND', b'')

target = Path(__file__).with_name('beijing-courtyard.png')
target.write_bytes(png)
print(f'generated {target} ({WIDTH}x{HEIGHT}, {len(png)} bytes)')
