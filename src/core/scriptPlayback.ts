import type { ScriptLine } from './types';

/** 元の行番号を保ち、空行を飛ばして再生完了まで一行ずつ待つ。 */
export async function playScript(
  lines: ScriptLine[],
  signal: AbortSignal,
  playLine: (line: ScriptLine, index: number) => Promise<void>,
): Promise<void> {
  for (const [index, line] of lines.entries()) {
    if (signal.aborted) break;
    if (line.text.trim()) await playLine(line, index);
  }
}
