import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { applyRestPose, disposeVRM, loadVRMFromUrl } from '../vrm/VRMAdapter';
import { buildGestureCues, type GestureCue } from './autoGesture';
import { EmotionEngine } from './EmotionEngine';
import { ExpressionMixer } from './ExpressionMixer';
import { LipSyncEngine } from './LipSyncEngine';
import { MotionEngine } from './MotionEngine';
import { SpeechEngine } from './SpeechEngine';
import { buildSpeechTimeline } from './speechTimeline';
import type { AudioQuery, EmotionName, GestureName } from './types';

/**
 * docs/ARCHITECTURE.md の `Core` にあたる層。
 * 各エンジンを保持し、毎フレームの更新順序を一箇所で決める。
 */
export class CharacterEngine {
  readonly root = new THREE.Group();

  vrm: VRM | null = null;

  readonly mixer = new ExpressionMixer();
  readonly motion = new MotionEngine();
  readonly emotion = new EmotionEngine();
  readonly lipsync = new LipSyncEngine();
  readonly speech = new SpeechEngine();

  /** 発話の頭に軽くうなずきを入れる。 */
  autoNod = true;
  /** 文末や句切れに合わせて仕草を自動で出す。 */
  autoGesture = true;

  onModelChanged: ((vrm: VRM) => void) | null = null;

  /** setModel の競合対策。最後に要求されたものだけを採用する。 */
  private loadToken = 0;

  private lookAtTarget = new THREE.Object3D();
  private gazeBase = new THREE.Vector3(0, 1.4, 2);

  /** 自動ジェスチャーの予定表と、次に発火させる位置。 */
  private cues: GestureCue[] = [];
  private cueIndex = 0;
  /** speech.play より先に渡しておく発話テキスト。onStart で仕草の組み立てに使う。 */
  private pendingText = '';

  constructor() {
    this.root.add(this.lookAtTarget);

    this.speech.onStart = (query) => {
      // 口パク・抑揚・仕草をすべて同じタイムラインから作る
      const timeline = buildSpeechTimeline(query);
      this.lipsync.start(timeline.visemes);
      this.motion.startProsody(timeline.prosody);

      this.cues = this.autoGesture
        ? buildGestureCues(
            this.pendingText,
            timeline.phrases,
            timeline.reading,
            timeline.readingTime,
          )
        : [];
      this.cueIndex = 0;

      if (this.autoNod) this.motion.trigger('nod', 0.7);
    };

    this.speech.onEnd = () => {
      this.lipsync.stop();
      this.motion.stopProsody();
      this.cues = [];
      this.cueIndex = 0;
    };
  }

  async setModel(url: string): Promise<void> {
    const token = ++this.loadToken;
    const vrm = await loadVRMFromUrl(url);

    if (token !== this.loadToken) {
      // 読み込み中にさらに切り替えられていた。今回の結果は捨てる。
      disposeVRM(vrm);
      return;
    }

    if (this.vrm) {
      this.root.remove(this.vrm.scene);
      disposeVRM(this.vrm);
    }

    this.vrm = vrm;
    this.root.add(vrm.scene);

    this.motion.capture(vrm, applyRestPose(vrm));
    this.mixer.setVrm(vrm);

    if (vrm.lookAt) vrm.lookAt.target = this.lookAtTarget;

    this.onModelChanged?.(vrm);
  }

  /** カメラの方を見させる。Viewer から毎フレーム渡す。 */
  setGazePoint(p: THREE.Vector3): void {
    this.gazeBase.copy(p);
  }

  async speak(audio: string, query: AudioQuery, text = ''): Promise<void> {
    this.pendingText = text;
    await this.speech.play(audio, query);
  }

  setEmotion(name: EmotionName, intensity = 1): void {
    this.emotion.set(name, intensity);
    // 表情だけでなく立ち姿も変える
    this.motion.setPosture(name);
  }

  gesture(name: GestureName): void {
    this.motion.trigger(name);
  }

  update(dt: number): void {
    const vrm = this.vrm;
    if (!vrm) return;

    const speechTime = this.speech.playing ? this.speech.time : null;

    // 1. 予定表に沿って仕草を発火させる
    if (speechTime !== null) {
      while (this.cueIndex < this.cues.length && speechTime >= this.cues[this.cueIndex].time) {
        const cue = this.cues[this.cueIndex++];
        this.motion.trigger(cue.gesture, cue.strength);
      }
    }

    // 2. ボーン(呼吸/Idle/姿勢/抑揚/仕草)と瞬きレイヤ
    this.motion.update(vrm, dt, this.mixer, speechTime);
    // 3. 感情レイヤ
    this.emotion.update(dt, this.mixer);
    // 4. 口パクレイヤ。基準時刻は AudioContext から取る。
    this.lipsync.update(dt, this.speech.time, this.mixer);
    // 5. 3 つのレイヤを合算して VRM に 1 度だけ書く
    this.mixer.apply(vrm);

    // 6. 視線。沈黙中の「目をそらす」ぶんをカメラ方向からずらす。
    this.lookAtTarget.position.set(
      this.gazeBase.x + this.motion.gazeOffset.x,
      this.gazeBase.y + this.motion.gazeOffset.y,
      this.gazeBase.z,
    );

    // 7. three-vrm 側の更新 (表情の反映・揺れもの・視線)
    vrm.update(dt);
  }

  dispose(): void {
    this.speech.stop();
    if (this.vrm) {
      this.root.remove(this.vrm.scene);
      disposeVRM(this.vrm);
      this.vrm = null;
    }
  }
}
