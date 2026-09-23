import { cancelSpeechJob, createSpeechJob, fetchSpeechAudio, fetchSpeechJob, synthesize } from './api';
import type { SpeechResult, VoiceProfile } from './types';

export type LineStatus = '未生成' | '待機中' | 'モデル読込中' | '生成中' | '準備完了' | '失敗';

export interface SpeechProvider {
  prepare(text: string, signal: AbortSignal, onStatus: (status: LineStatus) => void): Promise<SpeechResult>;
}

export function voicevoxProvider(settings: {
  speaker: number; speedScale: number; pitchScale: number; intonationScale: number; volumeScale: number;
}): SpeechProvider {
  return {
    prepare: async (text, signal, onStatus) => {
      onStatus('生成中');
      const result = await synthesize({ text, ...settings }, signal);
      onStatus('準備完了');
      return result;
    },
  };
}

export function mossProvider(voice: VoiceProfile): SpeechProvider {
  return {
    prepare: async (text, signal, onStatus) => {
      let jobId: string | null = null;
      const cancel = () => { if (jobId) void cancelSpeechJob(jobId).catch(() => undefined); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        onStatus('待機中');
        let job = await createSpeechJob(text, voice.id, signal);
        jobId = job.id;
        if (signal.aborted) { cancel(); throw new DOMException('停止しました', 'AbortError'); }
        while (job.status !== 'ready') {
          if (job.status === 'failed') throw new Error(job.error ?? '音声生成に失敗しました');
          if (job.status === 'cancelled') throw new DOMException('停止しました', 'AbortError');
          onStatus(job.status === 'loading' ? 'モデル読込中' : job.status === 'generating' ? '生成中' : '待機中');
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { signal.removeEventListener('abort', interrupted); resolve(); }, 300);
            const interrupted = () => { clearTimeout(timer); reject(new DOMException('停止しました', 'AbortError')); };
            signal.addEventListener('abort', interrupted, { once: true });
          });
          job = await fetchSpeechJob(jobId, signal);
        }
        const audio = await fetchSpeechAudio(jobId, signal);
        onStatus('準備完了');
        return { audio };
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
  };
}
