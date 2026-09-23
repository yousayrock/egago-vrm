import type { PhraseTiming } from './speechTimeline';

/**
 * 文とその発話時刻の対応づけ。
 *
 * 自動ジェスチャー (文末の仕草) と自動表情 (文ごとの感情) の両方が使う。
 * 別々に区切ると仕草と表情が違う文を見てしまうため、1 箇所にまとめてある。
 */

/** 文末の記号を残したまま文に分割する。 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。．.!?！？…])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SentenceRange {
  /** 原文の 1 文 (文末記号を含む)。 */
  text: string;
  /** 発声の開始秒。 */
  start: number;
  /** 発声の終わり秒 (末尾のポーズは含まない)。 */
  end: number;
  /** 文の終わりにあたるアクセント句の位置。 */
  endPhrase: number;
}

/** VOICEVOX が文中でも息継ぎ (pause_mora) を入れる記号。 */
const INNER_PAUSE_MARKS = /[、，,]/g;

/**
 * 文を発話時刻に対応づける。
 *
 * VOICEVOX は句読点の位置に pause_mora を入れるので、
 * 「息継ぎのあるアクセント句 + 最後の句」が切れ目の候補になる。
 *
 * ただし切れ目は句点だけでなく **読点にも立つ**。
 * 文と切れ目を順番どおり 1 対 1 で当てると、読点のある文の次から丸ごとずれてしまう
 * (「今日は、とても嬉しい。でも…」で 2 文目が最初の読点から始まってしまう)。
 * そこで文中の読点の数だけ切れ目を読み飛ばし、文末の切れ目に合わせる。
 */
export function sentenceRanges(text: string, phrases: PhraseTiming[]): SentenceRange[] {
  if (!phrases.length) return [];

  const boundaries: number[] = [];
  phrases.forEach((p, i) => {
    if (p.hasPause || i === phrases.length - 1) boundaries.push(i);
  });

  const ranges: SentenceRange[] = [];
  let cursor = 0; // 次に見る boundaries の位置
  let from = 0; // この文が始まるアクセント句

  for (const sentence of splitSentences(text)) {
    if (cursor >= boundaries.length || from >= phrases.length) break;

    const inner = (sentence.match(INNER_PAUSE_MARKS) ?? []).length;
    cursor = Math.min(cursor + inner, boundaries.length - 1);
    const endPhrase = boundaries[cursor];
    cursor++;

    ranges.push({
      text: sentence,
      start: phrases[from].start,
      end: phrases[endPhrase].end,
      endPhrase,
    });
    from = endPhrase + 1;
  }

  return ranges;
}
