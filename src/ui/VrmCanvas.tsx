import { useEffect, useRef } from 'react';
import { Viewer } from '../three/Viewer';

/**
 * Viewer(three.js)を React のライフサイクルに載せるだけの薄いラッパ。
 * 描画ループの中身は React の外にあるので、再レンダリングの影響を受けない。
 *
 * canvas は Viewer が自分で作って挿す。React に canvas を持たせて使い回すと、
 * StrictMode の二重マウントで WebGL コンテキストを共有してしまうため。
 */
export function VrmCanvas({
  onReady,
  className,
}: {
  onReady: (viewer: Viewer | null) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // onReady が毎回新しい関数でも Viewer を作り直さないよう ref 経由で読む
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!ref.current) return;

    const viewer = new Viewer(ref.current);
    viewer.start();
    onReadyRef.current(viewer);

    // 開発時はコンソールから中身を触れるようにしておく
    if (import.meta.env.DEV) {
      (window as unknown as { __viewer?: Viewer }).__viewer = viewer;
    }

    return () => {
      onReadyRef.current(null);
      viewer.dispose();
    };
  }, []);

  return <div ref={ref} className={className} style={{ width: '100%', height: '100%' }} />;
}
