import { useCallback, useEffect, useRef, useState } from 'react';
import { bus } from '../core/bus';
import { playScript } from '../core/scriptPlayback';
import { mossProvider, voicevoxProvider, type LineStatus } from '../core/speechProvider';
import { useStore } from '../core/store';
import type { ScriptLine, SpeechResult } from '../core/types';
import type { Viewer } from '../three/Viewer';

type Prepared = { key: string; result: SpeechResult };
type Progress = { key: string; status: LineStatus };

function signature(line: ScriptLine): string {
  const state = useStore.getState();
  if (state.speechProvider === 'moss') {
    const character = state.characters.find((item) => item.id === line.characterId);
    const voice = state.voiceProfiles.find((item) => item.id === character?.voiceId);
    return JSON.stringify(['moss', line.text.trim(), line.characterId, voice?.content_hash ?? character?.voiceId]);
  }
  return JSON.stringify(['voicevox', line.text.trim(), state.speakerId, state.speedScale,
    state.pitchScale, state.intonationScale, state.volumeScale]);
}

export function useScriptPlayback(viewer: Viewer | null) {
  const active = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Prepared>());
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [speakingLine, setSpeakingLine] = useState<number | null>(null);

  const stop = useCallback(() => {
    active.current?.abort();
    setSpeakingLine(null);
    viewer?.character.speech.stop();
    bus.send({ type: 'stop' });
  }, [viewer]);

  useEffect(() => () => { if (active.current) stop(); }, [stop]);

  const prepareLine = useCallback(async (line: ScriptLine, signal: AbortSignal): Promise<SpeechResult> => {
    const state = useStore.getState();
    const key = signature(line);
    const cached = cache.current.get(line.id);
    if (cached?.key === key) return cached.result;
    let provider;
    if (state.speechProvider === 'moss') {
      const character = state.characters.find((item) => item.id === line.characterId);
      if (!character) throw new Error(`「${line.text}」の担当キャラが見つかりません`);
      const voice = state.voiceProfiles.find((item) => item.id === character.voiceId);
      if (!voice) throw new Error(`${character.name} に声を割り当ててください`);
      provider = mossProvider(voice);
    } else {
      provider = voicevoxProvider({ speaker: state.speakerId, speedScale: state.speedScale,
        pitchScale: state.pitchScale, intonationScale: state.intonationScale, volumeScale: state.volumeScale });
    }
    const update = (status: LineStatus) => setProgress((current) => ({ ...current, [line.id]: { key, status } }));
    try {
      const result = await provider.prepare(line.text.trim(), signal, update);
      if (signal.aborted) throw new DOMException('停止しました', 'AbortError');
      cache.current.set(line.id, { key, result });
      return result;
    } catch (error) {
      if (!signal.aborted) update('失敗');
      throw error;
    }
  }, []);

  const run = useCallback(async (play: boolean) => {
    const state = useStore.getState();
    if (!viewer || active.current || state.busy || !state.scriptLines.some((line) => line.text.trim())) return;
    const controller = new AbortController();
    active.current = controller;
    state.patch({ busy: true, error: null });
    try {
      if (play) await viewer.character.speech.prepare();
      await playScript(state.scriptLines, controller.signal, async (line, index) => {
        if (play) {
          setSpeakingLine(index);
          state.patch({ selectedCharacterId: line.characterId });
        }
        const result = await prepareLine(line, controller.signal);
        if (controller.signal.aborted || !play) return;
        bus.send({ type: 'speak', ...result, text: line.text });
        await viewer.character.speak(result.audio, result.query, line.text);
      });
    } catch (error) {
      if (!controller.signal.aborted) state.patch({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (active.current === controller) {
        active.current = null;
        setSpeakingLine(null);
        state.patch({ busy: false });
      }
    }
  }, [viewer, prepareLine]);

  const statusForLine = (line: ScriptLine): LineStatus => {
    const key = signature(line);
    if (cache.current.get(line.id)?.key === key) return '準備完了';
    const item = progress[line.id];
    return item?.key === key ? item.status : '未生成';
  };

  return { speak: () => run(true), prepare: () => run(false), stop, speakingLine, statusForLine };
}
