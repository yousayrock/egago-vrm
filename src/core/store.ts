import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Health } from './api';
import type { BackgroundMode, CharacterMode, EmotionName, ScriptLine, Speaker, SpeechProviderMode, StageCharacter, VoiceProfile, VrmModel } from './types';

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
  scriptLines: ScriptLine[];
  speechProvider: SpeechProviderMode;
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;

  modelUrl: string;
  characterMode: CharacterMode;
  characterImage: string;
  characters: StageCharacter[];
  selectedCharacterId: string;
  background: BackgroundMode;
  backgroundColor: string;
  backgroundImage: string;
  cameraDistance: number;
  cameraHeight: number;

  breath: boolean;
  blink: boolean;
  idle: boolean;
  autoNod: boolean;
  /** 文末や句切れに合わせて仕草を自動で出す */
  autoGesture: boolean;
  /** セリフの内容に合わせて表情を自動で変える */
  autoEmotion: boolean;
  /** 声の高さに合わせて頭と体を動かす */
  prosody: boolean;
  /** 沈黙中のさりげない仕草 */
  behavior: boolean;
  emotion: EmotionName;
  /** Stage が繋がっている間は Editor 側の音を止める(同じ音が二重に鳴るのを避ける)。 */
  muteWhenStage: boolean;

  // --- 実行時のみ ---
  speakers: Speaker[];
  voiceProfiles: VoiceProfile[];
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
const DEFAULT_STAGE_CHARACTERS: StageCharacter[] = [
  { id: 'eriru-1', name: 'エリルたそ 1', characterKey: 'eriru', x: 0, height: 0, depth: 0, scale: 1, rotation: 0, facing: 1 },
];

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
      scriptLines: [{ id: 'line-1', characterId: 'eriru-1', text: 'こんにちは。EGAGO VRM です。すべての絵には、愛があります。' }],
      speechProvider: 'voicevox',
      speedScale: 1.0,
      pitchScale: 0.0,
      intonationScale: 1.0,
      volumeScale: 1.0,

      modelUrl: DEFAULT_MODEL_URL,
      characterMode: 'image',
      characterImage: '/characters/eriru-default-transparent.png',
      characters: DEFAULT_STAGE_CHARACTERS,
      selectedCharacterId: 'eriru-1',
      background: 'alpha',
      backgroundColor: '#1b1d24',
      backgroundImage: '',
      cameraDistance: 1.6,
      cameraHeight: 0,

      breath: true,
      blink: true,
      idle: true,
      autoNod: true,
      autoGesture: true,
      autoEmotion: true,
      prosody: true,
      behavior: true,
      emotion: 'neutral',
      muteWhenStage: true,

      speakers: [],
      voiceProfiles: [],
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
      version: 5,
      storage: createJSONStorage(() => (isStage ? noopStorage : localStorage)),
      migrate: (persisted) => {
        const state = persisted as Partial<State>;
        return {
          ...state,
          ...(state.background === 'color' && state.backgroundColor === '#1b1d24'
            ? { background: 'alpha' as BackgroundMode }
            : {}),
          ...(state.characterImage === '/characters/eriru-default.png'
            ? { characterImage: '/characters/eriru-default-transparent.png' }
            : {}),
          ...(state.background === 'image' && !state.backgroundImage
            ? { background: 'alpha' as BackgroundMode }
            : {}),
          characters: Array.isArray(state.characters) && state.characters.length
            ? state.characters.map((character) => ({ ...character, depth: character.depth ?? 0, rotation: character.rotation ?? 0, facing: character.facing ?? 1 }))
            : DEFAULT_STAGE_CHARACTERS,
          selectedCharacterId: state.selectedCharacterId ?? DEFAULT_STAGE_CHARACTERS[0].id,
          scriptLines: Array.isArray(state.scriptLines) && state.scriptLines.length
            ? state.scriptLines
            : [{ id: 'line-1', characterId: state.selectedCharacterId ?? 'eriru-1', text: state.text ?? '' }],
          speechProvider: state.speechProvider === 'moss' ? 'moss' : 'voicevox',
        };
      },
      partialize: (s) => ({
        speakerId: s.speakerId,
        text: s.text,
        scriptLines: s.scriptLines,
        speechProvider: s.speechProvider,
        speedScale: s.speedScale,
        pitchScale: s.pitchScale,
        intonationScale: s.intonationScale,
        volumeScale: s.volumeScale,
        modelUrl: s.modelUrl,
        characterMode: s.characterMode,
        characterImage: s.characterImage,
        characters: s.characters,
        selectedCharacterId: s.selectedCharacterId,
        // ローカル画像は blob URL であり、再読み込み後は使えないため背景モードだけを透明へ戻す。
        background: s.background === 'image' ? 'alpha' : s.background,
        backgroundColor: s.backgroundColor,
        cameraDistance: s.cameraDistance,
        cameraHeight: s.cameraHeight,
        breath: s.breath,
        blink: s.blink,
        idle: s.idle,
        autoNod: s.autoNod,
        autoGesture: s.autoGesture,
        autoEmotion: s.autoEmotion,
        prosody: s.prosody,
        behavior: s.behavior,
        emotion: s.emotion,
        muteWhenStage: s.muteWhenStage,
        profiles: s.profiles,
      }),
    },
  ),
);
