import type { VRM } from '@pixiv/three-vrm';


/**
 * 表情の合成。
 *
 * 瞬き・口パク・感情がそれぞれ勝手に VRMExpressionManager を触ると、
 * 後から書いた側が前の値を消してしまう(発話中に瞬きすると口が閉じる、など)。
 * そこで各エンジンは「自分のレイヤ」に書くだけにして、
 * 毎フレーム最後にここが合算して 1 度だけ VRM に流す。
 */

export type Layer = 'emotion' | 'viseme' | 'blink';

const LAYERS: Layer[] = ['emotion', 'viseme', 'blink'];

export class ExpressionMixer {
  private layers: Record<Layer, Map<string, number>> = {
    emotion: new Map(),
    viseme: new Map(),
    blink: new Map(),
  };

  /** 直前のフレームで VRM に書いた表情名。0 に戻す対象を知るために保持する。 */
  private lastApplied = new Set<string>();

  /** 小文字化した表情名 → モデルが実際に持っている表情名。 */
  private aliases = new Map<string, string>();

  /**
   * モデルが持つ表情名を控える。
   *
   * VRM 0.x 由来のモデルでは、プリセット外のブレンドシェイプ名がそのまま残る。
   * 実際 `surprised` ではなく `Surprised` を持つモデルがあり、
   * 名前をそのまま渡すと驚き顔だけ効かない。大小を無視して引き直す。
   */
  setVrm(vrm: VRM): void {
    this.aliases.clear();
    this.lastApplied.clear();
    const map = vrm.expressionManager?.expressionMap ?? {};
    for (const name of Object.keys(map)) {
      this.aliases.set(name.toLowerCase(), name);
    }
  }

  private resolve(name: string): string | null {
    return this.aliases.get(name.toLowerCase()) ?? null;
  }

  set(layer: Layer, name: string, weight: number): void {
    this.layers[layer].set(name, weight);
  }

  clear(layer: Layer): void {
    this.layers[layer].clear();
  }

  /** 全レイヤを合算して VRM に反映する。呼ぶのは毎フレーム 1 回だけ。 */
  apply(vrm: VRM): void {
    const manager = vrm.expressionManager;
    if (!manager) return;

    const total = new Map<string, number>();
    for (const layer of LAYERS) {
      for (const [name, weight] of this.layers[layer]) {
        // モデルが持っていない表情はここで捨てる
        const actual = this.resolve(name);
        if (actual) total.set(actual, (total.get(actual) ?? 0) + weight);
      }
    }

    // 今フレームで使われなくなった表情を 0 に戻す。
    // これをしないと最後の口の形や感情が残り続ける。
    for (const name of this.lastApplied) {
      if (!total.has(name)) manager.setValue(name, 0);
    }

    for (const [name, weight] of total) {
      manager.setValue(name, Math.min(1, Math.max(0, weight)));
    }

    this.lastApplied = new Set(total.keys());
  }
}
