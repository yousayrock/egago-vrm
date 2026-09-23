"""CPU ONNX adapter. Runtime source and model weights stay outside this repository.

Set EGAGO_MOSS_RUNTIME to the upstream ort_cpu_runtime.py file and
EGAGO_MOSS_MODELS to the directory containing both official ONNX model folders.
Install the optional requirements-moss.txt into the API Python environment.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
from pathlib import Path
from threading import Event, Lock

from voice_registry import CODEC, FORMAT, MODEL


class GenerationCancelled(Exception):
    pass


class MossProvider:
    def __init__(self):
        self.runtime = None
        self.tokenizer = None
        self.lock = Lock()

    @staticmethod
    def paths() -> tuple[Path, Path]:
        runtime = Path(os.environ.get("EGAGO_MOSS_RUNTIME", ""))
        models = Path(os.environ.get("EGAGO_MOSS_MODELS", ""))
        if not runtime.is_file() or not (models / MODEL / "tokenizer.model").is_file() or not (models / CODEC / "codec_browser_onnx_meta.json").is_file():
            raise RuntimeError("MOSS のローカルランタイム/モデルが未設定です。EGAGO_MOSS_RUNTIME と EGAGO_MOSS_MODELS を確認してください")
        return runtime, models

    def status(self) -> dict:
        try:
            self.paths()
            return {"provider": "moss", "ready": True, "loaded": self.runtime is not None, "error": None}
        except RuntimeError as exc:
            return {"provider": "moss", "ready": False, "loaded": False, "error": str(exc)}

    def _module(self):
        runtime_path, _ = self.paths()
        spec = importlib.util.spec_from_file_location("egago_external_ort_cpu_runtime", runtime_path)
        if spec is None or spec.loader is None:
            raise RuntimeError("MOSS ランタイムを読み込めません")
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module

    def _load(self):
        if self.runtime is not None:
            return
        _, models = self.paths()
        try:
            import sentencepiece as spm
        except ImportError as exc:
            raise RuntimeError("MOSS 用 Python 依存がありません。server/requirements-moss.txt をインストールしてください") from exc
        upstream = self._module()

        class TerminalRuntime(upstream.OrtCpuRuntime):
            def _create_sessions(self):
                tts = {"prefill": "prefill", "decode": "decode_step", "local_fixed_sampled_frame": "local_fixed_sampled_frame"}
                codec = {"codec_decode": "decode_full", "codec_decode_step": "decode_step"}
                return {
                    **{key: self._session(self.tts_meta_path.parent / self.tts_meta["files"][value]) for key, value in tts.items()},
                    **{key: self._session(self.codec_meta_path.parent / self.codec_meta["files"][value]) for key, value in codec.items()},
                }

        self.runtime = TerminalRuntime(models, thread_count=2, max_new_frames=250, sample_mode="fixed")
        self.tokenizer = spm.SentencePieceProcessor(model_file=str(models / MODEL / "tokenizer.model"))

    def register(self, wav: bytes, name: str) -> dict:
        if not 1 <= len(wav) <= 10 * 1024 * 1024:
            raise ValueError("録音は10MB以下のWAVファイルにしてください")
        _, models = self.paths()
        try:
            import io
            import numpy as np
            import onnxruntime as ort
            import soundfile as sf
            from scipy.signal import resample_poly
        except ImportError as exc:
            raise RuntimeError("MOSS 用 Python 依存がありません。server/requirements-moss.txt をインストールしてください") from exc
        samples, sample_rate = sf.read(io.BytesIO(wav), dtype="float32", always_2d=True)
        if not 1 <= len(samples) / sample_rate <= 30 or float(np.max(np.abs(samples))) < 0.005:
            raise ValueError("1〜30秒の聞こえる録音を選んでください")
        meta = json.loads((models / CODEC / "codec_browser_onnx_meta.json").read_text(encoding="utf-8"))
        wanted_rate = int(meta["codec_config"]["sample_rate"])
        if sample_rate != wanted_rate:
            divisor = math.gcd(sample_rate, wanted_rate)
            samples = resample_poly(samples, wanted_rate // divisor, sample_rate // divisor, axis=0)
        channels = int(meta["codec_config"]["channels"])
        if samples.shape[1] == 1 and channels == 2:
            samples = np.repeat(samples, 2, axis=1)
        elif samples.shape[1] != channels:
            raise ValueError("このWAVのチャンネル数には対応していません")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        session = ort.InferenceSession(str(models / CODEC / meta["files"]["encode"]), sess_options=opts, providers=["CPUExecutionProvider"])
        waveform = np.ascontiguousarray(samples.T[None], dtype=np.float32)
        output = session.run(None, {"waveform": waveform, "input_lengths": np.asarray([waveform.shape[-1]], dtype=np.int32)})
        values = dict(zip([item.name for item in session.get_outputs()], output))
        count = int(values["audio_code_lengths"].reshape(-1)[0])
        return {"format": FORMAT, "model": MODEL, "codec": CODEC, "name": name,
                "prompt_audio_codes": values["audio_codes"][0, :count].astype(int).tolist()}

    def synthesize(self, text: str, profile: dict, cancelled: Event, on_loaded=None) -> bytes:
        with self.lock:
            if cancelled.is_set():
                raise GenerationCancelled()
            self._load()
            if on_loaded:
                on_loaded()
            import io
            import numpy as np
            import soundfile as sf
            ids = self.tokenizer.encode(text, out_type=int)
            request = self.runtime.build_voice_clone_request_rows(profile["prompt_audio_codes"], ids)

            def check_cancel(*_):
                if cancelled.is_set():
                    raise GenerationCancelled()

            frames = self.runtime.generate_audio_frames(request, on_frame=check_cancel)
            check_cancel()
            channels, _ = self.runtime.decode_full_audio(frames)
            audio = np.stack(channels, axis=1)
            sample_rate = int(self.runtime.codec_meta["codec_config"]["sample_rate"])
            out = io.BytesIO()
            sf.write(out, audio, sample_rate, format="WAV", subtype="PCM_16")
            return out.getvalue()
