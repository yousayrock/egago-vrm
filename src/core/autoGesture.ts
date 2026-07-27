import type { PhraseTiming } from './speechTimeline';
import type { GestureName } from './types';

/**
 * 発話に合わせた自動ジェスチャー (docs T013 の自動化)。
 *
 * 2 つの層で仕草を決める。
 *
 *   1. 語彙   … 「こんにちは」で手を振る、「ありがとう」でお辞儀する
 *   2. 文の形 … 「?」で首をかしげる、「!」で強くうなずく
 *
 * どちらも口パクと同じ時間軸に乗せるので、体と口がずれない。
 */

export interface GestureCue {
  time: number;
  gesture: GestureName;
  /** 動きの強さ。0.5 なら控えめ、1.2 ならやや大げさ。 */
  strength: number;
}

/**
 * 読みに対して仕草を割り当てる表。
 *
 * 原文ではなく VOICEVOX が出したモーラの読み (カタカナ) と突き合わせる。
 * 漢字の表記ゆれを気にせず済み、「こんにちは」→`コンニチワ` のように
 * 実際に発音される形で一致させられる。
 */
const KEYWORD_GESTURES: { readings: string[]; gesture: GestureName; strength: number }[] = [
  {
    // 挨拶と別れ
    // VOICEVOX は長音を「オ」で出す (ありがとう -> アリガトオ)。実測に合わせて候補を並べる。
    readings: [
      'コンニチワ',
      'コンバンワ',
      'オハヨオ',
      'オハヨー',
      'オハヨウ',
      'ハジメマシテ',
      'バイバイ',
      'マタネ',
      'マタアシタ',
      'サヨオナラ',
      'サヨウナラ',
      'サヨナラ',
      'ヤッホー',
      'イラッシャイ',
    ],
    gesture: 'wave',
    strength: 1,
  },
  {
    // 感謝と謝罪
    readings: [
      'アリガト', // アリガトオ / アリガトウ / アリガトー をまとめて拾う
      'スミマセン',
      'ゴメンナサイ',
      'ゴメン',
      'モオシワケ',
      'モウシワケ',
      'ヨロシク',
      'シツレイシマス',
      'オネガイシマス',
    ],
    gesture: 'bow',
    strength: 1,
  },
  {
    // 驚き
    readings: ['ビックリ', 'マサカ', 'ウソオ', 'ウソー', 'エエッ', 'スゴイ', 'スゴーイ', 'オドロキ'],
    gesture: 'surprise',
    strength: 0.9,
  },
  {
    // 同意・相槌
    readings: ['ナルホド', 'ソオデスネ', 'ソオナンデス', 'ワカリマシタ', 'モチロン', 'タシカニ'],
    gesture: 'nod',
    strength: 0.85,
  },
  {
    // 疑問・思案
    readings: ['ドオシテ', 'ナゼ', 'フシギ', 'ナンダロオ', 'ドオカナ', 'ドオシヨオ', 'ホントニ'],
    gesture: 'tilt',
    strength: 0.75,
  },
];

/** 全身を使う大きな仕草。連発すると落ち着きが無くなるので間隔を空ける。 */
const BIG_GESTURES = new Set<GestureName>(['wave', 'bow', 'surprise']);

type Ending = 'question' | 'exclaim' | 'period' | 'none';

function endingOf(sentence: string): Ending {
  const last = sentence.trim().slice(-1);
  if (last === '?' || last === '？') return 'question';
  if (last === '!' || last === '！') return 'exclaim';
  if (last === '。' || last === '．' || last === '.') return 'period';
  return 'none';
}

/** 文末の記号を残したまま文に分割する。 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。．.!?！？…])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** ±ratio の範囲でゆらぎを与える。機械的な等間隔を避けるため。 */
function jitter(v: number, ratio: number): number {
  return v * (1 + (Math.random() * 2 - 1) * ratio);
}

/**
 * 読みの中からキーワードを探し、その語が鳴り始める時刻に仕草を置く。
 * 同じ語が何度も出てもうるさくならないよう、大きい仕草は間隔と回数を制限する。
 */
function keywordCues(reading: string, readingTime: number[]): GestureCue[] {
  const found: GestureCue[] = [];

  for (const entry of KEYWORD_GESTURES) {
    for (const word of entry.readings) {
      let from = 0;
      for (;;) {
        const at = reading.indexOf(word, from);
        if (at < 0) break;
        found.push({
          time: readingTime[at] ?? 0,
          gesture: entry.gesture,
          strength: jitter(entry.strength, 0.12),
        });
        from = at + word.length;
      }
    }
  }

  found.sort((a, b) => a.time - b.time);

  // 大きい仕草は 2 秒以上あける。回数は制限しない。
  // 「挨拶 → 感謝 → 別れ」のように意味のある語が並ぶ発話では、
  // 上限を設けると後半の別れの挨拶が丸ごと落ちてしまうため。
  const kept: GestureCue[] = [];
  let lastBigTime = -Infinity;

  for (const cue of found) {
    const isBig = BIG_GESTURES.has(cue.gesture);
    if (isBig) {
      if (cue.time - lastBigTime < 2) continue;
      lastBigTime = cue.time;
      kept.push(cue);
    } else {
      const last = kept[kept.length - 1];
      if (last && cue.time - last.time < 0.8) continue;
      kept.push(cue);
    }
  }

  return kept;
}

/**
 * @param text     発話テキスト (文末記号から文の形を見る)
 * @param phrases  speechTimeline が出したアクセント句の区間
 * @param reading  モーラの読みをつなげたカタカナ列
 * @param readingTime reading の文字位置ごとの開始秒
 */
export function buildGestureCues(
  text: string,
  phrases: PhraseTiming[],
  reading = '',
  readingTime: number[] = [],
): GestureCue[] {
  if (!phrases.length) return [];

  // --- 1. 語彙による仕草。意味を持つのでこちらを優先する ---
  const keyword = keywordCues(reading, readingTime);
  const conflicts = (time: number) => keyword.some((k) => Math.abs(k.time - time) < 0.9);

  const cues: GestureCue[] = [];

  // --- 2. 文の形による仕草 ---
  // 息継ぎのある句 + 最後の句が「文の切れ目」の候補になる。
  // VOICEVOX は句読点の位置に pause_mora を入れるので、これが文の区切りとほぼ一致する。
  const boundaries: number[] = [];
  phrases.forEach((p, i) => {
    if (p.hasPause || i === phrases.length - 1) boundaries.push(i);
  });

  const sentences = splitSentences(text);
  const pairCount = Math.min(sentences.length, boundaries.length);
  const usedBoundaries = new Set<number>();

  for (let i = 0; i < pairCount; i++) {
    const phrase = phrases[boundaries[i]];
    usedBoundaries.add(boundaries[i]);

    let cue: GestureCue | null = null;
    switch (endingOf(sentences[i])) {
      case 'question':
        // 語尾が上がりきる少し前に首をかしげ始めると「問いかけ」に見える
        cue = {
          time: Math.max(0, phrase.end - 0.55),
          gesture: 'tilt',
          strength: jitter(0.9, 0.15),
        };
        break;
      case 'exclaim':
        cue = {
          time: Math.max(0, phrase.end - 0.35),
          gesture: 'nod',
          strength: jitter(1.25, 0.12),
        };
        break;
      case 'period':
        // 言い切りに軽くうなずきを添える
        cue = {
          time: Math.max(0, phrase.end - 0.25),
          gesture: 'nod',
          strength: jitter(0.6, 0.2),
        };
        break;
      case 'none':
        break;
    }
    if (cue && !conflicts(cue.time)) cues.push(cue);
  }

  // 文の切れ目以外の息継ぎでも、時々small nodを入れて棒読み感を消す
  phrases.forEach((p, i) => {
    if (!p.hasPause || usedBoundaries.has(i)) return;
    if (Math.random() > 0.35) return;
    const time = p.end - 0.15;
    if (!conflicts(time)) {
      cues.push({ time, gesture: 'nod', strength: jitter(0.4, 0.25) });
    }
  });

  cues.sort((a, b) => a.time - b.time);

  // 長く動きがない区間に相槌を足す。3 秒以上棒立ちだと不自然に見える。
  const filled: GestureCue[] = [];
  let previous = 0;
  const total = phrases[phrases.length - 1].pauseEnd;

  const addFiller = (until: number) => {
    while (until - previous > 3) {
      previous += jitter(2.2, 0.2);
      if (until - previous < 0.6) break;
      if (!conflicts(previous)) {
        filled.push({ time: previous, gesture: 'nod', strength: jitter(0.35, 0.3) });
      }
    }
  };

  for (const cue of cues) {
    addFiller(cue.time);
    filled.push(cue);
    previous = cue.time;
  }
  addFiller(total);

  // 語彙由来と合流させ、近すぎるものを間引く
  return [...keyword, ...filled]
    .sort((a, b) => a.time - b.time)
    .filter((c, i, arr) => i === 0 || c.time - arr[i - 1].time > 0.45);
}
