@echo off
rem ---------------------------------------------------------------
rem  EGAGO VRM 起動スクリプト
rem
rem  このファイルは Shift-JIS (CP932) + CRLF で保存すること。
rem  cmd.exe はバッチをコンソールのコードページで読むため、UTF-8 で保存すると
rem  日本語行が壊れる。改行が LF だと括弧ブロックの解析もずれる。
rem
rem  ダブルクリックすると
rem    依存の確認 -> VOICEVOX 起動 -> 開発サーバ起動 -> ブラウザ表示
rem  まで行う。
rem ---------------------------------------------------------------
setlocal

cd /d "%~dp0"
title EGAGO VRM

echo.
echo   EGAGO VRM
echo   すべての絵には、愛(AI)がある。
echo.

rem ===============================================================
rem  npm を探す
rem  PATH に無い環境 (エクスプローラから起動したときなど) でも動くよう、
rem  既定のインストール先も見に行く。
rem ===============================================================
set "NPM="
for /f "delims=" %%I in ('where npm.cmd 2^>nul') do if not defined NPM set "NPM=%%I"
if not defined NPM if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM=%ProgramFiles%\nodejs\npm.cmd"
if not defined NPM if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "NPM=%ProgramFiles(x86)%\nodejs\npm.cmd"
if not defined NPM if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" set "NPM=%LOCALAPPDATA%\Programs\nodejs\npm.cmd"
if not defined NPM goto nonode

rem npm が PATH の外に居ても子プロセスから見えるように、その場所を PATH に足す。
rem %%~dpI は末尾に \ が付く。"%VAR%" と書くと \" で引用符が壊れるため、
rem 一度 NODEDIR に入れてから ~ で外す。
for %%I in ("%NPM%") do set "NODEDIR=%%~dpI"
for %%I in ("%NODEDIR%.") do set "NODEDIR=%%~fI"
set "PATH=%NODEDIR%;%PATH%"

rem ===============================================================
rem  python.exe を探す
rem  npm run dev の中で `python server/run.py` が呼ばれるので、
rem  ここで見つけた場所を PATH の先頭に足して子プロセスにも見えるようにする。
rem ===============================================================
set "PY="
for /f "delims=" %%I in ('where python 2^>nul') do if not defined PY set "PY=%%I"
for %%V in (313 312 311 310) do if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
for %%V in (313 312 311 310) do if not defined PY if exist "%ProgramFiles%\Python%%V\python.exe" set "PY=%ProgramFiles%\Python%%V\python.exe"

rem 見つからなければ py ランチャーに python.exe の場所を聞く
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Launcher\py.exe" set "PATH=%LOCALAPPDATA%\Programs\Python\Launcher;%PATH%"
if not defined PY for /f "delims=" %%I in ('py -3 -c "import sys;print(sys.executable)" 2^>nul') do if not defined PY set "PY=%%I"

if not defined PY goto nopython

for %%I in ("%PY%") do set "PYDIR=%%~dpI"
for %%I in ("%PYDIR%.") do set "PYDIR=%%~fI"
set "PATH=%PYDIR%;%PATH%"

echo   node : %NODEDIR%
echo   py   : %PY%
echo.

rem ===============================================================
rem  依存
rem ===============================================================
if not exist "node_modules\" (
  echo [1/3] npm の依存をインストールします。初回は数分かかります...
  call "%NPM%" install
  if errorlevel 1 goto failed
) else (
  echo [1/3] npm の依存は導入済みです。
)

"%PY%" -c "import fastapi, uvicorn, httpx" >nul 2>&1
if errorlevel 1 (
  echo [2/3] Python の依存をインストールします...
  "%PY%" -m pip install -r server/requirements.txt
  if errorlevel 1 goto failed
) else (
  echo [2/3] Python の依存は導入済みです。
)

rem ===============================================================
rem  VOICEVOX
rem ===============================================================
set "VOICEVOX_EXE=%LOCALAPPDATA%\Programs\VOICEVOX\VOICEVOX.exe"
netstat -ano | findstr ":50021" >nul 2>&1
if errorlevel 1 (
  if exist "%VOICEVOX_EXE%" (
    echo [3/3] VOICEVOX を起動します...
    start "" "%VOICEVOX_EXE%"
  ) else (
    echo [3/3] [注意] VOICEVOX が起動していません。あとから起動すれば自動的に接続します。
  )
) else (
  echo [3/3] VOICEVOX は起動済みです。
)

rem ---- サーバの準備ができたらブラウザを開く ----
start "" cmd /c "timeout /t 8 /nobreak >nul && explorer http://localhost:5173"

echo.
echo   Vite (5173) と FastAPI (8000) を起動します。
echo   Editor : http://localhost:5173
echo   Stage  : http://localhost:5173/stage?bg=alpha   (OBS のブラウザソース用)
echo.
echo   終了するときは、このウィンドウで Ctrl + C を押してください。
echo.

call "%NPM%" run dev

echo.
echo   開発サーバが終了しました。
pause
exit /b 0

:nonode
echo [エラー] Node.js (npm) が見つかりません。
echo          https://nodejs.org/ から 20 以降を入れてください。
echo.
echo   PATH = %PATH%
echo.
pause
exit /b 1

:nopython
echo [エラー] Python が見つかりません。
echo          https://www.python.org/ から 3.10 以降を入れてください。
echo          インストール時に "Add python.exe to PATH" にチェックを入れてください。
echo.
echo   PATH = %PATH%
echo.
pause
exit /b 1

:failed
echo.
echo [エラー] セットアップに失敗しました。上のログを確認してください。
echo.
pause
exit /b 1
