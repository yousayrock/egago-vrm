import type { AudioQuery, Speaker, VrmModel } from './types';

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
async function json<T>(res: Response): Promise<T> {
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

export async function synthesize(params: SynthesizeParams): Promise<SynthesizeResult> {
  return json<SynthesizeResult>(
    await fetch('/api/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }),
  );
}

/** base64 の WAV を ArrayBuffer に戻す。 */
export function decodeBase64Audio(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
