import type { ScriptLine, StageCharacter } from '../core/types';
import type { LineStatus } from '../core/speechProvider';
import { Panel } from './parts';

type Props = {
  lines: ScriptLine[];
  characters: StageCharacter[];
  busy: boolean;
  currentLine: number | null;
  canSpeak: boolean;
  onChange: (lines: ScriptLine[]) => void;
  onSpeak: () => void;
  onPrepare: () => void;
  onStop: () => void;
  statusForLine: (line: ScriptLine) => LineStatus;
};

export function CharacterScriptPanel({ lines, characters, busy, currentLine, canSpeak, onChange, onSpeak, onPrepare, onStop, statusForLine }: Props) {
  const updateLine = (index: number, values: Partial<ScriptLine>) =>
    onChange(lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...values } : line));
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= lines.length) return;
    const next = [...lines];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <Panel title="台本">
      <p className="hint script-help">1行が1セリフ。だれが話すかを選んで、上から順番に読ませます。</p>
      <ol className="script-lines">
        {lines.map((line, index) => (
          <li key={line.id} className={currentLine === index ? 'is-speaking' : ''}>
            <span className="script-line-number">{index + 1}</span>
            <div className="script-line-editor">
              <select aria-label={`${index + 1} 行目の担当キャラ`} value={line.characterId} onChange={(event) => updateLine(index, { characterId: event.target.value })}>
                {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
              </select>
              <input aria-label={`${index + 1} 行目のセリフ`} value={line.text} placeholder="セリフを書く" onChange={(event) => updateLine(index, { text: event.target.value })} />
            </div>
            <div className="script-line-actions">
              <small aria-live="polite">{statusForLine(line)}</small>
              <button type="button" aria-label="上へ移動" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" aria-label="下へ移動" disabled={index === lines.length - 1} onClick={() => move(index, 1)}>↓</button>
              <button type="button" aria-label="この行を消す" disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))}>×</button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="script-add" onClick={() => onChange([...lines, { id: `line-${Date.now()}`, characterId: characters[0]?.id ?? '', text: '' }])}>+ セリフを足す</button>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" disabled={busy || !canSpeak || !lines.some((line) => line.text.trim())} onClick={onPrepare}>音声を準備</button>
        <button type="button" className="primary" style={{ flex: 1 }} disabled={busy || !canSpeak || !lines.some((line) => line.text.trim())} onClick={onSpeak}>{busy ? '読み上げ中…' : '台本を読む'}</button>
        <button type="button" disabled={!busy} onClick={onStop}>止める</button>
      </div>
      {currentLine !== null && <p className="script-status" aria-live="polite">いま {currentLine + 1} 行目を準備・再生しています</p>}
    </Panel>
  );
}
