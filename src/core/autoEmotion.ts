import type { PhraseTiming } from './speechTimeline';
import { sentenceRanges } from './sentenceTiming';
import type { EmotionName } from './types';

/**
 * セリフの内容に合わせた自動表情。
 *
 * 仕草 (autoGesture) が「その語が鳴った瞬間」に一発だけ出すのに対して、
 * 表情は出しっぱなしになるので **文単位** で決める。
 * 「今日は嬉しい。でも少し不安かな。」なら前半が喜び、後半が悲しみに変わる。
 *
 * 照合は原文ではなく、AudioQuery のモーラから組み立てた読みのカタカナ列で行う。
 * 漢字の表記ゆれ (嬉しい / うれしい / ウレシイ) を気にせず済み、
 * 1 文字ずつ時刻が分かるので文の区間だけを切り出せる。
 */

export interface EmotionCue {
  time: number;
  /** null は「手動で選ばれている感情に戻す」。感情語の無い文で使う。 */
  emotion: EmotionName | null;
  intensity: number;
}

/** 表情は 0.3 秒かけてフェードするので、少し先に出し始めると声と揃う。 */
const LEAD = 0.15;

/**
 * 読み → 感情の表。
 *
 * 活用を拾うため語幹だけを載せている (ウレシ で「嬉しい」「嬉しかった」「嬉しくて」に当たる)。
 * VOICEVOX は長音を母音で出す (最高 -> サイコオ) ので、実測に合わせて候補を並べる。
 */
const EMOTION_WORDS: { readings: string[]; emotion: EmotionName; weight: number }[] = [
  {
    readings: [
      'ウレシ',
      'タノシ',
      'ヨカッタ',
      'サイコオ',
      'サイコー',
      'サイコウ',
      'ダイスキ',
      'シアワセ',
      'ヤッタ',
      'オメデト',
      'スバラシ',
      'タノシミ',
      'ワクワク',
      'ニコニコ',
      'キゲンガイイ',
      'ラッキー',
      'マンゾク',
    ],
    emotion: 'happy',
    weight: 1,
  },
  {
    readings: [
      'カナシ',
      'サビシ',
      'サミシ',
      'ツラ',
      'ザンネン',
      'シンパイ',
      'フアン',
      'ナミダ',
      'クヤシ',
      'ショック',
      'ガッカリ',
      'サイアク',
      'クルシ',
      'オチコ',
      'ゴメン',
    ],
    emotion: 'sad',
    weight: 1,
  },
  {
    readings: [
      'ムカツ',
      'ハラガタツ',
      'ユルセナイ',
      'フザケ',
      'イライラ',
      'ヒドイ',
      'サイテー',
      'サイテエ',
      'ナットクデキナイ',
      'カンベンシテ',
      'オコッテ',
      'ゲキオコ',
    ],
    emotion: 'angry',
    weight: 1,
  },
  {
    readings: [
      'ビックリ',
      'オドロ',
      'マサカ',
      'ウソオ',
      'ウソー',
      'エエッ',
      'ナント',
      'シンジラレナイ',
      'スゴイ',
      'スゴーイ',
      'ヤバイ',
    ],
    emotion: 'surprised',
    weight: 1,
  },
  {
    readings: [
      'アンシン',
      'オチツ',
      'ノンビリ',
      'ユッタリ',
      'ヤスラ',
      'ダイジョオブ',
      'ダイジョウブ',
      'オダヤカ',
      'ホットシ',
      'ヘイキ',
      'ユックリ',
    ],
    emotion: 'relaxed',
    weight: 1,
  },
];

/** 強調語。当たると表情を強めに出す。 */
const INTENSIFIERS = ['トテモ', 'スゴク', 'メチャ', 'チョー', 'カナリ', 'ヒジョオニ', 'マジ', 'ホンキ'];

/**
 * 直後に打ち消しが来ていないか見る。
 *
 * 「嬉しくない」(ウレシクナイ) を喜びと取ると逆の表情になってしまう。
 * 語幹の直後 5 文字だけを見る簡易判定。
 * 「許せない」のように打ち消しを含んで初めて意味を持つ語は、
 * 表側に活用ごと載せてあるのでここには引っかからない。
 */
function isNegated(reading: string, after: number): boolean {
  return /ナイ|ナカ|ナク|マセン/.test(reading.slice(after, after + 5));
}

/** 読みのカタカナ列から、指定した時間の区間ぶんだけ切り出す。 */
function readingSlice(
  reading: string,
  readingTime: number[],
  start: number,
  end: number,
): string {
  let a = 0;
  while (a < reading.length && (readingTime[a] ?? 0) < start) a++;
  let b = a;
  while (b < reading.length && (readingTime[b] ?? 0) < end) b++;
  return reading.slice(a, b);
}

/**
 * 1 文ぶんの読みから感情を決める。
 * 感情語が無ければ null を返し、呼び出し側で手動指定の感情に戻す。
 */
function scoreSentence(
  slice: string,
  text: string,
): { emotion: EmotionName | null; intensity: number } {
  const scores = new Map<EmotionName, number>();

  for (const entry of EMOTION_WORDS) {
    for (const word of entry.readings) {
      let from = 0;
      for (;;) {
        const at = slice.indexOf(word, from);
        if (at < 0) break;
        from = at + word.length;
        if (isNegated(slice, from)) continue;
        scores.set(entry.emotion, (scores.get(entry.emotion) ?? 0) + entry.weight);
      }
    }
  }

  if (!scores.size) return { emotion: null, intensity: 0 };

  // 同点なら表の並び順が先のものが残る (Map は挿入順)
  let best: EmotionName | null = null;
  let bestScore = 0;
  for (const [emotion, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = emotion;
    }
  }

  // 同じ感情の語が重なるほど強く出す。強調語と「!」も上乗せする。
  let intensity = 0.62 + Math.min(0.24, (bestScore - 1) * 0.12);
  if (INTENSIFIERS.some((w) => slice.includes(w))) intensity += 0.14;
  if (/[!！]/.test(text)) intensity += 0.1;

  return { emotion: best, intensity: Math.min(1, intensity) };
}

/**
 * @param text        発話テキスト (文の区切りと「!」を見る)
 * @param phrases     speechTimeline が出したアクセント句の区間
 * @param reading     モーラの読みをつなげたカタカナ列
 * @param readingTime reading の文字位置ごとの開始秒
 */
export function buildEmotionCues(
  text: string,
  phrases: PhraseTiming[],
  reading = '',
  readingTime: number[] = [],
): EmotionCue[] {
  const ranges = sentenceRanges(text, phrases);
  if (!ranges.length) return [];

  const cues: EmotionCue[] = [];
  // 発話前は手動指定の感情のまま = null 相当。
  // 最初の文に感情語が無ければ、そのまま何も出さない。
  let previous: EmotionName | null = null;

  for (const range of ranges) {
    const slice = readingSlice(reading, readingTime, range.start, range.end);
    const { emotion, intensity } = scoreSentence(slice, range.text);

    // 同じ感情が続く文では出し直さない。フェードが途中で巻き戻って見えるため。
    if (emotion === previous) continue;

    cues.push({ time: Math.max(0, range.start - LEAD), emotion, intensity });
    previous = emotion;
  }

  return cues;
}
