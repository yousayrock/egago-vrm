import { useState } from 'react';
import { fetchVoices } from '../core/api';
import { useStore } from '../core/store';
import type { ScriptLine, StageCharacter } from '../core/types';
import { Panel } from './parts';

function snapshot() {
  const s = useStore.getState();
  return {
    characters: s.characters, scriptLines: s.scriptLines, selectedCharacterId: s.selectedCharacterId,
    speechProvider: s.speechProvider, characterMode: s.characterMode, modelUrl: s.modelUrl,
    background: s.background, backgroundColor: s.backgroundColor, backgroundImage: s.backgroundImage,
    characterImage: s.characterImage, cameraDistance: s.cameraDistance, cameraHeight: s.cameraHeight,
    emotion: s.emotion, blink: s.blink, breath: s.breath, idle: s.idle,
  };
}

async function detail(response: Response): Promise<string> {
  try { return (await response.json() as { detail?: string }).detail ?? `${response.status}`; }
  catch { return `${response.status} ${response.statusText}`; }
}

export function UsbPanel() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/usb/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: snapshot() }),
      });
      if (!response.ok) throw new Error(await detail(response));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'egago-project.zip'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('USBに保存するZIPを作りました');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    setBusy(true); setMessage('');
    try {
      if (file.size > 256 * 1024 * 1024) throw new Error('ZIPは256MB以下にしてください');
      const form = new FormData(); form.append('file', file);
      const response = await fetch('/api/usb/import', { method: 'POST', body: form });
      if (!response.ok) throw new Error(await detail(response));
      const payload = await response.json() as { project: Record<string, unknown> };
      const project = payload.project;
      const characters = project.characters as StageCharacter[];
      const lines = project.scriptLines as ScriptLine[];
      if (!Array.isArray(characters) || !Array.isArray(lines) || !characters.length ||
          !characters.every((item) => typeof item.id === 'string' && typeof item.name === 'string') ||
          !lines.every((item) => typeof item.id === 'string' && typeof item.characterId === 'string' && typeof item.text === 'string')) {
        throw new Error('プロジェクトのキャラまたは台本を読み込めません');
      }
      const state = useStore.getState();
      state.patch({
        characters, scriptLines: lines,
        selectedCharacterId: typeof project.selectedCharacterId === 'string' && characters.some((item) => item.id === project.selectedCharacterId)
          ? project.selectedCharacterId : characters[0].id,
        speechProvider: project.speechProvider === 'moss' ? 'moss' : 'voicevox',
        characterMode: project.characterMode === 'vrm' ? 'vrm' : 'image',
        background: ['alpha', 'green', 'color', 'image'].includes(String(project.background))
          ? project.background as 'alpha' | 'green' | 'color' | 'image' : 'alpha',
        backgroundColor: typeof project.backgroundColor === 'string' ? project.backgroundColor : state.backgroundColor,
        backgroundImage: typeof project.backgroundImage === 'string' ? project.backgroundImage : '',
        modelUrl: typeof project.modelUrl === 'string' ? project.modelUrl : state.modelUrl,
        characterImage: typeof project.characterImage === 'string' ? project.characterImage : state.characterImage,
        cameraDistance: typeof project.cameraDistance === 'number' ? project.cameraDistance : state.cameraDistance,
        cameraHeight: typeof project.cameraHeight === 'number' ? project.cameraHeight : state.cameraHeight,
        voiceProfiles: await fetchVoices(),
      });
      setMessage('プロジェクト・声・生成音声を取り込みました');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Panel title="USBで持ち運ぶ">
    <p className="hint">プロジェクト・声データ・準備済み音声をZIPで保存します。USBを挿し、保存先に選んでください。</p>
    <button type="button" disabled={busy} onClick={() => void download()}>USB用ZIPを書き出す</button>
    <input type="file" accept=".zip,application/zip" disabled={busy} aria-label="USB用ZIPを取り込む"
      onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    {message && <p className="hint" role="status">{message}</p>}
  </Panel>;
}
