import type { EmotionName } from './types';

/** 2D キャラの表情差分。EmotionName に加えて blink と banzai(仕草用)を持つ。 */
export type CharacterAssetImages = Record<EmotionName, string> & {
  blink: string;
  banzai: string;
};

export interface CharacterAsset {
  id: string;
  label: string;
  images: CharacterAssetImages;
}

export const CHARACTER_ASSETS: CharacterAsset[] = [
  {
    id: 'eriru',
    label: 'エリルたそ',
    images: {
      neutral: '/characters/eriru-neutral.png',
      happy: '/characters/eriru-happy.png',
      angry: '/characters/eriru-angry.png',
      sad: '/characters/eriru-sad.png',
      relaxed: '/characters/eriru-relaxed.png',
      surprised: '/characters/eriru-surprised.png',
      blink: '/characters/eriru-blink.png',
      banzai: '/characters/eriru-banzai.png',
    },
  },
  {
    id: 'tom',
    label: 'トム',
    images: {
      neutral: '/characters/tom-neutral.png',
      happy: '/characters/tom-happy.png',
      angry: '/characters/tom-angry.png',
      sad: '/characters/tom-sad.png',
      relaxed: '/characters/tom-relaxed.png',
      surprised: '/characters/tom-surprised.png',
      blink: '/characters/tom-blink.png',
      banzai: '/characters/tom-banzai.png',
    },
  },
];

export const DEFAULT_CHARACTER_ASSET_ID = CHARACTER_ASSETS[0].id;

export function getCharacterAsset(id: string): CharacterAsset {
  return CHARACTER_ASSETS.find((asset) => asset.id === id) ?? CHARACTER_ASSETS[0];
}
