#!/usr/bin/env python3
"""Build the 24 reviewed animation sequences from the canonical anchor and ImageGen key poses."""

from __future__ import annotations

import json
import math
import shutil
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "animations_manifest.json").read_text(encoding="utf-8"))
ANCHOR_PATH = ROOT / "assets/generated/character-anchor.png"
SOURCE_DIR = ROOT / "assets/generated/actions-alpha"
OUTPUT_DIR = ROOT / "public/sprites"
REVIEW_DIR = ROOT / "assets/generated/review"
CANVAS = 512
BASELINE = 451
TARGET_HEIGHT = 400
RESAMPLE = Image.Resampling.LANCZOS

GRID = {"type_fast": (6, 2)}
SHEET_ACTIONS = {
    "idle_breath", "idle_blink", "idle_look_around", "wave_hello",
    "user_typing", "type_fast", "listen", "thinking",
}


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 24 else 0).getbbox()
    if not bbox:
        raise ValueError("image contains no visible pixels")
    return bbox


def largest_component_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    """Find the connected character silhouette while ignoring detached status icons."""
    mask = image.getchannel("A").point(lambda value: 1 if value > 32 else 0)
    bbox = mask.getbbox()
    if not bbox:
        raise ValueError("image contains no visible pixels")
    left, top, right, bottom = bbox
    width, height = mask.size
    pixels = mask.load()
    visited = bytearray(width * height)
    best_area = 0
    best = bbox
    for y in range(top, bottom):
        row = y * width
        for x in range(left, right):
            index = row + x
            if not pixels[x, y] or visited[index]:
                continue
            queue = deque([(x, y)])
            visited[index] = 1
            area = 0
            min_x = max_x = x
            min_y = max_y = y
            while queue:
                px, py = queue.popleft()
                area += 1
                min_x, max_x = min(min_x, px), max(max_x, px)
                min_y, max_y = min(min_y, py), max(max_y, py)
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                    if nx < left or nx >= right or ny < top or ny >= bottom:
                        continue
                    next_index = ny * width + nx
                    if not visited[next_index] and pixels[nx, ny]:
                        visited[next_index] = 1
                        queue.append((nx, ny))
            if area > best_area:
                best_area = area
                best = (min_x, min_y, max_x + 1, max_y + 1)
    return best


def normalize(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    main = largest_component_bbox(image)
    main_height = main[3] - main[1]
    main_width = main[2] - main[0]
    scale = min(TARGET_HEIGHT / main_height, 470 / main_width)
    resized = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), RESAMPLE)
    center_x = ((main[0] + main[2]) / 2) * scale
    foot_y = main[3] * scale
    x = round(CANVAS / 2 - center_x)
    y = round(BASELINE - foot_y)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(resized, (x, y))
    return canvas


def extract_cells(image: Image.Image, columns: int, rows: int) -> list[Image.Image]:
    cells: list[Image.Image] = []
    for row in range(rows):
        for column in range(columns):
            left = round(column * image.width / columns) + 3
            right = round((column + 1) * image.width / columns) - 3
            top = round(row * image.height / rows) + 3
            bottom = round((row + 1) * image.height / rows) - 3
            cells.append(image.crop((left, top, right, bottom)))
    return cells


def load_keyframes(action_id: str, anchor: Image.Image) -> list[Image.Image]:
    if action_id in SHEET_ACTIONS:
        source = Image.open(SOURCE_DIR / f"{action_id}-sheet.png").convert("RGBA")
        columns, rows = GRID.get(action_id, (3, 1))
        generated = [normalize(cell) for cell in extract_cells(source, columns, rows)]
    else:
        source = Image.open(SOURCE_DIR / f"{action_id}-pose.png").convert("RGBA")
        generated = [normalize(source)]
    # Every action begins and recovers on the exact same canonical anchor.
    return [anchor.copy(), *generated, anchor.copy()]


def ease(value: float) -> float:
    return value * value * (3 - 2 * value)


def frame_at(keys: list[Image.Image], progress: float) -> Image.Image:
    position = min(len(keys) - 1, progress * (len(keys) - 1))
    first = min(len(keys) - 2, int(position))
    amount = ease(position - first)
    if amount < 0.04:
        return keys[first].copy()
    if amount > 0.96:
        return keys[first + 1].copy()
    return Image.blend(keys[first], keys[first + 1], amount)


def subtle_motion(frame: Image.Image, action_id: str, index: int, count: int) -> Image.Image:
    phase = (index / max(1, count)) * math.tau
    dx = 0
    dy = 0
    if action_id in {"idle_breath", "loading", "stand_sleep", "low_battery"}:
        dy = round(math.sin(phase) * 2)
    elif action_id in {"follow_cursor", "chase_cursor", "user_typing", "type_fast"}:
        dx = round(math.sin(phase) * 2)
    if not dx and not dy:
        return frame
    moved = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    moved.alpha_composite(frame, (dx, dy))
    return moved


def build_action(definition: dict, anchor: Image.Image) -> list[Image.Image]:
    action_id = definition["id"]
    count = int(definition["frames"])
    if action_id == "idle_breath":
        # Identity-critical default idle uses only the canonical anchor.
        frames = []
        for index in range(count):
            phase = math.sin(index / count * math.tau)
            scale_y = 1 + phase * 0.006
            height = round(CANVAS * scale_y)
            transformed = anchor.resize((CANVAS, height), RESAMPLE)
            canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
            canvas.alpha_composite(transformed, (0, BASELINE - round(BASELINE * scale_y)))
            frames.append(canvas)
        return frames
    keys = load_keyframes(action_id, anchor)
    frames = []
    for index in range(count):
        # Both loop and once sequences land on the canonical recovery frame. For loops
        # this makes the final-to-first boundary pixel-identical instead of merely close.
        progress = index / max(1, count - 1)
        frames.append(subtle_motion(frame_at(keys, progress), action_id, index, count))
    return frames


def save_review(actions: dict[str, list[Image.Image]]) -> None:
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    thumb = 160
    sheet = Image.new("RGBA", (thumb * 6, thumb * 12), (245, 240, 233, 255))
    draw = ImageDraw.Draw(sheet)
    for action_index, (action_id, frames) in enumerate(actions.items()):
        group_x = (action_index % 2) * thumb * 3
        group_y = (action_index // 2) * thumb
        picks = [frames[0], frames[len(frames) // 2], frames[-1]]
        for offset, frame in enumerate(picks):
            preview = frame.resize((thumb, thumb), RESAMPLE)
            sheet.alpha_composite(preview, (group_x + offset * thumb, group_y))
        draw.text((group_x + 4, group_y + 4), action_id, fill=(63, 49, 45, 255))
    sheet.convert("RGB").save(REVIEW_DIR / "24-actions-contact-sheet.jpg", quality=92)


def main() -> None:
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True)
    anchor = normalize(Image.open(ANCHOR_PATH).convert("RGBA"))
    actions: dict[str, list[Image.Image]] = {}
    for definition in MANIFEST:
        action_id = definition["id"]
        frames = build_action(definition, anchor)
        target = OUTPUT_DIR / action_id
        target.mkdir()
        for index, frame in enumerate(frames):
            frame.save(target / f"{action_id}_{index:03d}.png", optimize=True)
        actions[action_id] = frames
        print(f"{action_id}: {len(frames)} frames")
    save_review(actions)
    print(f"Built {sum(len(frames) for frames in actions.values())} formal RGBA frames")


if __name__ == "__main__":
    main()
