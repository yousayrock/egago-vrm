import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHealth, fetchModels, fetchSpeakers, synthesize, uploadModel } from '../core/api';
import { bus, type StageState } from '../core/bus';
import { useStore } from '../core/store';
import type { GestureName } from '../core/types';
import type { Viewer } from '../three/Viewer';
import { ExpressionPanel } from '../ui/ExpressionPanel';
import { Panel, Toggle } from '../ui/parts';
import { ScenePanel } from '../ui/ScenePanel';
import { useViewerSync } from '../ui/useViewerSync';
import { VoicePanel } from '../ui/VoicePanel';
import { VrmCanvas } from '../ui/VrmCanvas';

/** Stage 側が生きているとみなす猶予。heartbeat 2 回分ぶんの余裕を見る。 */
const STAGE_TIMEOUT = 12_000;

export function EditorPage() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [dragging, setDragging] = useState(false);
  const { loading, modelError } = useViewerSync(viewer);

  const s = useStore();
  const { patch, set } = s;

  const stageTimer = useRef<number | undefined>(undefined);

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
    if (!st.text.trim()) return;

    patch({ busy: true, error: null });
    try {
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
      patch({ busy: false });
    }
  }, [patch, viewer]);

  const stop = useCallback(() => {
    viewer?.character.speech.stop();
    bus.send({ type: 'stop' });
  }, [viewer]);

  const gesture = useCallback(
    (g: GestureName) => {
      viewer?.character.gesture(g);
      bus.send({ type: 'gesture', gesture: g });
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
        className="preview"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <VrmCanvas onReady={setViewer} />
        {loading && <div className="loading">モデルを読み込み中…</div>}
        {dragging && <div className="dropzone">.vrm をドロップして読み込み</div>}
      </div>

      <aside className="sidebar">
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

        <Panel title="Speech">
          <textarea
            value={s.text}
            placeholder="喋らせたい文章を入力"
            onChange={(e) => set('text', e.target.value)}
            onKeyDown={(e) => {
              // Ctrl+Enter で発話。テキスト編集中に手が離れないように。
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void speak();
              }
            }}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="primary"
              style={{ flex: 1 }}
              disabled={s.busy || !engineOk || !s.text.trim()}
              onClick={() => void speak()}
            >
              {s.busy ? '合成中…' : '喋らせる'}
            </button>
            <button onClick={stop}>停止</button>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            Ctrl + Enter でも発話します。
          </p>
        </Panel>

        <VoicePanel />
        <ExpressionPanel onGesture={gesture} />
        <ScenePanel />

        <Panel title="Stage (OBS)">
          <div className="status" style={{ marginBottom: 10 }}>
            <span className={`dot ${s.stageConnected ? 'ok' : 'wait'}`} />
            <span>{s.stageConnected ? 'Stage 接続中' : 'Stage 未接続'}</span>
          </div>
          <button
            style={{ width: '100%', marginBottom: 8 }}
            onClick={() => window.open('/stage', 'egago-stage', 'width=1280,height=720')}
          >
            Stage を別ウィンドウで開く
          </button>
          <Toggle
            label="Stage 接続中は Editor をミュート"
            checked={s.muteWhenStage}
            onChange={(v) => set('muteWhenStage', v)}
          />
          <p className="hint" style={{ marginTop: 8 }}>
            OBS のブラウザソースに <code>{location.origin}/stage?bg=alpha</code> を指定すると
            背景が抜けた状態でキャラクターだけを取り込めます。
          </p>
        </Panel>
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
