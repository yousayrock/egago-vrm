import type { AudioQuery, Speaker, SpeechJob, VoiceProfile, VrmModel } from './types';

export interface Health {
  ok: boolean;
  voicevoxVersion: string | null;
  engineUrl: string;
}

export interface SynthesizeParams {
  text: string;
  speaker: number;
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
}

export interface SynthesizeResult {
  /** base64 エンコードされた WAV */
  audio: string;
  query: AudioQuery;
}

/** FastAPI は失敗時に {detail: "..."} を返すので、それをそのままエラーにする。 */
async function json<T>(response: Response | Promise<Response>): Promise<T> {
  const res = await response;
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* JSON でないレスポンスはステータス文言のまま */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function fetchHealth(): Promise<Health> {
  return json<Health>(await fetch('/api/health'));
}

export async function fetchSpeakers(): Promise<Speaker[]> {
  return json<Speaker[]>(await fetch('/api/speakers'));
}

export async function fetchModels(): Promise<VrmModel[]> {
  return json<VrmModel[]>(await fetch('/api/models'));
}

export async function uploadModel(file: File): Promise<VrmModel> {
  const form = new FormData();
  form.append('file', file);
  return json<VrmModel>(await fetch('/api/models', { method: 'POST', body: form }));
}

export async function synthesize(params: SynthesizeParams, signal?: AbortSignal): Promise<SynthesizeResult> {
  return json<SynthesizeResult>(
    await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal,
    }),
  );
}

export interface LocalSpeechStatus {
  provider: 'moss';
  ready: boolean;
  loaded: boolean;
  error: string | null;
}

export const fetchSpeechStatus = () => json<LocalSpeechStatus>(fetch('/api/speech/status'));
export const fetchVoices = () => json<VoiceProfile[]>(fetch('/api/voices'));

export async function registerVoice(file: File, name: string): Promise<VoiceProfile> {
  const form = new FormData();
  form.append('file', file);
  form.append('name', name);
  return json<VoiceProfile>(await fetch('/api/voices/register', { method: 'POST', body: form }));
}

export async function importVoice(profile: unknown): Promise<VoiceProfile> {
  return json<VoiceProfile>(await fetch('/api/voices/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }),
  }));
}

export async function exportVoice(id: string): Promise<unknown> {
  return json<unknown>(await fetch(`/api/voices/${encodeURIComponent(id)}/export`));
}

export async function createSpeechJob(text: string, voiceId: string, signal?: AbortSignal): Promise<SpeechJob> {
  return json<SpeechJob>(await fetch('/api/speech/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voiceId }), signal,
  }));
}

export const fetchSpeechJob = (id: string, signal?: AbortSignal) =>
  json<SpeechJob>(fetch(`/api/speech/jobs/${encodeURIComponent(id)}`, { signal }));

export const cancelSpeechJob = (id: string) =>
  json<SpeechJob>(fetch(`/api/speech/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }));

export async function fetchSpeechAudio(id: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`/api/speech/jobs/${encodeURIComponent(id)}/audio`, { signal });
  if (!response.ok) throw new Error(`音声の取得に失敗しました (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** base64 の WAV を ArrayBuffer に戻す。 */
export function decodeBase64Audio(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
