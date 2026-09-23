"""EGAGO VRM - FastAPI 層.

責務は 3 つ。

1. VOICEVOX Adapter の前段 (/api/health, /api/speakers, /api/synthesize)
   合成結果は「WAV(base64)」と「AudioQuery」を 1 レスポンスにまとめて返す。
   AudioQuery 側はフロントのリップシンクがモーラのタイムラインを組むのに使う。
2. VRM モデルの一覧と追加 (/api/models)
3. Editor <-> Stage の中継 (/api/bus)
   OBS のブラウザソースは別プロセスの CEF なので BroadcastChannel が使えない。
   サーバを噛ませることで「Chrome の Editor」から「OBS の Stage」へ確実に届く。
"""

from __future__ import annotations

import asyncio
import base64
import pathlib
import re
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, WebSocket, WebSocketDisconnect, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import Response
from pydantic import BaseModel, Field

import voicevox
from moss_provider import MossProvider
from speech_jobs import SpeechJobService
from voice_registry import ProfileError, VoiceRegistry
from usb_package import PackageError, export_package, import_package

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "public" / "models"
VOICES = VoiceRegistry(ROOT / "server" / "data" / "voices")
MOSS = MossProvider()
JOBS = SpeechJobService(ROOT / "server" / "data" / "speech", VOICES, MOSS)

app = FastAPI(title="EGAGO VRM API", version="0.1.0")

# 通常は Vite の proxy 経由なので同一オリジンだが、
# Stage を別ポートで開く運用もあり得るのでローカルは許可しておく。
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# VOICEVOX
# --------------------------------------------------------------------------


class SynthesizeRequest(BaseModel):
    text: str
    speaker: int
    # docs/PRODUCT.md の「話速/音高/抑揚」。VOICEVOX の AudioQuery に上書きする。
    speedScale: float = Field(default=1.0, ge=0.5, le=2.0)
    pitchScale: float = Field(default=0.0, ge=-0.15, le=0.15)
    intonationScale: float = Field(default=1.0, ge=0.0, le=2.0)
    volumeScale: float = Field(default=1.0, ge=0.0, le=2.0)
    prePhonemeLength: float = Field(default=0.1, ge=0.0, le=1.5)
    postPhonemeLength: float = Field(default=0.1, ge=0.0, le=1.5)


class SynthesizeResponse(BaseModel):
    audio: str  # base64 エンコードした WAV
    query: dict[str, Any]  # AudioQuery そのもの(リップシンク用)


@app.get("/api/health")
async def health() -> dict[str, Any]:
    """VOICEVOX の疎通状態。UI が定期的に確認して表示する。"""
    v = await voicevox.version()
    return {"ok": v is not None, "voicevoxVersion": v, "engineUrl": voicevox.ENGINE_URL}


@app.get("/api/speakers")
async def speakers() -> list[dict[str, Any]]:
    try:
        return await voicevox.speakers()
    except voicevox.EngineUnavailable as e:
        raise HTTPException(status_code=503, detail=f"VOICEVOX に接続できません: {e}") from e


@app.post("/api/synthesize", response_model=SynthesizeResponse)
async def synthesize(req: SynthesizeRequest) -> SynthesizeResponse:
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text が空です")

    try:
        query = await voicevox.audio_query(text, req.speaker)

        query["speedScale"] = req.speedScale
        query["pitchScale"] = req.pitchScale
        query["intonationScale"] = req.intonationScale
        query["volumeScale"] = req.volumeScale
        query["prePhonemeLength"] = req.prePhonemeLength
        query["postPhonemeLength"] = req.postPhonemeLength

        wav = await voicevox.synthesis(query, req.speaker)
    except voicevox.EngineUnavailable as e:
        raise HTTPException(status_code=503, detail=f"VOICEVOX に接続できません: {e}") from e

    return SynthesizeResponse(audio=base64.b64encode(wav).decode("ascii"), query=query)


# --------------------------------------------------------------------------
# Local MOSS profiles and generation. These routes do not depend on VOICEVOX.
# --------------------------------------------------------------------------


class ImportVoiceRequest(BaseModel):
    profile: dict[str, Any]


class SpeechJobRequest(BaseModel):
    text: str
    voiceId: str


@app.get("/api/speech/status")
async def speech_status() -> dict[str, Any]:
    return MOSS.status()


@app.get("/api/voices")
async def list_voices() -> list[dict]:
    return VOICES.list()


@app.post("/api/voices/import")
async def import_voice(req: ImportVoiceRequest) -> dict:
    try:
        return VOICES.save(req.profile)
    except ProfileError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/voices/register")
async def register_voice(file: UploadFile = File(...), name: str = Form(...)) -> dict:
    if not (file.filename or "").lower().endswith(".wav"):
        raise HTTPException(status_code=400, detail="WAVファイルを選んでください")
    content = await file.read(10 * 1024 * 1024 + 1)
    try:
        profile = await asyncio.to_thread(MOSS.register, content, name)
        return VOICES.save(profile)
    except (ValueError, ProfileError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/voices/{voice_id}/export")
async def export_voice(voice_id: str) -> dict:
    try:
        return VOICES.get(voice_id)
    except ProfileError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/speech/jobs")
async def submit_speech_job(req: SpeechJobRequest) -> dict:
    try:
        return JOBS.submit(req.text, req.voiceId)
    except (ValueError, ProfileError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/speech/jobs/{job_id}")
async def speech_job(job_id: str) -> dict:
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="生成ジョブが見つかりません")
    return job


@app.post("/api/speech/jobs/{job_id}/cancel")
async def cancel_speech_job(job_id: str) -> dict:
    job = JOBS.cancel(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="生成ジョブが見つかりません")
    return job


@app.get("/api/speech/jobs/{job_id}/audio")
async def speech_audio(job_id: str) -> FileResponse:
    path = JOBS.audio_path(job_id)
    if path is None:
        raise HTTPException(status_code=404, detail="音声がまだ準備できていません")
    return FileResponse(path, media_type="audio/wav", filename="speech.wav")


class UsbExportRequest(BaseModel):
    project: dict[str, Any]


@app.post("/api/usb/export")
async def usb_export(req: UsbExportRequest) -> Response:
    try:
        content = await asyncio.to_thread(export_package, req.project, VOICES, JOBS.directory)
    except (PackageError, ProfileError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(content, media_type="application/zip", headers={
        "Content-Disposition": 'attachment; filename="egago-project.zip"'})


@app.post("/api/usb/import")
async def usb_import(file: UploadFile = File(...)) -> dict:
    content = await file.read(256 * 1024 * 1024 + 1)
    try:
        project = await asyncio.to_thread(import_package, content, VOICES, JOBS.directory)
    except (PackageError, ProfileError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"project": project, "voices": VOICES.list()}


# --------------------------------------------------------------------------
# VRM モデル
# --------------------------------------------------------------------------

_SAFE_NAME = re.compile(r"[^0-9A-Za-z._-]")


@app.get("/api/models")
async def list_models() -> list[dict[str, str]]:
    """public/models/ に置かれた .vrm を列挙する。

    Stage(OBS) は Editor とは別ブラウザなので blob URL を共有できない。
    双方から同じ URL で読める場所に実体を置くことで初めて同期できる。
    """
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    return [
        {"name": p.stem, "url": f"/models/{p.name}"}
        for p in sorted(MODELS_DIR.glob("*.vrm"))
    ]


@app.post("/api/models")
async def add_model(file: UploadFile) -> dict[str, str]:
    if not (file.filename or "").lower().endswith(".vrm"):
        raise HTTPException(status_code=400, detail=".vrm ファイルを指定してください")

    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    # 日本語ファイル名は URL で扱いづらいので ASCII に落とす。
    # 全部落ちてしまう名前(例: 「なな.vrm」)には安定した代替名を与える。
    stem = _SAFE_NAME.sub("_", pathlib.Path(file.filename or "model.vrm").stem).strip("_")
    if not stem:
        stem = "model"

    dest = MODELS_DIR / f"{stem}.vrm"
    i = 2
    while dest.exists():
        dest = MODELS_DIR / f"{stem}_{i}.vrm"
        i += 1

    dest.write_bytes(await file.read())
    return {"name": dest.stem, "url": f"/models/{dest.name}"}


# --------------------------------------------------------------------------
# Editor <-> Stage 中継
# --------------------------------------------------------------------------

_clients: set[WebSocket] = set()


@app.websocket("/api/bus")
async def bus(ws: WebSocket) -> None:
    await ws.accept()
    _clients.add(ws)
    try:
        while True:
            raw = await ws.receive_text()
            # 中身は解釈せず、送信元以外の全員へそのまま流す
            for peer in list(_clients):
                if peer is ws:
                    continue
                try:
                    await peer.send_text(raw)
                except (WebSocketDisconnect, RuntimeError):
                    _clients.discard(peer)
    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(ws)


# A built Vite UI can be served by the same local process on Linux tablets.
DIST_DIR = ROOT / "dist"


@app.get("/{path:path}")
async def built_ui(path: str) -> FileResponse:
    if not DIST_DIR.is_dir() or path.startswith("api/"):
        raise HTTPException(status_code=404)
    target = (DIST_DIR / path).resolve()
    if not target.is_relative_to(DIST_DIR.resolve()) or not target.is_file():
        target = DIST_DIR / "index.html"
    return FileResponse(target)
