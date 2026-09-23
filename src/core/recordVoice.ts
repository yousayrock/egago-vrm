/** Record microphone PCM as WAV so registration works without ffmpeg or network. */
export async function startVoiceRecording(): Promise<{ stop: () => Promise<File> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  try {
    await context.resume();
    const input = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const sink = context.createGain();
    sink.gain.value = 0;
    const chunks: Float32Array[] = [];
    let samples = 0;
    processor.onaudioprocess = (event) => {
      if (samples >= context.sampleRate * 30) return;
      const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(chunk);
      samples += chunk.length;
    };
    input.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);
    let stopped = false;
    return {
      stop: async () => {
        if (stopped) throw new Error('録音はすでに停止しました');
        stopped = true;
        processor.disconnect(); input.disconnect(); sink.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        const count = Math.min(samples, context.sampleRate * 30);
        const buffer = new ArrayBuffer(44 + count * 2);
        const view = new DataView(buffer);
        const ascii = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
        ascii(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); ascii(8, 'WAVE');
        ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
        view.setUint16(22, 1, true); view.setUint32(24, context.sampleRate, true);
        view.setUint32(28, context.sampleRate * 2, true); view.setUint16(32, 2, true);
        view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, count * 2, true);
        let offset = 44;
        for (const chunk of chunks) for (const value of chunk) {
          if (offset >= buffer.byteLength) break;
          view.setInt16(offset, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true);
          offset += 2;
        }
        return new File([buffer], 'recorded-voice.wav', { type: 'audio/wav' });
      },
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    throw error;
  }
}
