import { useMemo } from 'react';
import { useStore } from '../core/store';
import { Field, Panel, Slider } from './parts';

/** docs/UI.md の Voice / Style / Speech パネル。 */
export function VoicePanel() {
  const speakers = useStore((s) => s.speakers);
  const speakerId = useStore((s) => s.speakerId);
  const set = useStore((s) => s.set);

  const speedScale = useStore((s) => s.speedScale);
  const pitchScale = useStore((s) => s.pitchScale);
  const intonationScale = useStore((s) => s.intonationScale);
  const volumeScale = useStore((s) => s.volumeScale);

  // 選択中のスタイル ID から、どの話者に属しているかを逆引きする
  const currentSpeaker = useMemo(
    () => speakers.find((sp) => sp.styles.some((st) => st.id === speakerId)) ?? speakers[0],
    [speakers, speakerId],
  );

  return (
    <Panel title="声（こえ）">
      <Field label="話者">
        <select
          value={currentSpeaker?.uuid ?? ''}
          disabled={!speakers.length}
          onChange={(e) => {
            const sp = speakers.find((x) => x.uuid === e.target.value);
            // 話者を変えたら、その話者の先頭スタイルに寄せる
            if (sp?.styles.length) set('speakerId', sp.styles[0].id);
          }}
        >
          {!speakers.length && <option>読み込み中…</option>}
          {speakers.map((sp) => (
            <option key={sp.uuid} value={sp.uuid}>
              {sp.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="スタイル">
        <select
          value={speakerId}
          disabled={!currentSpeaker}
          onChange={(e) => set('speakerId', Number(e.target.value))}
        >
          {currentSpeaker?.styles.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name}
            </option>
          ))}
        </select>
      </Field>

      <Slider
        label="話速"
        value={speedScale}
        min={0.5}
        max={2}
        step={0.05}
        onChange={(v) => set('speedScale', v)}
      />
      <Slider
        label="音高"
        value={pitchScale}
        min={-0.15}
        max={0.15}
        step={0.01}
        onChange={(v) => set('pitchScale', v)}
      />
      <Slider
        label="抑揚"
        value={intonationScale}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => set('intonationScale', v)}
      />
      <Slider
        label="音量"
        value={volumeScale}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => set('volumeScale', v)}
      />
    </Panel>
  );
}
