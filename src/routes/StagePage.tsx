import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { bus } from '../core/bus';
import { useStore } from '../core/store';
import type { BackgroundMode } from '../core/types';
import type { Viewer } from '../three/Viewer';
import { useViewerSync } from '../ui/useViewerSync';
import { VrmCanvas } from '../ui/VrmCanvas';

/** heartbeat の間隔。Editor 側はこれの 2 回分を過ぎたら切断とみなす。 */
const HEARTBEAT = 5000;

/**
 * OBS 用の表示画面 (docs T016)。
 * UI は一切持たず、Editor から流れてくる指示に従って描画するだけ。
 */
export function StagePage() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [params] = useSearchParams();
  const patch = useStore((s) => s.patch);

  useViewerSync(viewer);

  // Stage は OBS のブラウザソースで開かれる。body 側も透明にしておかないと
  // 背景モードを「透過」にしてもページの地色が残ってしまう。
  useEffect(() => {
    document.body.classList.add('stage');
    return () => document.body.classList.remove('stage');
  }, []);

  // URL の ?bg= を最優先にする。OBS のソースごとに透過/緑を出し分けたいため。
  useEffect(() => {
    const bg = params.get('bg');
    if (bg === 'alpha' || bg === 'green' || bg === 'color') {
      patch({ background: bg as BackgroundMode });
    }
  }, [params, patch]);

  useEffect(() => {
    bus.start();

    const hello = () => bus.send({ type: 'hello', role: 'stage' });
    hello();
    const id = window.setInterval(hello, HEARTBEAT);

    const off = bus.on((msg) => {
      switch (msg.type) {
        case 'state': {
          const { background, ...rest } = msg.state;
          // ?bg= が指定されていればそちらを優先し、Editor の背景設定は無視する
          const forced = params.get('bg');
          patch(forced ? rest : { ...rest, background });
          break;
        }
        case 'speak':
          void viewer?.character.speak(msg.audio, msg.query, msg.text);
          break;
        case 'stop':
          viewer?.character.speech.stop();
          break;
        case 'emotion':
          patch({ emotion: msg.emotion });
          break;
        case 'gesture':
          viewer?.character.gesture(msg.gesture);
          break;
        case 'hello':
          break;
      }
    });

    return () => {
      off();
      clearInterval(id);
    };
  }, [viewer, patch, params]);

  return (
    <div className="stage">
      <VrmCanvas onReady={setViewer} />
    </div>
  );
}
