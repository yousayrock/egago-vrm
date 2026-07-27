import { useRef } from 'react';
import { fetchModels, uploadModel } from '../core/api';
import { useStore } from '../core/store';
import type { BackgroundMode } from '../core/types';
import { Field, Panel, Slider } from './parts';

const BG_LABELS: Record<BackgroundMode, string> = {
  alpha: '透過',
  green: 'グリーン',
  color: '単色',
};

/** モデル / 背景 / カメラ (docs T005, T015, UI.md の Background)。 */
export function ScenePanel() {
  const models = useStore((s) => s.models);
  const modelUrl = useStore((s) => s.modelUrl);
  const background = useStore((s) => s.background);
  const backgroundColor = useStore((s) => s.backgroundColor);
  const cameraDistance = useStore((s) => s.cameraDistance);
  const cameraHeight = useStore((s) => s.cameraHeight);
  const set = useStore((s) => s.set);
  const patch = useStore((s) => s.patch);
  const selectModel = useStore((s) => s.selectModel);

  const fileRef = useRef<HTMLInputElement>(null);

  async function addModel(file: File) {
    patch({ busy: true, error: null });
    try {
      // Stage(OBS)は別ブラウザなので blob URL を共有できない。
      // サーバに置いて、双方から同じ URL で読めるようにする。
      const model = await uploadModel(file);
      patch({ models: await fetchModels() });
      selectModel(model.url);
    } catch (e) {
      patch({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      patch({ busy: false });
    }
  }

  return (
    <>
      <Panel title="Model">
        <Field>
          <select value={modelUrl} onChange={(e) => selectModel(e.target.value)}>
            {!models.length && <option value={modelUrl}>読み込み中…</option>}
            {models.map((m) => (
              <option key={m.url} value={m.url}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <button style={{ width: '100%' }} onClick={() => fileRef.current?.click()}>
          VRM を追加…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".vrm"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void addModel(f);
            e.target.value = '';
          }}
        />
        <p className="hint" style={{ marginBottom: 0 }}>
          プレビューに .vrm をドラッグしても追加できます。
          <br />
          声とカメラの写りはキャラクターごとに自動で保存されます。
        </p>
      </Panel>

      <Panel title="Background">
        <div className="grid c3" style={{ marginBottom: 10 }}>
          {(Object.keys(BG_LABELS) as BackgroundMode[]).map((m) => (
            <button
              key={m}
              className={background === m ? 'active' : ''}
              onClick={() => set('background', m)}
            >
              {BG_LABELS[m]}
            </button>
          ))}
        </div>
        {background === 'color' && (
          <Field label="背景色">
            <input
              type="color"
              value={backgroundColor}
              onChange={(e) => set('backgroundColor', e.target.value)}
            />
          </Field>
        )}
        {background === 'green' && (
          <p className="hint">OBS では「クロマキー」フィルタで抜きます。</p>
        )}
        {background === 'alpha' && (
          <p className="hint">OBS のブラウザソースならアルファがそのまま通ります。</p>
        )}
      </Panel>

      <Panel title="Camera">
        <Slider
          label="距離"
          value={cameraDistance}
          min={0.5}
          max={4}
          step={0.05}
          onChange={(v) => set('cameraDistance', v)}
        />
        <Slider
          label="高さ"
          value={cameraHeight}
          min={-1}
          max={0.5}
          step={0.01}
          onChange={(v) => set('cameraHeight', v)}
        />
        <p className="hint">プレビュー上でドラッグ / ホイールでも動かせます。</p>
      </Panel>
    </>
  );
}
