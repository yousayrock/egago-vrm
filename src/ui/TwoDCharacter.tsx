import { useEffect, useState, type CSSProperties } from 'react';
import type { EmotionName, GestureName, StageCharacter } from '../core/types';

type CharacterAssets = {
  expressions: Record<EmotionName, string>;
  blink: string;
  banzai: string;
};

const CHARACTER_ASSETS: Record<string, CharacterAssets> = {
  eriru: {
    expressions: {
      neutral: '/characters/eriru-neutral.png',
      happy: '/characters/eriru-happy.png',
      angry: '/characters/eriru-angry.png',
      sad: '/characters/eriru-sad.png',
      relaxed: '/characters/eriru-relaxed.png',
      surprised: '/characters/eriru-surprised.png',
    },
    blink: '/characters/eriru-blink.png',
    banzai: '/characters/eriru-banzai.png',
  },
  mia: {
    expressions: {
      neutral: '/characters/mia-neutral.png',
      happy: '/characters/mia-happy.png',
      angry: '/characters/mia-angry.png',
      sad: '/characters/mia-sad.png',
      relaxed: '/characters/mia-relaxed.png',
      surprised: '/characters/mia-surprised.png',
    },
    blink: '/characters/mia-blink.png',
    banzai: '/characters/mia-banzai.png',
  },
};

export function TwoDCharacter({
  emotion,
  gesture,
  character,
  onPointerDown,
  selected,
}: {
  emotion: EmotionName;
  gesture: GestureName | null;
  character: StageCharacter;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  selected: boolean;
}) {
  const [blinking, setBlinking] = useState(false);
  const assets = CHARACTER_ASSETS[character.characterKey ?? 'eriru'] ?? CHARACTER_ASSETS.eriru;
  const depthScale = 0.72 + ((character.depth + 1) / 2) * 0.56;
  const width = 52 * character.scale * depthScale;
  const maxX = Math.max(0, 1 - width / 100);
  const x = Math.max(-maxX, Math.min(maxX, character.x));

  useEffect(() => {
    let blinkTimer: number | undefined;
    let closeTimer: number | undefined;

    const blink = () => {
      setBlinking(true);
      closeTimer = window.setTimeout(() => {
        setBlinking(false);
        blinkTimer = window.setTimeout(blink, 2800 + Math.random() * 2200);
      }, 150);
    };

    blinkTimer = window.setTimeout(blink, 2200);
    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(closeTimer);
    };
  }, []);

  return (
    <div
      className={`two-d-character-wrap${gesture ? ` gesture-${gesture}` : ''}${selected ? ' is-selected' : ''}`}
      style={{
        left: `${50 + x * 50 - width / 2}%`,
        bottom: `${character.height * 24 + (1 - character.depth) * 8}%`,
        width: `${width}%`,
        height: `${80 * character.scale * depthScale}%`,
        zIndex: Math.round(100 + character.depth * 100 + character.height * 10 + character.scale * 10),
      } as CSSProperties}
      onPointerDown={onPointerDown}
    >
      <img
        className="two-d-character"
        style={{ '--character-facing': character.facing, '--character-rotation': `${character.rotation}deg` } as CSSProperties}
        src={gesture === 'surprise' ? assets.banzai : blinking ? assets.blink : assets.expressions[emotion]}
        alt={character.name}
      />
      <span className="character-spark spark-one" aria-hidden="true">✦</span>
      <span className="character-spark spark-two" aria-hidden="true">✧</span>
      <span className="character-spark spark-three" aria-hidden="true">✦</span>
      <span className="character-spark spark-four" aria-hidden="true">✧</span>
      <span className="character-spark spark-five" aria-hidden="true">✦</span>
      <span className="character-spark spark-six" aria-hidden="true">✧</span>
      <span className="character-spark spark-seven" aria-hidden="true">✦</span>
      <span className="character-spark spark-eight" aria-hidden="true">✧</span>
      <span className="character-spark spark-nine" aria-hidden="true">✦</span>
      <span className="character-spark spark-ten" aria-hidden="true">✧</span>
    </div>
  );
}
