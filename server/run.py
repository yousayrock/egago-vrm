"""`npm run dev` から呼ばれる FastAPI の起動スクリプト.

uvicorn の CLI が PATH に無い環境でも動くよう、Python から直接起動する。
依存が入っていない場合は何をすればよいかを日本語で明示して終了する。
"""

from __future__ import annotations

import pathlib
import os
import sys

HERE = pathlib.Path(__file__).resolve().parent

try:
    import uvicorn  # noqa: F401
    import fastapi  # noqa: F401
    import httpx  # noqa: F401
except ImportError:
    print(
        "\n[EGAGO VRM] Python の依存が未インストールです。\n"
        f"  {sys.executable} -m pip install -r server/requirements.txt\n"
        "を実行してから、もう一度 npm run dev してください。\n",
        file=sys.stderr,
    )
    raise SystemExit(1)

import uvicorn

if __name__ == "__main__":
    # main.py が `import voicevox` できるように server/ を import path に載せる
    sys.path.insert(0, str(HERE))
    production = os.environ.get("EGAGO_PRODUCTION") == "1"
    uvicorn.run("main:app", host="127.0.0.1", port=8000,
                reload=not production, reload_dirs=None if production else [str(HERE)])
