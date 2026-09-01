import { useEffect, useState, type CSSProperties } from 'react';
import { getCharacterAsset } from '../core/characterAssets';
import type { EmotionName, GestureName, StageCharacter } from '../core/types';

export function TwoDCharacter({
  emotion,
  gesture,
  character,
  onPointerDown,
}: {
  emotion: EmotionName;
  gesture: GestureName | null;
  character: StageCharacter;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const [blinking, setBlinking] = useState(false);
  const asset = getCharacterAsset(character.spriteId);

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
      className={`two-d-character-wrap${gesture ? ` gesture-${gesture}` : ''}`}
      style={{
        left: `${24 + character.x * 24}%`,
        bottom: `${character.height * 24}%`,
        width: `${52 * character.scale * (1 + character.depth * 0.12)}%`,
        height: `${80 * character.scale * (1 + character.depth * 0.12)}%`,
        zIndex: Math.round(character.depth * 100 + character.height * 10 + character.scale * 10),
      } as CSSProperties}
      onPointerDown={onPointerDown}
    >
      <img
        className="two-d-character"
        style={{ '--character-facing': character.facing, '--character-rotation': `${character.rotation}deg` } as CSSProperties}
        src={gesture === 'surprise' ? asset.images.banzai : blinking ? asset.images.blink : asset.images[emotion]}
        alt={asset.label}
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
