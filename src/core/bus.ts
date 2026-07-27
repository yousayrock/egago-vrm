import type { AudioQuery, BackgroundMode, EmotionName, GestureName } from './types';

/**
 * Editor と Stage の同期チャネル。
 *
 * BroadcastChannel ではなく FastAPI 経由の WebSocket を使う。理由は OBS のブラウザソースが
 * 別プロセスの CEF であり、ユーザーのブラウザとは BroadcastChannel が共有されないため。
 * サーバ経由なら「Chrome の Editor」→「OBS の Stage」も確実に届く。
 */

export interface StageState {
  modelUrl: string;
  background: BackgroundMode;
  backgroundColor: string;
  cameraDistance: number;
  cameraHeight: number;
}

export type BusMessage =
  | { type: 'hello'; role: 'editor' | 'stage' }
  | { type: 'state'; state: StageState }
  // text は Stage 側で自動ジェスチャーを組み立てるのに要る (文末の ? や ! を見る)
  | { type: 'speak'; audio: string; query: AudioQuery; text: string }
  | { type: 'stop' }
  | { type: 'emotion'; emotion: EmotionName }
  | { type: 'gesture'; gesture: GestureName };

type Handler = (msg: BusMessage) => void;

const handlers = new Set<Handler>();
let socket: WebSocket | null = null;
let reconnectDelay = 500;
let connected = false;
const queue: BusMessage[] = [];
const connectionListeners = new Set<(ok: boolean) => void>();

function url(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/bus`;
}

function setConnected(v: boolean) {
  if (connected === v) return;
  connected = v;
  connectionListeners.forEach((f) => f(v));
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const ws = new WebSocket(url());
  socket = ws;

  ws.onopen = () => {
    reconnectDelay = 500;
    setConnected(true);
    while (queue.length) ws.send(JSON.stringify(queue.shift()));
  };

  ws.onmessage = (ev) => {
    let msg: BusMessage;
    try {
      msg = JSON.parse(ev.data as string) as BusMessage;
    } catch {
      return;
    }
    handlers.forEach((h) => h(msg));
  };

  ws.onclose = () => {
    setConnected(false);
    socket = null;
    // API が落ちていても Editor 単体では動かせるべきなので、静かに再接続を試み続ける
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
  };

  ws.onerror = () => ws.close();
}

export const bus = {
  start(): void {
    connect();
  },

  send(msg: BusMessage): void {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    } else {
      // 接続前に飛んできたものは繋がってから送る(取りこぼすと Stage が初期状態のままになる)
      queue.push(msg);
      connect();
    }
  },

  on(handler: Handler): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  },

  onConnectionChange(listener: (ok: boolean) => void): () => void {
    connectionListeners.add(listener);
    listener(connected);
    return () => connectionListeners.delete(listener);
  },

  get connected(): boolean {
    return connected;
  },
};
