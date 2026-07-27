import { useStore } from '../core/store';
import {
  EMOTIONS,
  EMOTION_LABELS,
  GESTURE_LABELS,
  type EmotionName,
  type GestureName,
} from '../core/types';
import { Panel, Toggle } from './parts';

const GESTURES = Object.keys(GESTURE_LABELS) as GestureName[];

/** 感情 (T012) とジェスチャー (T013)。 */
export function ExpressionPanel({ onGesture }: { onGesture: (g: GestureName) => void }) {
  const emotion = useStore((s) => s.emotion);
  const set = useStore((s) => s.set);
  const breath = useStore((s) => s.breath);
  const blink = useStore((s) => s.blink);
  const idle = useStore((s) => s.idle);
  const prosody = useStore((s) => s.prosody);
  const behavior = useStore((s) => s.behavior);
  const autoNod = useStore((s) => s.autoNod);
  const autoGesture = useStore((s) => s.autoGesture);

  return (
    <>
      <Panel title="Emotion">
        <div className="grid c3">
          {EMOTIONS.map((e: EmotionName) => (
            <button
              key={e}
              className={emotion === e ? 'active' : ''}
              onClick={() => set('emotion', e)}
            >
              {EMOTION_LABELS[e]}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Gesture">
        <div className="grid c3">
          {GESTURES.map((g) => (
            <button key={g} onClick={() => onGesture(g)}>
              {GESTURE_LABELS[g]}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Motion">
        <Toggle label="呼吸" checked={breath} onChange={(v) => set('breath', v)} />
        <Toggle label="瞬き" checked={blink} onChange={(v) => set('blink', v)} />
        <Toggle label="Idle" checked={idle} onChange={(v) => set('idle', v)} />
      </Panel>

      <Panel title="Auto Motion">
        <Toggle
          label="文末に合わせて仕草を出す"
          checked={autoGesture}
          onChange={(v) => set('autoGesture', v)}
        />
        <Toggle
          label="抑揚に合わせて頭・体が動く"
          checked={prosody}
          onChange={(v) => set('prosody', v)}
        />
        <Toggle
          label="沈黙中にさりげない仕草"
          checked={behavior}
          onChange={(v) => set('behavior', v)}
        />
        <Toggle label="発話時に自動でうなずく" checked={autoNod} onChange={(v) => set('autoNod', v)} />
        <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
          立ち姿と Idle の揺れ方は、選んだ感情に応じて自動で変わります。
        </p>
      </Panel>
    </>
  );
}
