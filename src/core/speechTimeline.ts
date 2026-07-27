import type { AudioQuery, Viseme } from './types';

/**
 * 発話タイムライン。
 *
 * 口パク・自動ジェスチャー・抑揚連動はすべてこの 1 本から作る。
 * それぞれが個別にモーラを走査すると時間の計算がずれて、
 * 口と体の動きが微妙に合わなくなるため。
 */

export interface VisemeSegment {
  start: number;
  end: number;
  viseme: Viseme | null; // null は閉口 (ん / っ / 無音)
  weight: number;
}

/** アクセント句 1 つぶんの区間。息継ぎの位置を知るのに使う。 */
export interface PhraseTiming {
  start: number;
  /** 発声の終わり (ポーズを含まない) */
  end: number;
  /** ポーズを含めた終わり */
  pauseEnd: number;
  hasPause: boolean;
}

/** 抑揚。pitch を -1..1 に正規化したもの。 */
export interface ProsodySample {
  time: number;
  value: number;
}

export interface SpeechTimeline {
  visemes: VisemeSegment[];
  phrases: PhraseTiming[];
  prosody: ProsodySample[];
  duration: number;
  /**
   * 全モーラの読みをつなげたカタカナ列。
   * 原文は漢字混じりで音声のどこに当たるか分からないが、こちらは 1 文字ずつ時刻が分かる。
   * 「こんにちは」が `コンニチワ` になるなど、実際に発音される形で並ぶ。
   */
  reading: string;
  /** reading の文字位置 → その文字が属するモーラの開始秒。 */
  readingTime: number[];
}

/** 母音 → 口形。'N'(ん) 'cl'(っ) 'pau'(無音) は口を閉じる。 */
const VOWEL_TO_VISEME: Record<string, Viseme | null> = {
  a: 'aa',
  i: 'ih',
  u: 'ou',
  e: 'ee',
  o: 'oh',
  N: null,
  cl: null,
  pau: null,
};

/** 母音ごとの口の開き具合。全部 1.0 にすると「い」「う」が開きすぎる。 */
const VISEME_OPENNESS: Record<Viseme, number> = {
  aa: 1.0,
  ih: 0.55,
  ou: 0.6,
  ee: 0.75,
  oh: 0.85,
};

/**
 * AudioQuery を 1 度だけ走査して、必要な時系列をまとめて作る。
 *
 * モーラの長さは speedScale を掛ける前の値なので、実再生時間に直すには割る必要がある。
 * prePhonemeLength / postPhonemeLength も同じ扱い。
 */
export function buildSpeechTimeline(query: AudioQuery): SpeechTimeline {
  const speed = query.speedScale || 1;
  const visemes: VisemeSegment[] = [];
  const phrases: PhraseTiming[] = [];
  const rawPitch: { time: number; pitch: number }[] = [];
  let reading = '';
  const readingTime: number[] = [];

  let t = (query.prePhonemeLength ?? 0) / speed;

  for (const phrase of query.accent_phrases) {
    const phraseStart = t;

    for (const mora of phrase.moras) {
      // 子音の区間も口形に含めると、母音の直前から口が動き出して自然になる
      const consonant = (mora.consonant_length ?? 0) / speed;
      const vowel = mora.vowel_length / speed;
      const duration = consonant + vowel;
      if (duration <= 0) continue;

      const viseme = VOWEL_TO_VISEME[mora.vowel] ?? null;
      visemes.push({
        start: t,
        end: t + duration,
        viseme,
        weight: viseme ? VISEME_OPENNESS[viseme] : 0,
      });

      // 無声モーラの pitch は 0 で入っている。そのまま使うと音高が急落するので後で埋める。
      rawPitch.push({ time: t + consonant + vowel * 0.5, pitch: mora.pitch });

      // 「キャ」のように 1 モーラが 2 文字のこともあるので、文字数ぶん時刻を並べる
      reading += mora.text;
      for (let i = 0; i < mora.text.length; i++) readingTime.push(t);

      t += duration;
    }

    const phraseEnd = t;

    // アクセント句のあいだの息継ぎ。ここは口を閉じる。
    const pause = phrase.pause_mora ? phrase.pause_mora.vowel_length / speed : 0;
    if (pause > 0) {
      visemes.push({ start: t, end: t + pause, viseme: null, weight: 0 });
      t += pause;
    }

    phrases.push({
      start: phraseStart,
      end: phraseEnd,
      pauseEnd: t,
      hasPause: pause > 0,
    });
  }

  return {
    visemes,
    phrases,
    prosody: normalizePitch(rawPitch),
    duration: t,
    reading,
    readingTime,
  };
}

/**
 * pitch (対数 F0) を -1..1 に正規化する。
 *
 * 絶対値は話者ごとに大きく違う (低い男声と高い女声で別物) ので、
 * その発話の中での相対的な高低に直す。無声モーラは直前の値を保持して、
 * 子音のたびに頭がガクンと落ちないようにする。
 */
function normalizePitch(raw: { time: number; pitch: number }[]): ProsodySample[] {
  const voiced = raw.filter((p) => p.pitch > 0).map((p) => p.pitch);
  if (voiced.length < 2) return raw.map((p) => ({ time: p.time, value: 0 }));

  const mean = voiced.reduce((a, b) => a + b, 0) / voiced.length;
  const variance = voiced.reduce((a, b) => a + (b - mean) ** 2, 0) / voiced.length;
  const sd = Math.sqrt(variance);
  if (sd < 1e-4) return raw.map((p) => ({ time: p.time, value: 0 }));

  let last = 0;
  return raw.map((p) => {
    if (p.pitch > 0) {
      // 2σ でおおよそ ±1 に収まる
      last = Math.max(-1, Math.min(1, (p.pitch - mean) / (2 * sd)));
    }
    return { time: p.time, value: last };
  });
}

/** 時刻 t の抑揚を線形補間で取り出す。 */
export function sampleProsody(samples: ProsodySample[], time: number): number {
  if (!samples.length) return 0;
  if (time <= samples[0].time) return samples[0].value;

  const lastSample = samples[samples.length - 1];
  if (time >= lastSample.time) return lastSample.value;

  // 二分探索。毎フレーム呼ぶので線形走査は避ける。
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].time <= time) lo = mid;
    else hi = mid;
  }

  const a = samples[lo];
  const b = samples[hi];
  const span = b.time - a.time;
  if (span <= 0) return a.value;
  return a.value + ((b.value - a.value) * (time - a.time)) / span;
}
