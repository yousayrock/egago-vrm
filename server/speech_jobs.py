"""One-at-a-time local speech queue with cancellation and disk cache."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
from threading import Event
from uuid import uuid4

from moss_provider import GenerationCancelled, MossProvider
from voice_registry import VoiceRegistry


class SpeechJobService:
    def __init__(self, directory: Path, voices: VoiceRegistry, provider: MossProvider):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)
        self.voices = voices
        self.provider = provider
        self.jobs: dict[str, dict] = {}
        self.cancel_events: dict[str, Event] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.worker: asyncio.Task | None = None

    def submit(self, text: str, voice_id: str) -> dict:
        text = text.strip()
        if not text or len(text) > 1000:
            raise ValueError("セリフは1〜1000文字にしてください")
        profile = self.voices.get(voice_id)
        cache_key = hashlib.sha256(json.dumps({"engine": "moss-nano-onnx-v1", "voice": profile["content_hash"],
                                                "text": text, "settings": "fixed-250"},
                                               ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        job_id = uuid4().hex
        cached = self.cache_path(cache_key) is not None
        job = {"id": job_id, "status": "ready" if cached else "queued", "error": None,
               "voiceId": voice_id, "cacheKey": cache_key, "_text": text}
        self.jobs[job_id] = job
        self.cancel_events[job_id] = Event()
        if not cached:
            self.queue.put_nowait(job_id)
            if self.worker is None or self.worker.done():
                self.worker = asyncio.create_task(self._run())
        return self.get(job_id)

    def get(self, job_id: str) -> dict | None:
        job = self.jobs.get(job_id)
        return {key: value for key, value in job.items() if not key.startswith("_")} if job else None

    def cancel(self, job_id: str) -> dict | None:
        job = self.jobs.get(job_id)
        if job is None:
            return None
        if job["status"] in ("queued", "loading", "generating"):
            self.cancel_events[job_id].set()
            job["status"] = "cancelled"
        return self.get(job_id)

    def audio_path(self, job_id: str) -> Path | None:
        job = self.jobs.get(job_id)
        if job is None or job["status"] != "ready":
            return None
        return self.cache_path(job["cacheKey"])

    def cache_path(self, cache_key: str) -> Path | None:
        paths = [self.directory / f"{cache_key}.wav"] + sorted(
            (self.directory.parent / "usb-packages").glob(f"*/speech/{cache_key}.wav"))
        return next((path for path in paths if path.is_file()), None)

    async def _run(self) -> None:
        while not self.queue.empty():
            job_id = await self.queue.get()
            job = self.jobs[job_id]
            cancel = self.cancel_events[job_id]
            try:
                if cancel.is_set():
                    continue
                job["status"] = "loading" if self.provider.runtime is None else "generating"
                profile = self.voices.get(job["voiceId"])
                text = job.pop("_text")
                def loaded():
                    if not cancel.is_set():
                        job["status"] = "generating"
                wav = await asyncio.to_thread(self.provider.synthesize, text, profile, cancel, loaded)
                if cancel.is_set():
                    continue
                path = self.directory / f"{job['cacheKey']}.wav"
                temporary = path.with_suffix(f".{job_id}.tmp")
                temporary.write_bytes(wav)
                os.replace(temporary, path)
                job["status"] = "ready"
            except GenerationCancelled:
                job["status"] = "cancelled"
            except Exception as exc:
                job["status"] = "failed"
                job["error"] = str(exc)
            finally:
                self.queue.task_done()
