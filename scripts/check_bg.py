"""Sample the actual background color from extracted WebP frames.

The initial detection used mp4 corner pixels, but WebP encoding shifts colors
slightly. Sample the extracted WebPs directly and pick the dominant bg color.
"""
import cv2
import numpy as np
from pathlib import Path
from collections import Counter

FRAMES = Path("public/frames")
frame = cv2.imread(str(FRAMES / "frame_00.webp"))
h, w = frame.shape[:2]

# Sample a strip across the top of the frame (well above the head)
strip = frame[0:60, :].reshape(-1, 3)   # BGR pixels
avg_bgr = strip.mean(axis=0).astype(int)
r, g, b = int(avg_bgr[2]), int(avg_bgr[1]), int(avg_bgr[0])
hex_top = f"#{r:02x}{g:02x}{b:02x}"
print(f"Top strip (0-60px) average: {hex_top}  RGB({r},{g},{b})")

# Also check each individual corner (5px inset)
for label, y, x in [("TL", 5, 5), ("TR", 5, w - 5), ("BL", h - 5, 5), ("BR", h - 5, w - 5)]:
    b_, g_, r_ = frame[y, x]
    print(f"  {label} pixel: #{r_:02x}{g_:02x}{b_:02x}  RGB({r_},{g_},{b_})")

# Also dominant color of full frame edges (top+bottom rows + left+right cols)
edges = np.concatenate([
    frame[0:20, :].reshape(-1, 3),
    frame[h - 20 :, :].reshape(-1, 3),
    frame[:, 0:20].reshape(-1, 3),
    frame[:, w - 20 :].reshape(-1, 3),
], axis=0)
# Quantize to nearest 8 to find the mode
quantized = (edges // 8) * 8
tuples = [tuple(row) for row in quantized]
mode_bgr, _ = Counter(tuples).most_common(1)[0]
r, g, b = int(mode_bgr[2]), int(mode_bgr[1]), int(mode_bgr[0])
hex_mode = f"#{r:02x}{g:02x}{b:02x}"
print(f"Edge mode (quantized): {hex_mode}  RGB({r},{g},{b})")
