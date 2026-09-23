"""Versioned, validated USB archive for project, voices and generated WAV files."""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import tempfile
import zipfile
from pathlib import Path
from uuid import uuid4

from voice_registry import ProfileError, VoiceRegistry

FORMAT = "egago-usb-v1"
MAX_ARCHIVE = 256 * 1024 * 1024
MAX_PROJECT = 30 * 1024 * 1024
MAX_ENTRIES = 1000
VOICE_PATH = re.compile(r"voices/[0-9a-f]{32}\.json\Z")
AUDIO_PATH = re.compile(r"speech/[0-9a-f]{64}\.wav\Z")


class PackageError(ValueError):
    pass


def _json_bytes(data: object) -> bytes:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _project(data: object) -> dict:
    if not isinstance(data, dict) or not isinstance(data.get("characters"), list) or not isinstance(data.get("scriptLines"), list):
        raise PackageError("プロジェクトの形式が不正です")
    if len(data["characters"]) > 4 or len(data["scriptLines"]) > 1000:
        raise PackageError("キャラまたは台本の件数が上限を超えています")
    if not all(isinstance(item, dict) for item in data["characters"] + data["scriptLines"]):
        raise PackageError("プロジェクトの項目が不正です")
    if len(_json_bytes(data)) > MAX_PROJECT:
        raise PackageError("プロジェクトが大きすぎます")
    return data


def export_package(project: dict, voices: VoiceRegistry, speech_directory: Path) -> bytes:
    project = _project(project)
    entries: dict[str, bytes] = {"project.json": _json_bytes(project)}
    voice_ids = {item.get("voiceId") for item in project["characters"] if item.get("voiceId")}
    for voice_id in voice_ids:
        try:
            profile = voices.get(voice_id)
        except ProfileError as exc:
            raise PackageError(f"割り当てた声 {voice_id} が見つかりません") from exc
        entries[f"voices/{voice_id}.json"] = _json_bytes(profile)
    wav_paths = list(speech_directory.glob("*.wav")) + list((speech_directory.parent / "usb-packages").glob("*/speech/*.wav"))
    for path in wav_paths:
        if AUDIO_PATH.fullmatch(f"speech/{path.name}") and f"speech/{path.name}" not in entries:
            entries[f"speech/{path.name}"] = path.read_bytes()
    if len(entries) > MAX_ENTRIES or sum(len(content) for content in entries.values()) > MAX_ARCHIVE:
        raise PackageError("USBパッケージが上限を超えています。不要な音声キャッシュを整理してください")
    manifest = {"format": FORMAT, "version": 1, "entries": {
        name: {"size": len(content), "sha256": hashlib.sha256(content).hexdigest()}
        for name, content in entries.items()}}
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("manifest.json", _json_bytes(manifest))
        for name, content in entries.items():
            archive.writestr(name, content)
    return out.getvalue()


def import_package(data: bytes, voices: VoiceRegistry, speech_directory: Path) -> dict:
    if not 1 <= len(data) <= MAX_ARCHIVE:
        raise PackageError("USBパッケージが大きすぎます")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise PackageError("ZIPファイルを読み込めません") from exc
    with archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if len(names) != len(set(names)) or len(names) > MAX_ENTRIES + 1 or "manifest.json" not in names:
            raise PackageError("パッケージのファイル一覧が不正です")
        allowed = lambda name: name in ("manifest.json", "project.json") or VOICE_PATH.fullmatch(name) or AUDIO_PATH.fullmatch(name)
        if any(not allowed(info.filename) or info.is_dir() or info.flag_bits & 1 or
               (info.external_attr >> 16) & 0o170000 == 0o120000 for info in infos):
            raise PackageError("安全でないパスまたはファイル形式が含まれています")
        if sum(info.file_size for info in infos) > MAX_ARCHIVE or any(info.file_size > MAX_ARCHIVE for info in infos):
            raise PackageError("展開後の容量が上限を超えています")
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except (ValueError, KeyError, RuntimeError) as exc:
            raise PackageError("manifestを読み込めません") from exc
        if not isinstance(manifest, dict) or manifest.get("format") != FORMAT or manifest.get("version") != 1 or not isinstance(manifest.get("entries"), dict):
            raise PackageError("非対応のUSBパッケージです")
        expected = manifest["entries"]
        if set(expected) != set(names) - {"manifest.json"} or "project.json" not in expected:
            raise PackageError("manifestと内容が一致しません")
        extracted: dict[str, bytes] = {}
        for info in infos:
            if info.filename == "manifest.json":
                continue
            content = archive.read(info)
            meta = expected[info.filename]
            if not isinstance(meta, dict) or meta.get("size") != len(content) or meta.get("sha256") != hashlib.sha256(content).hexdigest():
                raise PackageError(f"{info.filename} の整合性チェックに失敗しました")
            extracted[info.filename] = content
    try:
        project = _project(json.loads(extracted["project.json"]))
        for name, content in extracted.items():
            if VOICE_PATH.fullmatch(name):
                raw = json.loads(content)
                validated = voices.validate(raw)
                if raw.get("id") != Path(name).stem or raw.get("content_hash") != voices.digest(validated):
                    raise PackageError(f"{name} の声IDまたは内容が不正です")
            elif AUDIO_PATH.fullmatch(name) and (content[:4] != b"RIFF" or content[8:12] != b"WAVE"):
                raise PackageError(f"{name} はWAVではありません")
    except (ValueError, ProfileError, KeyError, TypeError) as exc:
        raise PackageError(str(exc)) from exc
    for character in project["characters"]:
        voice_id = character.get("voiceId")
        if voice_id and f"voices/{voice_id}.json" not in extracted:
            raise PackageError(f"{voice_id} の声データが含まれていません")
    package_root = voices.directory.parent / "usb-packages"
    package_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".import-", dir=package_root) as temporary:
        stage = Path(temporary)
        for name, content in extracted.items():
            path = stage / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        destination = package_root / uuid4().hex
        os.replace(stage, destination)
    return project
