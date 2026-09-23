import type { ExpressionMixer } from './ExpressionMixer';
import type { VisemeSegment } from './speechTimeline';
import type { Viseme } from './types';

/**
 * 口パク (docs T011)。
 *
 * 音声の音量から口を動かすのではなく、VOICEVOX の AudioQuery に入っている
 * モーラ列(母音とその長さ)から作ったタイムラインを再生する。
 * 再生前に全区間が確定するので同期がズレず、母音ごとの正しい口形が出せる。
 * タイムラインの生成は speechTimeline.ts が担当する。
 */

const ALL_VISEMES: Viseme[] = ['aa', 'ih', 'ou', 'ee', 'oh'];

export class LipSyncEngine {
  private timeline: VisemeSegment[] = [];
  private cursor = 0;
  private current: Record<Viseme, number> = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  private active = false;
  private amplitudeMode = false;

  start(timeline: VisemeSegment[]): void {
    this.timeline = timeline;
    this.cursor = 0;
    this.active = true;
    this.amplitudeMode = false;
  }

  startAmplitude(): void {
    this.timeline = [];
    this.cursor = 0;
    this.active = true;
    this.amplitudeMode = true;
  }

  stop(): void {
    this.active = false;
    this.amplitudeMode = false;
    this.timeline = [];
    this.cursor = 0;
  }

  /**
   * @param time 再生開始からの経過秒。AudioContext.currentTime を基準に算出したもの。
   */
  update(dt: number, time: number, mixer: ExpressionMixer, amplitude = 0): void {
    const target: Record<Viseme, number> = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

    if (this.active) {
      if (this.amplitudeMode) target.aa = amplitude;
      else {
        const seg = this.segmentAt(time);
        if (seg?.viseme) target[seg.viseme] = seg.weight;
      }
    }

    // 区間の切り替わりで口がカクつかないよう指数的に追従させる。
    // 時定数 35ms は「モーラを追える速さ」と「滑らかさ」の折り合い。
    const k = 1 - Math.exp(-dt / 0.035);
    let anyOpen = false;
    for (const v of ALL_VISEMES) {
      this.current[v] += (target[v] - this.current[v]) * k;
      if (this.current[v] > 0.001) {
        mixer.set('viseme', v, this.current[v]);
        anyOpen = true;
      } else {
        this.current[v] = 0;
        mixer.set('viseme', v, 0);
      }
    }

    if (!this.active && !anyOpen) mixer.clear('viseme');
  }

  /**
   * 現在時刻の区間を返す。時刻は単調に進むのでカーソルを持ち越し、
   * 毎フレーム全区間を走査しないようにする。
   */
  private segmentAt(time: number): VisemeSegment | null {
    const tl = this.timeline;
    if (this.cursor >= tl.length) return null;

    // シーク等で巻き戻った場合に備えて後退も見る
    while (this.cursor > 0 && time < tl[this.cursor].start) this.cursor--;
    while (this.cursor < tl.length && time >= tl[this.cursor].end) this.cursor++;

    if (this.cursor >= tl.length) return null;
    const seg = tl[this.cursor];
    return time >= seg.start ? seg : null;
  }

  /** タイムライン全体の長さ(秒)。デバッグ表示用。 */
  get duration(): number {
    return this.timeline.length ? this.timeline[this.timeline.length - 1].end : 0;
  }
}
