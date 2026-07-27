import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Health } from './api';
import type { BackgroundMode, EmotionName, Speaker, VrmModel } from './types';

/**
 * 設定は localStorage に保存し、次回起動時に復元する (docs T017 の軽量版)。
 * 話者一覧や疎通状態のような実行時の値は保存しない。
 */

/** キャラクターごとに覚えておく設定。 */
export interface CharacterProfile {
  speakerId: number;
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  /** VRM は身長も頭身もモデルごとに違うので、写りも一緒に覚える。 */
  cameraDistance: number;
  cameraHeight: number;
}

function snapshot(s: CharacterProfile): CharacterProfile {
  return {
    speakerId: s.speakerId,
    speedScale: s.speedScale,
    pitchScale: s.pitchScale,
    intonationScale: s.intonationScale,
    volumeScale: s.volumeScale,
    cameraDistance: s.cameraDistance,
    cameraHeight: s.cameraHeight,
  };
}

interface State {
  // --- 保存する設定 ---
  speakerId: number;
  text: string;
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;

  modelUrl: string;
  background: BackgroundMode;
  backgroundColor: string;
  cameraDistance: number;
  cameraHeight: number;

  breath: boolean;
  blink: boolean;
  idle: boolean;
  autoNod: boolean;
  /** 文末や句切れに合わせて仕草を自動で出す */
  autoGesture: boolean;
  /** 声の高さに合わせて頭と体を動かす */
  prosody: boolean;
  /** 沈黙中のさりげない仕草 */
  behavior: boolean;
  emotion: EmotionName;
  /** Stage が繋がっている間は Editor 側の音を止める(同じ音が二重に鳴るのを避ける)。 */
  muteWhenStage: boolean;

  // --- 実行時のみ ---
  speakers: Speaker[];
  models: VrmModel[];
  health: Health | null;
  busy: boolean;
  error: string | null;
  stageConnected: boolean;

  /** モデル URL → そのキャラの設定。 */
  profiles: Record<string, CharacterProfile>;

  set: <K extends keyof State>(key: K, value: State[K]) => void;
  patch: (values: Partial<State>) => void;
  /** モデルを切り替える。声とカメラの保存・復元もここで行う。 */
  selectModel: (url: string) => void;
}

export const DEFAULT_MODEL_URL = '/models/default.vrm';

/**
 * Stage は設定を保存しない。
 *
 * Stage を同じブラウザの別ウィンドウで開くと localStorage を Editor と共有するため、
 * Stage 側が受け取った状態 (?bg=alpha など) を書き戻すと Editor の設定を上書きしてしまう。
 * Stage の状態は常に URL と Editor からの配信で決まるので、保存する必要もない。
 */
const isStage = typeof location !== 'undefined' && location.pathname.startsWith('/stage');

const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useStore = create<State>()(
  persist(
    (set) => ({
      speakerId: 3, // ずんだもん(ノーマル)。存在しなければ話者取得後に先頭へ寄せる。
      text: 'こんにちは。EGAGO VRM です。すべての絵には、愛があります。',
      speedScale: 1.0,
      pitchScale: 0.0,
      intonationScale: 1.0,
      volumeScale: 1.0,

      modelUrl: DEFAULT_MODEL_URL,
      background: 'color',
      backgroundColor: '#1b1d24',
      cameraDistance: 1.6,
      cameraHeight: 0,

      breath: true,
      blink: true,
      idle: true,
      autoNod: true,
      autoGesture: true,
      prosody: true,
      behavior: true,
      emotion: 'neutral',
      muteWhenStage: true,

      speakers: [],
      models: [],
      health: null,
      busy: false,
      error: null,
      stageConnected: false,

      profiles: {},

      set: (key, value) => set({ [key]: value } as unknown as Partial<State>),
      patch: (values) => set(values as Partial<State>),

      selectModel: (url) =>
        set((s) => {
          if (url === s.modelUrl) return {};

          // 旧モデルの設定を保存しつつ、新モデルの設定を同じ更新で適用する。
          // 2 回に分けると、間の一瞬だけ「新モデル + 旧モデルの声」の状態ができてしまい、
          // そこで保存が走ると新モデルの設定を潰してしまう。
          const profiles = { ...s.profiles, [s.modelUrl]: snapshot(s) };
          // 未登録のキャラは今の設定を引き継いで登録する
          const next = profiles[url] ?? snapshot(s);
          profiles[url] = next;

          return { profiles, modelUrl: url, ...next };
        }),
    }),
    {
      name: 'egago-vrm',
      storage: createJSONStorage(() => (isStage ? noopStorage : localStorage)),
      partialize: (s) => ({
        speakerId: s.speakerId,
        text: s.text,
        speedScale: s.speedScale,
        pitchScale: s.pitchScale,
        intonationScale: s.intonationScale,
        volumeScale: s.volumeScale,
        modelUrl: s.modelUrl,
        background: s.background,
        backgroundColor: s.backgroundColor,
        cameraDistance: s.cameraDistance,
        cameraHeight: s.cameraHeight,
        breath: s.breath,
        blink: s.blink,
        idle: s.idle,
        autoNod: s.autoNod,
        autoGesture: s.autoGesture,
        prosody: s.prosody,
        behavior: s.behavior,
        emotion: s.emotion,
        muteWhenStage: s.muteWhenStage,
        profiles: s.profiles,
      }),
    },
  ),
);
