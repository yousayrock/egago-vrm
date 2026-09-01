import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHealth, fetchModels, fetchSpeakers, synthesize, uploadModel } from '../core/api';
import { bus, type StageState } from '../core/bus';
import { DEFAULT_CHARACTER_ASSET_ID } from '../core/characterAssets';
import { useStore } from '../core/store';
import type { GestureName } from '../core/types';
import type { Viewer } from '../three/Viewer';
import { ExpressionPanel } from '../ui/ExpressionPanel';
import { CharacterScriptPanel } from '../ui/CharacterScriptPanel';
import { ScenePanel } from '../ui/ScenePanel';
import { useViewerSync } from '../ui/useViewerSync';
import { VoicePanel } from '../ui/VoicePanel';
import { VrmCanvas } from '../ui/VrmCanvas';
import { TwoDCharacter } from '../ui/TwoDCharacter';

/** Stage 側が生きているとみなす猶予。heartbeat 2 回分ぶんの余裕を見る。 */
const STAGE_TIMEOUT = 12_000;
const CONTROLLERS = ['おしゃべり', '声（こえ）', '気分', '動き', '体の動き', 'おまかせ', 'キャラクター', '背景', 'カメラ'];

export function EditorPage() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [dragging, setDragging] = useState(false);
  const { loading, modelError } = useViewerSync(viewer);

  const s = useStore();
  const { patch, set } = s;
  const stageCharacters = Array.isArray(s.characters) && s.characters.length
    ? s.characters
    : [{ id: 'eriru-1', name: 'エリルたそ 1', spriteId: DEFAULT_CHARACTER_ASSET_ID, x: 0, height: 0, depth: 0, scale: 1, rotation: 0, facing: 1 as const }];

  const stageTimer = useRef<number | undefined>(undefined);
  const controlPagesRef = useRef<HTMLDivElement>(null);
  const [activeControl, setActiveControl] = useState(0);
  const [twoDGesture, setTwoDGesture] = useState<GestureName | null>(null);
  const [speakingLine, setSpeakingLine] = useState<number | null>(null);
  const stopScriptRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const draggedCharacterRef = useRef<string | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const id = draggedCharacterRef.current;
      const bounds = previewRef.current?.getBoundingClientRect();
      if (!id || !bounds) return;
      const x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) / 0.24));
      const height = Math.max(0, Math.min(1, (bounds.bottom - event.clientY) / bounds.height / 0.24));
      const state = useStore.getState();
      state.patch({ characters: state.characters.map((character) => character.id === id ? { ...character, x, height } : character) });
    };
    const end = () => { draggedCharacterRef.current = null; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, []);

  const startCharacterDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, id: string) => {
    event.preventDefault();
    draggedCharacterRef.current = id;
    set('selectedCharacterId', id);
  }, [set]);

  const goToControl = useCallback((index: number) => {
    const pages = controlPagesRef.current;
    if (!pages) return;
    pages.scrollTo({ left: pages.clientWidth * index, behavior: 'smooth' });
    setActiveControl(index);
  }, []);

  // --- 起動時: VOICEVOX の疎通確認と一覧取得 ---
  useEffect(() => {
    let alive = true;

    const poll = async () => {
      const health = await fetchHealth().catch(() => null);
      if (!alive) return;
      patch({ health });

      // モデル一覧は VOICEVOX と無関係だが、API 自体が Vite より遅れて上がるため
      // 起動直後の 1 回だけだと取りこぼす。空のあいだは取り直す。
      if (!useStore.getState().models.length) {
        const models = await fetchModels().catch(() => []);
        if (!alive) return;
        if (models.length) patch({ models });
      }

      // Engine が上がった直後に一覧が空のままにならないよう、都度取り直す
      if (health?.ok && !useStore.getState().speakers.length) {
        const speakers = await fetchSpeakers().catch(() => []);
        if (!alive || !speakers.length) return;

        // 保存されていた話者 ID が今の Engine に無い場合は先頭に寄せる
        const cur = useStore.getState().speakerId;
        const exists = speakers.some((sp) => sp.styles.some((st) => st.id === cur));
        patch({
          speakers,
          ...(exists ? {} : { speakerId: speakers[0].styles[0].id }),
        });
      }
    };

    void poll();
    const id = window.setInterval(poll, 5000);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [patch]);

  // --- Stage との接続 ---
  useEffect(() => {
    bus.start();

    const off = bus.on((msg) => {
      if (msg.type !== 'hello' || msg.role !== 'stage') return;

      patch({ stageConnected: true });
      window.clearTimeout(stageTimer.current);
      stageTimer.current = window.setTimeout(
        () => patch({ stageConnected: false }),
        STAGE_TIMEOUT,
      );

      // 開いた直後の Stage は初期状態なので、現在の設定を送り直す
      bus.send({ type: 'state', state: currentStageState() });
    });

    return () => {
      off();
      window.clearTimeout(stageTimer.current);
    };
  }, [patch]);

  // --- Stage へ設定を配信 ---
  useEffect(() => {
    bus.send({ type: 'state', state: currentStageState() });
  }, [
    s.modelUrl,
    s.background,
    s.backgroundColor,
    s.cameraDistance,
    s.cameraHeight,
    s.autoGesture,
    s.autoEmotion,
  ]);

  // Stage が鳴らしているあいだは Editor を黙らせる(口パクの時計は動かしたまま)
  useEffect(() => {
    viewer?.character.speech.setMuted(s.stageConnected && s.muteWhenStage);
  }, [viewer, s.stageConnected, s.muteWhenStage]);

  const speak = useCallback(async () => {
    const st = useStore.getState();
    const lines = st.scriptLines.filter((line) => line.text.trim());
    if (!lines.length) return;

    patch({ busy: true, error: null });
    stopScriptRef.current = false;
    try {
      for (const [index, line] of lines.entries()) {
        if (stopScriptRef.current) break;
        setSpeakingLine(index);
        patch({ selectedCharacterId: line.characterId });
        const res = await synthesize({ text: line.text, speaker: st.speakerId, speedScale: st.speedScale, pitchScale: st.pitchScale, intonationScale: st.intonationScale, volumeScale: st.volumeScale });
        if (stopScriptRef.current) break;
        bus.send({ type: 'speak', audio: res.audio, query: res.query, text: line.text });
        await viewer?.character.speak(res.audio, res.query, line.text);
      }
      return;
      const res = await synthesize({
        text: st.text,
        speaker: st.speakerId,
        speedScale: st.speedScale,
        pitchScale: st.pitchScale,
        intonationScale: st.intonationScale,
        volumeScale: st.volumeScale,
      });

      // Stage には合成済みの音をそのまま渡す。二重に合成しないし、必ず同じ音になる。
      bus.send({ type: 'speak', audio: res.audio, query: res.query, text: st.text });
      await viewer?.character.speak(res.audio, res.query, st.text);
    } catch (e) {
      patch({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSpeakingLine(null);
      patch({ busy: false });
    }
  }, [patch, viewer]);

  const stop = useCallback(() => {
    stopScriptRef.current = true;
    setSpeakingLine(null);
    viewer?.character.speech.stop();
    bus.send({ type: 'stop' });
  }, [viewer]);

  const toggleRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
      return;
    }
    if (!viewer || !window.MediaRecorder) {
      patch({ error: 'このブラウザでは録画を開始できません。Chrome または Edge で試してね。' });
      return;
    }
    try {
      const stream = viewer.getCanvas().captureStream(30);
      viewer.getRecordingAudioTracks().forEach((track) => stream.addTrack(track));
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getVideoTracks().forEach((track) => track.stop());
        const url = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `egago-movie-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        recorderRef.current = null;
        setRecording(false);
      };
      recorderRef.current = recorder;
      recorder.start(1000);
      setRecording(true);
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : '録画を開始できませんでした。' });
    }
  }, [patch, viewer]);

  const gesture = useCallback(
    (g: GestureName) => {
      viewer?.character.gesture(g);
      bus.send({ type: 'gesture', gesture: g });
      setTwoDGesture(g);
      window.setTimeout(() => setTwoDGesture(null), g === 'bow' ? 900 : 700);
    },
    [viewer],
  );

  useEffect(() => {
    bus.send({ type: 'emotion', emotion: s.emotion });
  }, [s.emotion]);

  // --- プレビューへの VRM ドロップ ---
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = Array.from(e.dataTransfer.files).find((f) =>
        f.name.toLowerCase().endsWith('.vrm'),
      );
      if (!file) return;

      patch({ busy: true, error: null });
      try {
        const model = await uploadModel(file);
        patch({ models: await fetchModels() });
        useStore.getState().selectModel(model.url);
      } catch (err) {
        patch({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        patch({ busy: false });
      }
    },
    [patch],
  );

  const engineOk = s.health?.ok ?? false;

  return (
    <div className="editor">
      <div
        ref={previewRef}
        className="preview"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <VrmCanvas onReady={setViewer} />
        {s.characterMode === 'image' && stageCharacters.map((character) => (
          <TwoDCharacter
            key={character.id}
            character={character}
            emotion={s.emotion}
            gesture={character.id === s.selectedCharacterId ? twoDGesture : null}
            onPointerDown={(event) => startCharacterDrag(event, character.id)}
          />
        ))}
        {loading && <div className="loading">モデルを読み込み中…</div>}
        <button type="button" className={`record-button${recording ? ' is-recording' : ''}`} onClick={toggleRecording}>
          {recording ? '■ 録画を止めて保存' : '● 録画スタート'}
        </button>
        {dragging && <div className="dropzone">.vrm をドロップして読み込み</div>}
      </div>

      <aside className="sidebar">
        <nav className="controller-header" aria-label="コントローラーのページ移動">
          <button
            type="button"
            className="controller-arrow"
            aria-label="前のコントローラー"
            disabled={activeControl === 0}
            onClick={() => goToControl(activeControl - 1)}
          >
            ‹
          </button>
          <div className="controller-current" aria-live="polite">
            <span>いまのコントローラー</span>
            <strong>{CONTROLLERS[activeControl]}</strong>
            <small>{activeControl + 1} / {CONTROLLERS.length}</small>
          </div>
          <button
            type="button"
            className="controller-arrow"
            aria-label="次のコントローラー"
            disabled={activeControl === CONTROLLERS.length - 1}
            onClick={() => goToControl(activeControl + 1)}
          >
            ›
          </button>
        </nav>
        <div className="status">
          <span className={`dot ${s.health === null ? 'wait' : engineOk ? 'ok' : 'bad'}`} />
          <span>
            {s.health === null
              ? 'VOICEVOX を確認中…'
              : engineOk
                ? `VOICEVOX ${s.health.voicevoxVersion}`
                : 'VOICEVOX が見つかりません'}
          </span>
        </div>
        {s.health && !engineOk && (
          <p className="hint">
            VOICEVOX アプリを起動してください。起動すると <code>{s.health.engineUrl}</code> に
            エンジンが立ち上がり、自動的に接続します。
          </p>
        )}

        {(s.error || modelError) && <div className="error">{s.error ?? modelError}</div>}

        <div
          ref={controlPagesRef}
          className="control-pages"
          onScroll={(event) => {
            const width = event.currentTarget.clientWidth;
            if (width) setActiveControl(Math.round(event.currentTarget.scrollLeft / width));
          }}
        >
        <CharacterScriptPanel
          lines={s.scriptLines}
          characters={stageCharacters}
          busy={s.busy}
          currentLine={speakingLine}
          canSpeak={engineOk}
          onChange={(scriptLines) => patch({ scriptLines })}
          onSpeak={() => void speak()}
          onStop={stop}
        />

        <VoicePanel />
        <ExpressionPanel onGesture={gesture} />
        <ScenePanel />
        </div>

      </aside>
    </div>
  );
}

function currentStageState(): StageState {
  const s = useStore.getState();
  return {
    modelUrl: s.modelUrl,
    background: s.background,
    backgroundColor: s.backgroundColor,
    cameraDistance: s.cameraDistance,
    cameraHeight: s.cameraHeight,
    autoGesture: s.autoGesture,
    autoEmotion: s.autoEmotion,
  };
}
