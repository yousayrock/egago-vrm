import type { VRM } from '@pixiv/three-vrm';
import type { ArmSign } from '../vrm/VRMAdapter';
import type { ExpressionMixer } from './ExpressionMixer';
import { sampleProsody, type ProsodySample } from './speechTimeline';
import type { EmotionName, GestureName } from './types';

/**
 * 体の動きすべて (docs T006-T008, T013)。
 *
 * ボーンは「基本姿勢 + 各要素の加算分」を毎フレーム絶対値で書き込む。
 * 差分を積み上げる方式にすると誤差が溜まって姿勢が崩れていくため。
 *
 * 加算する要素は 5 つ:
 *   呼吸 / Idle揺れ / 感情による姿勢 / 抑揚への追従 / ジェスチャー
 */

type BoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'upperChest'
  | 'neck'
  | 'head'
  | 'leftUpperArm'
  | 'leftLowerArm'
  | 'rightUpperArm'
  | 'rightLowerArm'
  | 'leftHand'
  | 'rightHand';

const BONES: BoneName[] = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'rightUpperArm',
  'rightLowerArm',
  'leftHand',
  'rightHand',
];

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

type PoseDelta = Partial<Record<BoneName, Partial<Vec3>>>;

/**
 * ジェスチャー 1 種類の定義。t は 0→1 の進行度。
 * arm は「腕を下ろす向き」の符号。腕を上げる動きはこれを反転させて作る。
 */
interface Gesture {
  duration: number;
  pose: (t: number, arm: ArmSign) => PoseDelta;
}

/** 立ち上がりと収まりを滑らかにする山なりの包絡線。 */
const bell = (t: number) => Math.sin(Math.PI * t);

const GESTURES: Record<GestureName, Gesture> = {
  // 首を前に倒して戻す。rotation.x が負で下向き。
  nod: {
    duration: 0.75,
    pose: (t) => ({ head: { x: -0.32 * bell(t) }, neck: { x: -0.1 * bell(t) } }),
  },
  tilt: {
    duration: 1.1,
    pose: (t) => ({ head: { z: 0.3 * bell(t), y: 0.08 * bell(t) } }),
  },
  // 右腕を上げて肘を振る。基本姿勢の下ろした角度を打ち消す向きに回す。
  wave: {
    duration: 1.8,
    pose: (t, arm) => {
      const env = Math.min(1, bell(t) * 1.6);
      const s = -arm.right; // 腕を上げる向き
      const swing = Math.sin(t * Math.PI * 7);
      return {
        // 上腕はほとんど下ろしたまま。ここを上げると腕全体が横に張り出してしまう。
        // x は腕の長軸まわりのひねり。素体の手のひらは真下を向いているので、
        // これを入れないと手の側面だけが見えて「手刀」のようになる。
        rightUpperArm: { z: s * 0.3 * env, x: s * 1.2 * env },
        // 肘をほぼ直角に曲げ、前腕を立てて手を顔の横へ持ってくる。振り幅もここで作る。
        // x のひねりと合わせて手のひらがカメラを向く (実測で palmZ 0.88)。
        rightLowerArm: { z: s * (1.95 + swing * 0.3) * env, x: s * -1.6 * env },
        // 手首を少し遅らせて振ると、腕全体が棒で振れている感じが薄れる
        rightHand: { z: s * swing * 0.22 * env },
        head: { z: -0.05 * env },
      };
    },
  },
  surprise: {
    duration: 0.9,
    pose: (t, arm) => {
      const env = bell(t);
      return {
        head: { x: 0.22 * env },
        spine: { x: 0.12 * env },
        // 両腕をわずかに開く
        leftUpperArm: { z: -arm.left * 0.25 * env },
        rightUpperArm: { z: -arm.right * 0.25 * env },
      };
    },
  },
  bow: {
    duration: 1.6,
    pose: (t) => {
      // 前半で倒し後半で戻す。単純な山より「お辞儀」らしい溜めが出る。
      const env = t < 0.35 ? t / 0.35 : t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      const e = env * env * (3 - 2 * env);
      return { spine: { x: -0.45 * e }, chest: { x: -0.15 * e }, head: { x: -0.2 * e } };
    },
  },
};

/** 感情ごとの立ち姿と Idle の質。 */
interface Posture {
  pose: PoseDelta;
  /** Idle 揺れの振幅倍率 */
  idleScale: number;
  /** Idle 揺れの速さ倍率 */
  idleSpeed: number;
}

const POSTURES: Record<EmotionName, Posture> = {
  neutral: { pose: {}, idleScale: 1, idleSpeed: 1 },
  // 胸を張って顔が上がる。揺れも大きく速い。
  happy: {
    pose: { chest: { x: 0.05 }, spine: { x: 0.02 }, head: { x: 0.04 } },
    idleScale: 1.35,
    idleSpeed: 1.25,
  },
  // 首を落として身構える。動きは小さく硬い。
  angry: {
    pose: { chest: { x: -0.04 }, neck: { x: 0.04 }, head: { x: -0.07 } },
    idleScale: 0.75,
    idleSpeed: 1.4,
  },
  // うつむいて背中が丸まる。ほとんど動かない。
  sad: {
    pose: { chest: { x: -0.09 }, spine: { x: -0.05 }, head: { x: -0.14 } },
    idleScale: 0.5,
    idleSpeed: 0.7,
  },
  relaxed: {
    pose: { chest: { x: 0.02 }, head: { x: 0.01 } },
    idleScale: 1.1,
    idleSpeed: 0.7,
  },
  surprised: {
    pose: { chest: { x: 0.06 }, spine: { x: 0.03 }, head: { x: 0.08 } },
    idleScale: 1.2,
    idleSpeed: 1.3,
  },
};

interface ActiveGesture {
  def: Gesture;
  elapsed: number;
  strength: number;
}

/** 沈黙中に挟む仕草。 */
type BehaviorKind = 'lookAway' | 'glance' | 'weightShift' | 'microTilt';

const BEHAVIORS: BehaviorKind[] = ['lookAway', 'glance', 'weightShift', 'microTilt'];

export class MotionEngine {
  private restRotation = new Map<BoneName, Vec3>();
  private restHipsY = 0;
  private armSign: ArmSign = { left: 1, right: -1 };

  private time = 0;
  /** Idle 専用の時計。感情で速さが変わっても位相が飛ばないよう別に持つ。 */
  private idleTime = 0;

  private blinkTimer = 0;
  private nextBlinkAt = 2;
  private blinkValue = 0;
  private blinkPhase: 'idle' | 'closing' | 'opening' = 'idle';
  private blinkPhaseTime = 0;
  private pendingDoubleBlink = false;

  private active: ActiveGesture[] = [];

  // --- 感情による姿勢 ---
  private posture: EmotionName = 'neutral';
  private postureCurrent = new Map<string, number>(); // "bone.axis" -> 角度
  private idleScale = 1;
  private idleSpeed = 1;

  // --- 抑揚追従 ---
  private prosody: ProsodySample[] | null = null;
  private prosodyValue = 0;

  // --- 沈黙中の仕草 ---
  private behaviorWait = 4;
  private behaviorRemaining = 0;
  private gazeTarget = { x: 0, y: 0 };
  private weightTarget = 0;
  private tiltTarget = 0;
  /** 視線のずらし量。CharacterEngine が注視点に足す。 */
  readonly gazeOffset = { x: 0, y: 0 };
  private weightCurrent = 0;
  private tiltCurrent = 0;

  enabled = { breath: true, blink: true, idle: true, prosody: true, behavior: true };

  /** 基本姿勢を適用した直後に呼ぶ。以降はこの姿勢を原点として加算する。 */
  capture(vrm: VRM, armSign: ArmSign): void {
    this.armSign = armSign;
    this.restRotation.clear();
    for (const name of BONES) {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (node) {
        this.restRotation.set(name, { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z });
      }
    }
    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    this.restHipsY = hips ? hips.position.y : 0;
    this.active = [];
  }

  trigger(name: GestureName, strength = 1): void {
    const def = GESTURES[name];
    if (!def) return;
    // 同じジェスチャーを連打されたら重ねずに take over する
    this.active = this.active.filter((g) => g.def !== def);
    this.active.push({ def, elapsed: 0, strength });
  }

  /** 感情に合わせた立ち姿へ移行する。切り替えは滑らかに補間される。 */
  setPosture(emotion: EmotionName): void {
    this.posture = emotion;
  }

  startProsody(samples: ProsodySample[]): void {
    this.prosody = samples;
  }

  stopProsody(): void {
    this.prosody = null;
  }

  /**
   * @param speechTime 発話中なら再生経過秒、そうでなければ null
   */
  update(vrm: VRM, dt: number, mixer: ExpressionMixer, speechTime: number | null): void {
    this.time += dt;
    this.idleTime += dt * this.idleSpeed;

    const delta: PoseDelta = {};
    const add = (bone: BoneName, axis: keyof Vec3, v: number) => {
      const cur = (delta[bone] ??= {});
      cur[axis] = (cur[axis] ?? 0) + v;
    };

    this.updatePosture(dt, add);
    if (this.enabled.breath) this.applyBreath(add);
    if (this.enabled.idle) this.applyIdle(add);
    this.updateProsody(dt, speechTime, add);
    this.updateBehaviors(dt, speechTime !== null, add);

    // ジェスチャーは他のすべての上に重ねる
    for (const g of this.active) {
      g.elapsed += dt;
      const t = Math.min(1, g.elapsed / g.def.duration);
      const posed = g.def.pose(t, this.armSign);
      for (const [bone, axes] of Object.entries(posed) as [BoneName, Partial<Vec3>][]) {
        for (const [axis, v] of Object.entries(axes) as [keyof Vec3, number][]) {
          add(bone, axis, v * g.strength);
        }
      }
    }
    this.active = this.active.filter((g) => g.elapsed < g.def.duration);

    this.writePose(vrm, delta);
    this.updateBlink(dt, mixer);
  }

  /** 感情ごとの姿勢へゆっくり移行する。急に切り替えると人形が差し替わったように見える。 */
  private updatePosture(dt: number, add: (b: BoneName, a: keyof Vec3, v: number) => void): void {
    const target = POSTURES[this.posture];
    const k = 1 - Math.exp(-dt / 0.35);

    const targetFlat = new Map<string, number>();
    for (const [bone, axes] of Object.entries(target.pose) as [BoneName, Partial<Vec3>][]) {
      for (const [axis, v] of Object.entries(axes) as [keyof Vec3, number][]) {
        targetFlat.set(`${bone}.${axis}`, v);
      }
    }

    // 現在値と目標値のどちらかに現れる軸をすべて補間する。
    // 目標に無い軸も 0 に向かって戻す必要がある。
    for (const key of new Set([...this.postureCurrent.keys(), ...targetFlat.keys()])) {
      const goal = targetFlat.get(key) ?? 0;
      const cur = (this.postureCurrent.get(key) ?? 0) + (goal - (this.postureCurrent.get(key) ?? 0)) * k;

      if (Math.abs(cur) < 1e-5 && goal === 0) {
        this.postureCurrent.delete(key);
        continue;
      }
      this.postureCurrent.set(key, cur);

      const [bone, axis] = key.split('.') as [BoneName, keyof Vec3];
      add(bone, axis, cur);
    }

    this.idleScale += (target.idleScale - this.idleScale) * k;
    this.idleSpeed += (target.idleSpeed - this.idleSpeed) * k;
  }

  private applyBreath(add: (b: BoneName, a: keyof Vec3, v: number) => void): void {
    // 4 秒に 1 回程度のゆっくりした呼吸
    const phase = this.time * 0.25 * Math.PI * 2;
    const breath = Math.sin(phase);
    add('chest', 'x', breath * 0.022);
    add('spine', 'x', breath * 0.012);
    add('upperChest', 'x', breath * 0.015);
    // 肩の上下は頭の位置に効くので、首で少し打ち消して顔の揺れを抑える
    add('neck', 'x', -breath * 0.012);
  }

  private applyIdle(add: (b: BoneName, a: keyof Vec3, v: number) => void): void {
    const t = this.idleTime;
    const s = this.idleScale;
    // 周期の違う sin を重ねて、ループ感の出ない緩い揺れにする
    add('hips', 'y', Math.sin(t * 0.31) * 0.03 * s);
    add('hips', 'z', Math.sin(t * 0.23) * 0.012 * s);
    add('spine', 'y', Math.sin(t * 0.19) * 0.02 * s);

    add('head', 'y', (Math.sin(t * 0.41) * 0.05 + Math.sin(t * 0.13) * 0.03) * s);
    add('head', 'x', Math.sin(t * 0.29) * 0.025 * s);
    add('head', 'z', Math.sin(t * 0.17) * 0.02 * s);

    add('leftUpperArm', 'z', this.armSign.left * Math.sin(t * 0.27) * 0.02 * s);
    add('rightUpperArm', 'z', this.armSign.right * Math.sin(t * 0.27) * 0.02 * s);
  }

  /**
   * 声の高さに合わせて頭と体をわずかに動かす。
   * 声が高くなると顔が上がり、低くなると下がる。話しているあいだの「生きている感じ」を作る。
   */
  private updateProsody(
    dt: number,
    speechTime: number | null,
    add: (b: BoneName, a: keyof Vec3, v: number) => void,
  ): void {
    const target =
      this.enabled.prosody && this.prosody && speechTime !== null
        ? sampleProsody(this.prosody, speechTime)
        : 0;

    // モーラ単位のギザギザをならす。速すぎると小刻みに震えて見える。
    this.prosodyValue += (target - this.prosodyValue) * (1 - Math.exp(-dt / 0.12));
    const v = this.prosodyValue;
    if (Math.abs(v) < 1e-4) return;

    add('head', 'x', v * 0.07);
    add('neck', 'x', v * 0.03);
    add('spine', 'x', v * 0.012);
    add('chest', 'x', v * 0.018);
  }

  /**
   * 沈黙中のさりげない仕草。
   * 何もしないと「電源の入った人形」に見えるので、たまに視線や重心を動かす。
   */
  private updateBehaviors(
    dt: number,
    speaking: boolean,
    add: (b: BoneName, a: keyof Vec3, v: number) => void,
  ): void {
    if (!this.enabled.behavior || speaking) {
      // 喋り始めたら仕草は畳んで、視線を正面に戻す
      this.gazeTarget.x = 0;
      this.gazeTarget.y = 0;
      this.tiltTarget = 0;
      this.behaviorRemaining = 0;
      this.behaviorWait = 3 + Math.random() * 4;
    } else if (this.behaviorRemaining > 0) {
      this.behaviorRemaining -= dt;
      if (this.behaviorRemaining <= 0) {
        // 視線と首は戻す。重心の移動だけは次の仕草まで残す方が自然。
        this.gazeTarget.x = 0;
        this.gazeTarget.y = 0;
        this.tiltTarget = 0;
        this.behaviorWait = 3.5 + Math.random() * 5;
      }
    } else {
      this.behaviorWait -= dt;
      if (this.behaviorWait <= 0) this.startBehavior();
    }

    const k = 1 - Math.exp(-dt / 0.45);
    this.gazeOffset.x += (this.gazeTarget.x - this.gazeOffset.x) * k;
    this.gazeOffset.y += (this.gazeTarget.y - this.gazeOffset.y) * k;
    this.weightCurrent += (this.weightTarget - this.weightCurrent) * (1 - Math.exp(-dt / 1.2));
    this.tiltCurrent += (this.tiltTarget - this.tiltCurrent) * k;

    // 重心移動は腰と背骨に出す
    add('hips', 'z', this.weightCurrent * 0.05);
    add('spine', 'z', this.weightCurrent * -0.02);
    add('head', 'z', this.weightCurrent * -0.015 + this.tiltCurrent);

    // 視線を動かすと頭もわずかについていく
    add('head', 'y', this.gazeOffset.x * 0.12);
    add('head', 'x', this.gazeOffset.y * 0.1);
  }

  private startBehavior(): void {
    const kind = BEHAVIORS[Math.floor(Math.random() * BEHAVIORS.length)];
    const sign = Math.random() < 0.5 ? -1 : 1;

    switch (kind) {
      case 'lookAway':
        this.gazeTarget.x = sign * (0.25 + Math.random() * 0.3);
        this.gazeTarget.y = (Math.random() - 0.5) * 0.25;
        this.behaviorRemaining = 1.2 + Math.random() * 1.4;
        break;
      case 'glance':
        // 一瞬だけ視線を振る
        this.gazeTarget.x = sign * (0.35 + Math.random() * 0.25);
        this.gazeTarget.y = 0.1;
        this.behaviorRemaining = 0.45 + Math.random() * 0.3;
        break;
      case 'weightShift':
        this.weightTarget = sign * (0.4 + Math.random() * 0.6);
        this.behaviorRemaining = 2 + Math.random() * 2;
        break;
      case 'microTilt':
        this.tiltTarget = sign * (0.04 + Math.random() * 0.05);
        this.behaviorRemaining = 1.4 + Math.random() * 1.2;
        break;
    }
  }

  private writePose(vrm: VRM, delta: PoseDelta): void {
    for (const name of BONES) {
      const rest = this.restRotation.get(name);
      if (!rest) continue;
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      if (!node) continue;
      const d = delta[name];
      node.rotation.set(rest.x + (d?.x ?? 0), rest.y + (d?.y ?? 0), rest.z + (d?.z ?? 0));
    }

    // 呼吸に合わせた重心の上下。回転だけだと胸郭が動いている感じが出ない。
    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    if (hips && this.enabled.breath) {
      hips.position.y = this.restHipsY + Math.sin(this.time * 0.25 * Math.PI * 2) * 0.004;
    }
  }

  private updateBlink(dt: number, mixer: ExpressionMixer): void {
    if (!this.enabled.blink) {
      mixer.set('blink', 'blink', 0);
      return;
    }

    const CLOSE = 0.07;
    const OPEN = 0.13;

    if (this.blinkPhase === 'idle') {
      this.blinkTimer += dt;
      if (this.blinkTimer >= this.nextBlinkAt) {
        this.blinkPhase = 'closing';
        this.blinkPhaseTime = 0;
        this.blinkTimer = 0;
      }
    } else {
      this.blinkPhaseTime += dt;
      if (this.blinkPhase === 'closing') {
        this.blinkValue = Math.min(1, this.blinkPhaseTime / CLOSE);
        if (this.blinkPhaseTime >= CLOSE) {
          this.blinkPhase = 'opening';
          this.blinkPhaseTime = 0;
        }
      } else {
        this.blinkValue = Math.max(0, 1 - this.blinkPhaseTime / OPEN);
        if (this.blinkPhaseTime >= OPEN) {
          this.blinkPhase = 'idle';
          this.blinkValue = 0;
          if (this.pendingDoubleBlink) {
            // 2 連瞬きの 2 回目はすぐ続ける
            this.pendingDoubleBlink = false;
            this.nextBlinkAt = 0.12;
          } else {
            this.scheduleNextBlink();
          }
        }
      }
    }

    mixer.set('blink', 'blink', this.blinkValue);
  }

  private scheduleNextBlink(): void {
    // 2〜6 秒のばらつき。等間隔だと機械的に見える。
    this.nextBlinkAt = 2 + Math.random() * 4;
    this.pendingDoubleBlink = Math.random() < 0.25;
  }

  static readonly gestureNames = Object.keys(GESTURES) as GestureName[];
}
