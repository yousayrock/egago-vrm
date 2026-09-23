"""VOICEVOX Adapter.

docs/ARCHITECTURE.md の `FastAPI -> VOICEVOX Adapter` に対応する層。
VOICEVOX Engine (既定 http://127.0.0.1:50021) を叩く処理をここに閉じ込め、
将来 TTS を差し替える場合はこのモジュールだけを置き換えれば済むようにする。
"""

from __future__ import annotations

import os
from typing import Any

import httpx

ENGINE_URL = os.environ.get("VOICEVOX_URL", "http://127.0.0.1:50021")

# 合成は数秒かかることがあるので read だけ長めに取る
_TIMEOUT = httpx.Timeout(connect=3.0, read=60.0, write=10.0, pool=3.0)


class EngineUnavailable(RuntimeError):
    """VOICEVOX Engine に繋がらない。アプリが起動していない場合がほとんど。"""


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=ENGINE_URL, timeout=_TIMEOUT)


async def version() -> str | None:
    """Engine のバージョンを返す。繋がらなければ None。疎通確認に使う。"""
    try:
        async with _client() as c:
            r = await c.get("/version")
            r.raise_for_status()
            # /version は文字列を JSON で返す ("0.14.7" のように)
            return r.json()
    except (httpx.HTTPError, ValueError):
        return None


async def speakers() -> list[dict[str, Any]]:
    """話者とスタイルの一覧を、UI がそのまま使える形に整形して返す。"""
    try:
        async with _client() as c:
            r = await c.get("/speakers")
            r.raise_for_status()
            raw = r.json()
    except httpx.HTTPError as e:
        raise EngineUnavailable(str(e)) from e

    return [
        {
            "name": s["name"],
            "uuid": s["speaker_uuid"],
            "styles": [
                {
                    "id": st["id"],
                    "name": st["name"],
                    # style の type は Engine のバージョンによっては無いので既定値を入れる
                    "type": st.get("type", "talk"),
                }
                for st in s["styles"]
            ],
        }
        for s in raw
    ]


async def audio_query(text: str, speaker: int) -> dict[str, Any]:
    """テキストを解析して AudioQuery を得る。

    戻り値の accent_phrases[].moras[] に母音・子音とその長さ(秒)が入っており、
    これがリップシンクのタイムラインの元になる。
    """
    try:
        async with _client() as c:
            r = await c.post("/audio_query", params={"text": text, "speaker": speaker})
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError as e:
        raise EngineUnavailable(str(e)) from e


async def synthesis(query: dict[str, Any], speaker: int) -> bytes:
    """AudioQuery から WAV を合成する。"""
    try:
        async with _client() as c:
            r = await c.post("/synthesis", params={"speaker": speaker}, json=query)
            r.raise_for_status()
            return r.content
    except httpx.HTTPError as e:
        raise EngineUnavailable(str(e)) from e
