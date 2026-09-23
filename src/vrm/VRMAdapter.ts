import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * docs/ARCHITECTURE.md の `VRM Adapter` 層。
 * three-vrm の作法をここに閉じ込め、上位のエンジンは VRM の版差を意識しない。
 */

function createLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  // このプラグインが VRM 0.x / 1.0 の両方を吸収してくれる (docs/PRODUCT.md の必須要件)
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader;
}

function finalize(vrm: VRM): VRM {
  // VRM 0.x は -Z 前方。1.0 の +Z 前方に揃えないと後ろ向きで表示される。
  VRMUtils.rotateVRM0(vrm);

  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.combineSkeletons(vrm.scene);

  vrm.scene.traverse((obj) => {
    // 顔だけが消えるなどのカリング事故を防ぐ。人型 1 体なので実害はない。
    obj.frustumCulled = false;
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    }
  });

  return vrm;
}

export async function loadVRMFromUrl(url: string): Promise<VRM> {
  const gltf = await createLoader().loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error('VRM として読み込めませんでした');
  return finalize(vrm);
}

export async function loadVRMFromFile(file: File): Promise<VRM> {
  const buffer = await file.arrayBuffer();
  const gltf = await createLoader().parseAsync(buffer, '');
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error('VRM として読み込めませんでした');
  return finalize(vrm);
}

export function disposeVRM(vrm: VRM): void {
  VRMUtils.deepDispose(vrm.scene);
}

/** 腕を下ろす向き。左右それぞれ +1 / -1 で、モデルごとに実測して決める。 */
export interface ArmSign {
  left: number;
  right: number;
}

const ARM_DOWN = 1.2;
const ELBOW = 0.12;

/**
 * 「Z 軸まわりのどちら向きに回すと腕が下がるか」を実際に回して測る。
 *
 * VRM 1.0 の正規化空間なら符号は理屈で決まるはずだが、0.x から変換したモデルでは
 * rotateVRM0 の影響で逆になることがある。決め打ちすると版によって腕が上がってしまうので、
 * 手のワールド座標が下がる方を採用する。
 */
function measureArmSign(vrm: VRM, side: 'left' | 'right'): number {
  const h = vrm.humanoid;
  const upper = h.getNormalizedBoneNode(`${side}UpperArm`);
  const probe = h.getRawBoneNode(`${side}Hand`) ?? h.getRawBoneNode(`${side}LowerArm`);
  if (!upper || !probe) return side === 'left' ? 1 : -1;

  const v = new THREE.Vector3();
  const handHeight = (z: number) => {
    upper.rotation.set(0, 0, z);
    h.update();
    vrm.scene.updateMatrixWorld(true);
    return probe.getWorldPosition(v).y;
  };

  const plus = handHeight(ARM_DOWN);
  const minus = handHeight(-ARM_DOWN);
  upper.rotation.set(0, 0, 0);

  return plus < minus ? 1 : -1;
}

/**
 * 素体の T ポーズ / A ポーズは棒立ちで不自然なので、腕を下ろした基本姿勢を作る。
 * 戻り値の符号は、この後ジェスチャーが腕を動かすときにも使う。
 */
export function applyRestPose(vrm: VRM): ArmSign {
  const h = vrm.humanoid;
  const sign: ArmSign = {
    left: measureArmSign(vrm, 'left'),
    right: measureArmSign(vrm, 'right'),
  };

  for (const side of ['left', 'right'] as const) {
    const s = sign[side];
    h.getNormalizedBoneNode(`${side}UpperArm`)?.rotation.set(0, 0, s * ARM_DOWN);
    // 肘をわずかに曲げる。真っ直ぐのままだと棒立ちに見える。
    h.getNormalizedBoneNode(`${side}LowerArm`)?.rotation.set(0, -s * ELBOW, s * ELBOW * 0.6);
    h.getNormalizedBoneNode(`${side}Hand`)?.rotation.set(0, 0, 0);
  }

  h.update();
  return sign;
}
