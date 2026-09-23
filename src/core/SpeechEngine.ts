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
  private analyser: AnalyserNode | null = null;
  private amplitudeSamples = new Uint8Array(256);
  private startedAt = 0;
  private playToken = 0;
  private finishPlayback: (() => void) | null = null;
  private disposed = false;

  playing = false;
  /** Stage 側で鳴らす場合に Editor を黙らせる。口パクの時計は動かしたままにする。 */
  muted = false;

  onStart: ((query?: AudioQuery) => void) | null = null;
  onEnd: (() => void) | null = null;

  /** AudioContext はユーザー操作の中で作る / 起こす必要がある。 */
  private ensureContext(): AudioContext {
    if (this.disposed) throw new Error('音声エンジンは終了しています');
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      this.captureDestination = this.ctx.createMediaStreamDestination();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
    }
    return this.ctx;
  }

  /** 合成リクエスト前のユーザー操作で音声を有効にする。 */
  async prepare(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
  }

  async play(audioB64: string, query?: AudioQuery): Promise<void> {
    this.stop();
    const token = this.playToken;
    const ctx = this.ensureContext();
    await this.prepare();
    if (token !== this.playToken) return;
    const buffer = await ctx.decodeAudioData(decodeBase64Audio(audioB64));
    if (token !== this.playToken) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain!);
    // 配信用ミュートはスピーカーだけに適用し、録画音声は残す。
    source.connect(this.captureDestination!);
    source.connect(this.analyser!);
    this.gain!.gain.value = this.muted ? 0 : 1;

    const ended = new Promise<void>((resolve) => { this.finishPlayback = resolve; });

    source.onended = () => {
      // stop() で差し替えた後の古い source からの通知は無視する
      if (this.source !== source) return;
      this.stop();
    };

    this.source = source;
    this.startedAt = ctx.currentTime;
    this.playing = true;
    try {
      this.onStart?.(query);
      source.start();
      await ended;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop(): void {
    ++this.playToken;
    if (this.source) {
      const s = this.source;
      this.source = null;
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* 未再生の source を止めると例外になるが実害はない */
      }
      s.disconnect();
    }
    this.finishPlayback?.();
    this.finishPlayback = null;
    if (this.playing) {
      this.playing = false;
      this.onEnd?.();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : 1;
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.captureDestination?.stream.getTracks().forEach((track) => track.stop());
    this.gain?.disconnect();
    this.analyser?.disconnect();
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
    this.gain = null;
    this.captureDestination = null;
    this.analyser = null;
  }

  getRecordingStream(): MediaStream {
    this.ensureContext();
    return this.captureDestination!.stream;
  }

  /** Timing metadata がない音声の簡易口パク用の振幅。母音は推定しない。 */
  get amplitude(): number {
    if (!this.playing || !this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.amplitudeSamples);
    let sum = 0;
    for (const sample of this.amplitudeSamples) sum += ((sample - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.amplitudeSamples.length) * 8);
  }

  /** 再生開始からの経過秒。停止中は 0。 */
  get time(): number {
    if (!this.playing || !this.ctx) return 0;
    return this.ctx.currentTime - this.startedAt;
  }
}
