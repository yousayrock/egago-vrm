import { decodeBase64Audio } from './api';
import type { AudioQuery } from './types';

/**
 * 音声再生 (docs T009 の再生側)。
 *
 * 口パクの基準時刻は AudioContext.currentTime から取る。
 * <audio> の currentTime よりも精度と安定性が高く、モーラ単位の同期に耐える。
 */
export class SpeechEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private captureDestination: MediaStreamAudioDestinationNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;

  playing = false;
  /** Stage 側で鳴らす場合に Editor を黙らせる。口パクの時計は動かしたままにする。 */
  muted = false;

  onStart: ((query: AudioQuery) => void) | null = null;
  onEnd: (() => void) | null = null;

  /** AudioContext はユーザー操作の中で作る / 起こす必要がある。 */
  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      this.captureDestination = this.ctx.createMediaStreamDestination();
      this.gain.connect(this.captureDestination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  async play(audioB64: string, query: AudioQuery): Promise<void> {
    const ctx = this.ensureContext();
    const buffer = await ctx.decodeAudioData(decodeBase64Audio(audioB64));

    this.stop();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain!);
    this.gain!.gain.value = this.muted ? 0 : 1;

    source.onended = () => {
      // stop() で差し替えた後の古い source からの通知は無視する
      if (this.source !== source) return;
      this.playing = false;
      this.source = null;
      this.onEnd?.();
    };

    this.source = source;
    this.startedAt = ctx.currentTime;
    this.playing = true;
    this.onStart?.(query);
    source.start();
  }

  stop(): void {
    if (this.source) {
      const s = this.source;
      this.source = null;
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* 未再生の source を止めると例外になるが実害はない */
      }
    }
    if (this.playing) {
      this.playing = false;
      this.onEnd?.();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : 1;
  }

  getRecordingStream(): MediaStream {
    this.ensureContext();
    return this.captureDestination!.stream;
  }

  /** 再生開始からの経過秒。停止中は 0。 */
  get time(): number {
    if (!this.playing || !this.ctx) return 0;
    return this.ctx.currentTime - this.startedAt;
  }
}
