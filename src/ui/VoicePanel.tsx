import { useEffect, useMemo, useRef, useState } from 'react';
import { exportVoice, fetchVoices, importVoice, registerVoice } from '../core/api';
import { startVoiceRecording } from '../core/recordVoice';
import { useStore } from '../core/store';
import { Field, Panel, Slider } from './parts';

export function VoicePanel() {
  const s = useStore();
  const [name, setName] = useState('わたしの声');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const recorder = useRef<{ stop: () => Promise<File> } | null>(null);
  const selected = s.characters.find((character) => character.id === s.selectedCharacterId);
  const currentSpeaker = useMemo(
    () => s.speakers.find((sp) => sp.styles.some((style) => style.id === s.speakerId)) ?? s.speakers[0],
    [s.speakers, s.speakerId],
  );

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    let alive = true;
    void fetchVoices().then((voices) => { if (alive) s.patch({ voiceProfiles: voices }); })
      .catch((error: unknown) => { if (alive) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; void recorder.current?.stop().catch(() => undefined); recorder.current = null; };
  }, [s.patch]);

  const assign = (voiceId: string) => {
    s.patch({ characters: s.characters.map((character) => character.id === selected?.id ? { ...character, voiceId } : character) });
  };
  const addVoice = async (action: () => Promise<{ id: string; name: string }>) => {
    setWorking(true); setMessage('');
    try {
      const voice = await action();
      s.patch({ voiceProfiles: await fetchVoices(), speechProvider: 'moss' });
      assign(voice.id);
      setMessage(`${voice.name} を登録しました`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setWorking(false); }
  };
  const download = async () => {
    if (!selected?.voiceId) return;
    try {
      const data = await exportVoice(selected.voiceId);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `${selected.name}-voice.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  return <Panel title="声（こえ）">
    <Field label="音声エンジン"><select value={s.speechProvider} onChange={(e) => s.set('speechProvider', e.target.value as 'voicevox' | 'moss')}>
      <option value="voicevox">VOICEVOX</option><option value="moss">この端末の声（MOSS）</option>
    </select></Field>
    {s.speechProvider === 'moss' ? <>
      <p className="hint">声を登録したら、このキャラに割り当てます。音声は端末内で作ります。</p>
      <Field label={`${selected?.name ?? 'キャラ'} の声`}><select value={selected?.voiceId ?? ''} onChange={(e) => assign(e.target.value)}>
        <option value="">声を選んでください</option>
        {s.voiceProfiles.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
      </select></Field>
      <button type="button" disabled={!selected?.voiceId} onClick={() => void download()}>この声を書き出す（USBへ保存可）</button>
      <Field label="声の名前"><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="録音ファイル（WAV）"><input type="file" accept=".wav,audio/wav" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      <div className="row">
        <button type="button" disabled={working || !file || !name.trim()} onClick={() => file && void addVoice(() => registerVoice(file, name))}>ファイルから登録</button>
        <button type="button" disabled={working} onClick={() => {
          if (recorder.current) {
            const current = recorder.current; recorder.current = null; setRecording(false);
            void current.stop().then((wav) => { setFile(wav); setMessage('録音しました。内容を確認して「ファイルから登録」を押してください。'); })
              .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
          } else {
            void startVoiceRecording().then((active) => { recorder.current = active; setRecording(true); setMessage('録音中…30秒以内に停止してください'); })
              .catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)));
          }
        }}>{recording ? '録音を止める' : 'マイクで録音'}</button>
      </div>
      {previewUrl && <audio controls src={previewUrl} />}
      <Field label="声データを入れる"><input type="file" accept=".json,application/json" onChange={(e) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;
        if (selectedFile.size > 64 * 1024) { setMessage('声データは64KB以下にしてください'); return; }
        void addVoice(async () => importVoice(JSON.parse(await selectedFile.text())));
      }} /></Field>
      {message && <p className="hint" role="status">{message}</p>}
    </> : <>
      <Field label="話者"><select value={currentSpeaker?.uuid ?? ''} disabled={!s.speakers.length} onChange={(e) => {
        const speaker = s.speakers.find((item) => item.uuid === e.target.value);
        if (speaker?.styles.length) s.set('speakerId', speaker.styles[0].id);
      }}>
        {!s.speakers.length && <option>読み込み中…</option>}
        {s.speakers.map((speaker) => <option key={speaker.uuid} value={speaker.uuid}>{speaker.name}</option>)}
      </select></Field>
      <Field label="スタイル"><select value={s.speakerId} disabled={!currentSpeaker} onChange={(e) => s.set('speakerId', Number(e.target.value))}>
        {currentSpeaker?.styles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
      </select></Field>
      <Slider label="話速" value={s.speedScale} min={0.5} max={2} step={0.05} onChange={(v) => s.set('speedScale', v)} />
      <Slider label="音高" value={s.pitchScale} min={-0.15} max={0.15} step={0.01} onChange={(v) => s.set('pitchScale', v)} />
      <Slider label="抑揚" value={s.intonationScale} min={0} max={2} step={0.05} onChange={(v) => s.set('intonationScale', v)} />
      <Slider label="音量" value={s.volumeScale} min={0} max={2} step={0.05} onChange={(v) => s.set('volumeScale', v)} />
    </>}
  </Panel>;
}
