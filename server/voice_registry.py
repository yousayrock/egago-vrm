"""Portable MOSS voice profiles. Only validated JSON is kept on disk."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

FORMAT = "egago-moss-prompt-v1"
MODEL = "MOSS-TTS-Nano-100M-ONNX"
CODEC = "MOSS-Audio-Tokenizer-Nano-ONNX"
MAX_BYTES = 64 * 1024
MAX_FRAMES = 2048


class ProfileError(ValueError):
    pass


class VoiceRegistry:
    def __init__(self, directory: Path):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def digest(profile: dict) -> str:
        return hashlib.sha256(json.dumps(
            {key: profile[key] for key in ("format", "model", "codec", "prompt_audio_codes")},
            separators=(",", ":"), sort_keys=True).encode()).hexdigest()

    @staticmethod
    def validate(raw: object) -> dict:
        if not isinstance(raw, dict):
            raise ProfileError("声データは JSON オブジェクトで指定してください")
        if raw.get("format") != FORMAT or raw.get("model") != MODEL or raw.get("codec") != CODEC:
            raise ProfileError("この声データは現在の MOSS モデルに対応していません")
        codes = raw.get("prompt_audio_codes")
        if not isinstance(codes, list) or not 1 <= len(codes) <= MAX_FRAMES:
            raise ProfileError("声データのフレーム数が不正です")
        if any(not isinstance(frame, list) or len(frame) != 16 or
               any(type(code) is not int or not 0 <= code <= 1023 for code in frame)
               for frame in codes):
            raise ProfileError("声データのコード形式が不正です")
        name = raw.get("name") or "取り込んだ声"
        if not isinstance(name, str) or not name.strip() or len(name) > 80:
            raise ProfileError("声の名前は1〜80文字にしてください")
        result = {"format": FORMAT, "model": MODEL, "codec": CODEC,
                  "name": name.strip(), "prompt_audio_codes": codes}
        for key in ("model_revision", "codec_revision"):
            value = raw.get(key)
            if value is not None:
                if not isinstance(value, str) or len(value) > 100:
                    raise ProfileError(f"{key} が不正です")
                result[key] = value
        return result

    def save(self, raw: object) -> dict:
        encoded = json.dumps(raw, ensure_ascii=False).encode("utf-8")
        if len(encoded) > MAX_BYTES:
            raise ProfileError("声データが大きすぎます（上限64KB）")
        profile = self.validate(raw)
        profile["id"] = uuid4().hex
        profile["content_hash"] = self.digest(profile)
        path = self.directory / f"{profile['id']}.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(profile, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, path)
        return self.summary(profile)

    @staticmethod
    def summary(profile: dict) -> dict:
        return {key: profile[key] for key in ("id", "name", "format", "model", "codec", "content_hash")}

    def get(self, voice_id: str) -> dict:
        if len(voice_id) != 32 or any(c not in "0123456789abcdef" for c in voice_id):
            raise ProfileError("声IDが不正です")
        paths = [self.directory / f"{voice_id}.json"] + sorted(
            (self.directory.parent / "usb-packages").glob(f"*/voices/{voice_id}.json"))
        try:
            path = next(path for path in paths if path.is_file())
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ProfileError("声データが見つかりません") from exc
        except StopIteration as exc:
            raise ProfileError("声データが見つかりません") from exc
        validated = self.validate(raw)
        if raw.get("content_hash") != self.digest(validated):
            raise ProfileError("声データの整合性が一致しません")
        validated["id"] = voice_id
        validated["content_hash"] = raw["content_hash"]
        return validated

    def list(self) -> list[dict]:
        result = []
        seen = set()
        paths = list(self.directory.glob("*.json")) + list((self.directory.parent / "usb-packages").glob("*/voices/*.json"))
        for path in sorted(paths):
            try:
                if path.stem not in seen:
                    result.append(self.summary(self.get(path.stem)))
                    seen.add(path.stem)
            except (ProfileError, KeyError):
                continue
        return result
