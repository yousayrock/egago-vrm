import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CharacterEngine } from '../core/CharacterEngine';
import type { BackgroundMode } from '../core/types';

/**
 * three.js の描画まわり。シーン・カメラ・ライト・毎フレームのループを持つ。
 * キャラクターの中身には立ち入らず、CharacterEngine に委譲する。
 */
export class Viewer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly character = new CharacterEngine();

  private clock = new THREE.Clock();
  private frame = 0;
  private canvas: HTMLCanvasElement;
  private lastWidth = 0;
  private lastHeight = 0;

  /** 注視点の高さ。モデル読み込み時に頭の位置から決める。 */
  private focusHeight = 1.35;
  private distance = 1.6;
  private heightOffset = 0;

  /**
   * canvas は受け取らず自前で作って container に挿す。
   * 1 つの canvas に WebGL コンテキストは 1 つしか作れないため、
   * StrictMode の二重マウントで canvas を使い回すと 2 つの Renderer が
   * 同じコンテキストを共有し、片方の dispose がもう片方を壊してしまう。
   */
  constructor(private container: HTMLElement) {
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // 背景透過 (docs T014/T015) のために必須。OBS のブラウザソースはアルファを拾える。
      alpha: true,
      premultipliedAlpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, this.focusHeight, this.distance);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.target.set(0, this.focusHeight, 0);
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 8;

    this.setupLights();
    this.scene.add(this.character.root);

    this.character.onModelChanged = (vrm) => {
      const head = vrm.humanoid.getNormalizedBoneNode('head');
      if (head) {
        const p = new THREE.Vector3();
        head.getWorldPosition(p);
        this.focusHeight = p.y;
      }
      this.applyCamera();
    };

    this.resize();
  }

  private setupLights(): void {
    // MToon は明るめの環境光の方が破綻しにくい
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 1.6, 1.6);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1.2, 0.8, -0.8);
    this.scene.add(fill);
  }

  start(): void {
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.1); // タブ復帰時の巨大な dt を抑える

      // 毎フレームサイズを見る。ResizeObserver に任せると、非表示のまま生成された
      // ウィンドウ (OBS のブラウザソースや裏で開いた Stage) で通知が来ず、
      // 描画バッファが 1x1 のままになることがある。
      this.resize();

      this.controls.update();
      // 視線をカメラに向けると「こちらを見ている」感じが出る
      this.character.setGazePoint(this.camera.position);
      this.character.update(dt);

      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  setBackground(mode: BackgroundMode, color: string): void {
    if (mode === 'alpha') {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
    } else {
      const c = new THREE.Color(mode === 'green' ? '#00ff00' : color);
      this.scene.background = c;
      this.renderer.setClearColor(c, 1);
    }
  }

  setCamera(distance: number, heightOffset: number): void {
    this.distance = distance;
    this.heightOffset = heightOffset;
    this.applyCamera();
  }

  private applyCamera(): void {
    const y = this.focusHeight + this.heightOffset;
    this.controls.target.set(0, y, 0);
    this.camera.position.set(0, y, this.distance);
    this.controls.update();
  }

  private resize(): void {
    const w = Math.max(1, Math.round(this.container.clientWidth));
    const h = Math.max(1, Math.round(this.container.clientHeight));
    if (w === this.lastWidth && h === this.lastHeight) return;

    this.lastWidth = w;
    this.lastHeight = h;
    // updateStyle=false。canvas の見た目のサイズは CSS 側 (width/height: 100%) に任せる。
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.character.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
