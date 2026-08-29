"""Export the named 2D character frames from Eriru's editable PSD source."""

from __future__ import annotations

import sys
from pathlib import Path

from psd_tools import PSDImage


EXPRESSIONS: dict[str, tuple[int, int, int, int]] = {
    # eye, mouth, eyebrow, nose indexes in the PSD's character group.
    "neutral": (0, 0, 0, 0),
    "happy": (6, 5, 0, 0),
    "angry": (0, 1, 3, 0),
    "sad": (2, 3, 2, 0),
    "relaxed": (4, 0, 0, 0),
    "surprised": (0, 4, 0, 1),
    "blink": (4, 0, 0, 0),
}


def choose(group, selected: int) -> None:
    for index, layer in enumerate(group):
        layer.visible = index == selected


def render(source: Path, target: Path, name: str, choices: tuple[int, int, int, int]) -> None:
    psd = PSDImage.open(source)
    psd[0].visible = False  # bg
    character = psd[1]
    eye, mouth, eyebrow, nose = choices
    for group, selected in zip((character[9], character[11], character[12], character[10]), (eye, mouth, eyebrow, nose)):
        choose(group, selected)

    if name == "banzai":
        character[4].visible = False  # left arm default
        character[13].visible = False  # right arm default
        character[14].visible = True
        for layer in character[14]:
            layer.visible = True

    psd.composite().convert("RGBA").save(target / f"eriru-{name}.png")


def main() -> None:
    source = Path(sys.argv[1])
    target = Path(sys.argv[2])
    target.mkdir(parents=True, exist_ok=True)
    for name, choices in EXPRESSIONS.items():
        render(source, target, name, choices)
    render(source, target, "banzai", EXPRESSIONS["happy"])


if __name__ == "__main__":
    main()
