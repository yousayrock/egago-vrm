/** VOICEVOX の AudioQuery のうち、こちらが実際に読む部分だけを型にしたもの。 */
export interface Mora {
  text: string;
  consonant: string | null;
  consonant_length: number | null;
  vowel: string;
  vowel_length: number;
  pitch: number;
}

export interface AccentPhrase {
  moras: Mora[];
  accent: number;
  pause_mora: Mora | null;
}

export interface AudioQuery {
  accent_phrases: AccentPhrase[];
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  outputSamplingRate: number;
}

export interface SpeakerStyle {
  id: number;
  name: string;
  type: string;
}

export interface Speaker {
  name: string;
  uuid: string;
  styles: SpeakerStyle[];
}

/** VRM 1.0 のプリセット表情のうち感情として扱うもの。 */
export type EmotionName = 'neutral' | 'happy' | 'angry' | 'sad' | 'relaxed' | 'surprised';

export const EMOTIONS: EmotionName[] = [
  'neutral',
  'happy',
  'angry',
  'sad',
  'relaxed',
  'surprised',
];

export const EMOTION_LABELS: Record<EmotionName, string> = {
  neutral: '通常',
  happy: '喜び',
  angry: '怒り',
  sad: '悲しみ',
  relaxed: '安らぎ',
  surprised: '驚き',
};

export type GestureName = 'nod' | 'tilt' | 'wave' | 'surprise' | 'bow';

export const GESTURE_LABELS: Record<GestureName, string> = {
  nod: 'うなずき',
  tilt: '首かしげ',
  wave: '手を振る',
  surprise: '驚く',
  bow: 'お辞儀',
};

export type BackgroundMode = 'alpha' | 'green' | 'color' | 'image';

export type CharacterMode = 'image' | 'vrm';

export interface StageCharacter {
  id: string;
  name: string;
  voiceId?: string;
  characterKey?: string;
  x: number;
  height: number;
  depth: number;
  scale: number;
  rotation: number;
  facing: 1 | -1;
}

export interface ScriptLine {
  id: string;
  characterId: string;
  text: string;
}

export type SpeechProviderMode = 'voicevox' | 'moss';

export interface VoiceProfile {
  id: string;
  name: string;
  format: string;
  model: string;
  codec: string;
  content_hash: string;
}

export interface SpeechResult {
  audio: string;
  /** VOICEVOX だけが正確なモーラ時刻を持つ。MOSS では省略する。 */
  query?: AudioQuery;
}

export interface SpeechJob {
  id: string;
  status: 'queued' | 'loading' | 'generating' | 'ready' | 'failed' | 'cancelled';
  error: string | null;
  voiceId: string;
  cacheKey: string;
}

/** 口の形。VRM の口関連プリセット表情に 1:1 で対応する。 */
export type Viseme = 'aa' | 'ih' | 'ou' | 'ee' | 'oh';

export interface VrmModel {
  name: string;
  url: string;
}
