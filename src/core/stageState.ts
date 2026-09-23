import { useStore } from './store';

/** 同期項目と変更検知を同じ定義から作り、送信漏れを防ぐ。 */
export const stageStateKeys = [
  'modelUrl', 'characterMode', 'characters', 'selectedCharacterId',
  'background', 'backgroundColor', 'backgroundImage',
  'cameraDistance', 'cameraHeight', 'emotion',
  'breath', 'blink', 'idle', 'prosody', 'behavior', 'autoNod', 'autoGesture', 'autoEmotion',
] as const;

export type StageState = Pick<ReturnType<typeof useStore.getState>, typeof stageStateKeys[number]>;

export function currentStageState(): StageState {
  const state = useStore.getState();
  return Object.fromEntries(stageStateKeys.map((key) => [key, state[key]])) as StageState;
}

export function forcedBackground(value: string | null) {
  return value === 'alpha' || value === 'green' || value === 'color' ? value : null;
}
