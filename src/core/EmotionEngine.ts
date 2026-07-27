import type { ExpressionMixer } from './ExpressionMixer';
import { EMOTIONS, type EmotionName } from './types';

/**
 * 感情表現 (docs T012)。
 * 切り替えは瞬時ではなく短いフェードにする。表情が「パチッ」と入れ替わると人形に見える。
 */
export class EmotionEngine {
  private weights: Record<EmotionName, number> = {
    neutral: 1,
    happy: 0,
    angry: 0,
    sad: 0,
    relaxed: 0,
    surprised: 0,
  };

  private current: EmotionName = 'neutral';
  private intensity = 1;

  /** フェードにかける時間(秒)。 */
  fadeDuration = 0.3;

  set(name: EmotionName, intensity = 1): void {
    this.current = name;
    this.intensity = Math.min(1, Math.max(0, intensity));
  }

  get value(): EmotionName {
    return this.current;
  }

  update(dt: number, mixer: ExpressionMixer): void {
    const step = dt / this.fadeDuration;

    for (const name of EMOTIONS) {
      const target = name === this.current ? this.intensity : 0;
      const diff = target - this.weights[name];
      if (Math.abs(diff) <= step) {
        this.weights[name] = target;
      } else {
        this.weights[name] += Math.sign(diff) * step;
      }

      // neutral は多くのモデルで中身が空なので送っても実害はないが、
      // 0 のものまで毎フレーム書くと Mixer の集計が無駄に膨らむので省く。
      if (this.weights[name] > 0.001) {
        mixer.set('emotion', name, this.weights[name]);
      } else {
        mixer.set('emotion', name, 0);
      }
    }
  }
}
