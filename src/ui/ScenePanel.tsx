import { useRef } from 'react';
import { fetchModels, uploadModel } from '../core/api';
import { useStore } from '../core/store';
import { Field, Panel, Slider } from './parts';
import type { StageCharacter } from '../core/types';

const CHARACTER_MODES = [
  { value: 'image', label: '2Dキャラ' },
  { value: 'vrm', label: 'VRM' },
] as const;

const BG_LABELS: Record<'alpha' | 'image', string> = {
  alpha: '透過',
  image: '画像',
};

/** モデル / 背景 / カメラ (docs T005, T015, UI.md の Background)。 */
export function ScenePanel() {
  const models = useStore((s) => s.models);
  const modelUrl = useStore((s) => s.modelUrl);
  const characterMode = useStore((s) => s.characterMode);
  const characters = useStore((s) => Array.isArray(s.characters) && s.characters.length ? s.characters : [{ id: 'eriru-1', name: 'エリルたそ 1', characterKey: 'eriru', x: 0, height: 0, depth: 0, scale: 1, rotation: 0, facing: 1 as const }]);
  const selectedCharacterId = useStore((s) => s.selectedCharacterId);
  const background = useStore((s) => s.background);
  const backgroundColor = useStore((s) => s.backgroundColor);
  const backgroundImage = useStore((s) => s.backgroundImage);
  const cameraDistance = useStore((s) => s.cameraDistance);
  const cameraHeight = useStore((s) => s.cameraHeight);
  const set = useStore((s) => s.set);
  const patch = useStore((s) => s.patch);
  const selectModel = useStore((s) => s.selectModel);
  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? characters[0];

  const fileRef = useRef<HTMLInputElement>(null);
  const backgroundRef = useRef<HTMLInputElement>(null);

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

  function addBackgroundImage(file: File) {
    const url = URL.createObjectURL(file);
    patch({ background: 'image', backgroundImage: url });
  }

  function updateSelectedCharacter(values: Partial<StageCharacter>) {
    if (!selectedCharacter) return;
    patch({ characters: characters.map((character) => character.id === selectedCharacter.id ? { ...character, ...values } : character) });
  }

  function addCharacter(characterKey: 'eriru' | 'mia') {
    if (characters.length >= 4) return;
    const number = characters.length + 1;
    const id = `${characterKey}-${Date.now()}`;
    const label = characterKey === 'mia' ? 'ミア' : 'エリルたそ';
    patch({
      characters: [...characters, { id, name: `${label} ${number}`, characterKey, x: number % 2 ? -0.55 : 0.55, height: 0, depth: 0, scale: 0.78, rotation: 0, facing: 1 }],
      selectedCharacterId: id,
    });
  }

  function removeSelectedCharacter() {
    if (!selectedCharacter || characters.length === 1) return;
    const remaining = characters.filter((character) => character.id !== selectedCharacter.id);
    patch({ characters: remaining, selectedCharacterId: remaining[0].id });
  }

  return (
    <>
      <Panel title="キャラクター">
        <div className="grid c2" style={{ marginBottom: 10 }}>
          {CHARACTER_MODES.map((mode) => (
            <button
              key={mode.value}
              className={characterMode === mode.value ? 'active' : ''}
              onClick={() => set('characterMode', mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        {characterMode === 'image' && (
          <p className="hint two-d-note">2Dキャラクターを表示中です。</p>
        )}
        {characterMode === 'image' && (
          <>
            <div className="character-picker" aria-label="ステージのキャラクター">
              {characters.map((character) => (
                <button type="button" key={character.id} className={selectedCharacter?.id === character.id ? 'active' : ''} onClick={() => set('selectedCharacterId', character.id)}>
                  {character.name}
                </button>
              ))}
            </div>
            <div className="row character-actions">
              <button type="button" style={{ flex: 1 }} disabled={characters.length >= 4} onClick={() => addCharacter('eriru')}>+ エリルをふやす</button>
              <button type="button" style={{ flex: 1 }} disabled={characters.length >= 4} onClick={() => addCharacter('mia')}>+ ミアをふやす</button>
              <button type="button" disabled={characters.length === 1} onClick={removeSelectedCharacter}>この子を消す</button>
            </div>
            {selectedCharacter && (
              <div className="character-position">
                <Slider label="左右" value={selectedCharacter.x} min={-1} max={1} step={0.05} onChange={(x) => updateSelectedCharacter({ x })} />
                <Slider label="高さ" value={selectedCharacter.height} min={0} max={1} step={0.05} onChange={(height) => updateSelectedCharacter({ height })} />
                <Slider label="奥行き（奥 ← → 手前）" value={selectedCharacter.depth} min={-1} max={1} step={0.05} onChange={(depth) => updateSelectedCharacter({ depth })} />
                <Slider label="かたむき" value={selectedCharacter.rotation} min={-25} max={25} step={1} digits={0} onChange={(rotation) => updateSelectedCharacter({ rotation })} />
                <div className="grid c2 character-facing">
                  <button type="button" className={selectedCharacter.facing === -1 ? 'active' : ''} onClick={() => updateSelectedCharacter({ facing: -1 })}>左向き</button>
                  <button type="button" className={selectedCharacter.facing === 1 ? 'active' : ''} onClick={() => updateSelectedCharacter({ facing: 1 })}>右向き</button>
                </div>
                <Slider label="大きさ" value={selectedCharacter.scale} min={0.5} max={1.15} step={0.05} onChange={(scale) => updateSelectedCharacter({ scale })} />
              </div>
            )}
          </>
        )}
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

      <Panel title="背景">
        <div className="grid c3" style={{ marginBottom: 10 }}>
          {(Object.keys(BG_LABELS) as Array<keyof typeof BG_LABELS>).map((m) => (
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
        {background === 'image' && (
          <>
            <button style={{ width: '100%' }} onClick={() => backgroundRef.current?.click()}>
              すきな画像をえらぶ
            </button>
            <input
              ref={backgroundRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) addBackgroundImage(file);
                e.target.value = '';
              }}
            />
            <p className="hint">
              {backgroundImage ? '画像をセットしました。' : 'PNG・JPG・WebPの画像をえらべます。'}
            </p>
          </>
        )}
        {background === 'green' && (
          <p className="hint">OBS では「クロマキー」フィルタで抜きます。</p>
        )}
        {background === 'alpha' && (
          <p className="hint">OBS のブラウザソースならアルファがそのまま通ります。</p>
        )}
      </Panel>

      <Panel title="カメラ">
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
