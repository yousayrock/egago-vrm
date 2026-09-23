import { useEffect, useState } from 'react';
import type { Viewer } from '../three/Viewer';
import { useStore } from '../core/store';

/**
 * store の値を Viewer に流し込む。
 * Editor でも Stage でも同じ store 形状を使うので、この 1 本で両方まかなえる。
 */
export function useViewerSync(viewer: Viewer | null) {
  const modelUrl = useStore((s) => s.modelUrl);
  const characterMode = useStore((s) => s.characterMode);
  const background = useStore((s) => s.background);
  const backgroundColor = useStore((s) => s.backgroundColor);
  const backgroundImage = useStore((s) => s.backgroundImage);
  const cameraDistance = useStore((s) => s.cameraDistance);
  const cameraHeight = useStore((s) => s.cameraHeight);
  const breath = useStore((s) => s.breath);
  const blink = useStore((s) => s.blink);
  const idle = useStore((s) => s.idle);
  const prosody = useStore((s) => s.prosody);
  const behavior = useStore((s) => s.behavior);
  const autoNod = useStore((s) => s.autoNod);
  const autoGesture = useStore((s) => s.autoGesture);
  const autoEmotion = useStore((s) => s.autoEmotion);
  const emotion = useStore((s) => s.emotion);

  const [loading, setLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  useEffect(() => {
    if (!viewer) return;
    if (characterMode === 'image') {
      setLoading(false);
      setModelError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setModelError(null);

    viewer.character
      .setModel(modelUrl)
      .catch((e: unknown) => {
        if (!cancelled) setModelError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [viewer, modelUrl, characterMode]);

  useEffect(() => {
    viewer?.setBackground(background, backgroundColor, backgroundImage);
  }, [viewer, background, backgroundColor, backgroundImage]);

  useEffect(() => {
    viewer?.setCamera(cameraDistance, cameraHeight);
  }, [viewer, cameraDistance, cameraHeight]);

  useEffect(() => {
    if (!viewer) return;
    viewer.character.motion.enabled = { breath, blink, idle, prosody, behavior };
  }, [viewer, breath, blink, idle, prosody, behavior]);

  useEffect(() => {
    if (!viewer) return;
    viewer.character.autoNod = autoNod;
    viewer.character.autoGesture = autoGesture;
    viewer.character.autoEmotion = autoEmotion;
  }, [viewer, autoNod, autoGesture, autoEmotion]);

  useEffect(() => {
    viewer?.character.setEmotion(emotion);
  }, [viewer, emotion]);

  return { loading, modelError };
}
