"""Extract 64 evenly-spaced WebP frames + center frame from character.mp4.

Also auto-detects the video's solid background color by sampling the four
corners of the first frame and writes public/frames/metadata.json.
"""
import json
import sys
from pathlib import Path

try:
    import cv2
except ImportError:
    print("ERROR: opencv-python is not installed. Run:")
    print("       pip install opencv-python")
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
VIDEO = ROOT / "public" / "character.mp4"
OUT_DIR = ROOT / "public" / "frames"
FRAME_COUNT = 64
QUALITY = 92

if not VIDEO.exists():
    print(f"ERROR: {VIDEO} not found")
    sys.exit(1)

OUT_DIR.mkdir(parents=True, exist_ok=True)

cap = cv2.VideoCapture(str(VIDEO))
if not cap.isOpened():
    print(f"ERROR: cv2 could not open {VIDEO}")
    sys.exit(1)

total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
duration = (total / fps) if fps > 0 else 0

print(f"Video: {total} frames | {fps:.2f}fps | {vw}x{vh} | {duration:.2f}s")

# Read all frames into memory
frames = []
while True:
    ok, frame = cap.read()
    if not ok:
        break
    frames.append(frame)
cap.release()

if not frames:
    print("ERROR: no frames decoded")
    sys.exit(1)

print(f"Decoded {len(frames)} frames")

# Center = last frame (neutral pose per spec)
center = frames[-1]
cv2.imwrite(
    str(OUT_DIR / "center.webp"),
    center,
    [int(cv2.IMWRITE_WEBP_QUALITY), QUALITY],
)

# Rotation portion = all frames before the last neutral pose
rotation = frames[:-1] if len(frames) > 1 else frames

# Sample 64 evenly-spaced frames across the rotation
if len(rotation) <= 1:
    indices = [0] * FRAME_COUNT
else:
    indices = [
        round(i * (len(rotation) - 1) / (FRAME_COUNT - 1))
        for i in range(FRAME_COUNT)
    ]

for i, idx in enumerate(indices):
    cv2.imwrite(
        str(OUT_DIR / f"frame_{i:02d}.webp"),
        rotation[idx],
        [int(cv2.IMWRITE_WEBP_QUALITY), QUALITY],
    )

# Detect background from the TOP STRIP of the first frame (well above the head).
# Corner sampling doesn't work: bottom corners often contain the character's
# dress/hair, not the bg.
h, w = frames[0].shape[:2]
strip = frames[0][0:60, :].reshape(-1, 3)                      # BGR pixels
avg_bgr = strip.mean(axis=0).astype(int)
avg_rgb = (int(avg_bgr[2]), int(avg_bgr[1]), int(avg_bgr[0]))
hex_color = "#{:02x}{:02x}{:02x}".format(*avg_rgb)

meta = {
    "totalFrames": len(frames),
    "fps": fps,
    "durationSec": duration,
    "videoWidth": vw,
    "videoHeight": vh,
    "framesExtracted": FRAME_COUNT,
    "sampleIndices": indices,
    "centerFrameIndex": len(frames) - 1,
    "backgroundHex": hex_color,
    "backgroundRGB": avg_rgb,
}
with open(OUT_DIR / "metadata.json", "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=2)

print(f"Wrote {FRAME_COUNT} frames + center.webp + metadata.json to {OUT_DIR}")
print(f"Detected background color: {hex_color}")
