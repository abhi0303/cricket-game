// A rigged character model worn in place of a PlayerModel's own body. The PlayerModel keeps animating its own
// skeleton exactly as before (clips, foot and hand IK, the bat); every frame its pose is copied onto the model's
// skeleton, and then the model's hands are pulled onto the same places as the player's hands (on the bat grips)
// and its feet onto the same places on the ground with two-bone IK, so the model's own proportions don't matter.
//
// The batsman (assets/models/batsman, made by scripts/batsman-model.html) is "Virat Kohli Cricket Batting
// Animation - Low Poly" by bhagathartworks, CC BY 4.0: a low-poly body on a Mixamo skeleton.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { OFFSET, PARENT, LIMB } from './CharacterGeometry.js';

export const BODIES = {
  batsman: { glb: 'assets/models/batsman/batsman.glb', tex: 'assets/models/batsman/body.jpg' },
};

// our bone -> the model's (Mixamo names, as the glTF loader gives them: "mixamorigLeftArm_09")
const MAP = {
  hips: 'Hips', spine: 'Spine', chest: 'Spine2', neck: 'Neck', head: 'Head',
  armL: 'LeftArm', foreL: 'LeftForeArm', handL: 'LeftHand', armR: 'RightArm', foreR: 'RightForeArm', handR: 'RightHand',
  thighL: 'LeftUpLeg', shinL: 'LeftLeg', footL: 'LeftFoot', thighR: 'RightUpLeg', shinR: 'RightLeg', footR: 'RightFoot',
};
// the joint each bone points at, to match the two rest poses (ours: arms hanging; the model's: a T-pose)
const AIM = {
  armL: ['foreL', 'LeftForeArm'], foreL: ['handL', 'LeftHand'], handL: [null, 'LeftHandIndex1'],
  armR: ['foreR', 'RightForeArm'], foreR: ['handR', 'RightHand'], handR: [null, 'RightHandIndex1'],
  thighL: ['shinL', 'LeftLeg'], shinL: ['footL', 'LeftFoot'], thighR: ['shinR', 'RightLeg'], shinR: ['footR', 'RightFoot'],
};
const ORDER = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];

const templates = new Map();   // name -> Promise<{ scene, material }>

/** Load a body once (the glTF and its texture). */
export function loadBody(name) {
  if (!templates.has(name)) {
    const def = BODIES[name];
    templates.set(name, Promise.all([new GLTFLoader().loadAsync(def.glb), new THREE.TextureLoader().loadAsync(def.tex)]).then(([gltf, map]) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;                      // glTF texture coordinates
      map.anisotropy = 4;
      const material = new THREE.MeshStandardMaterial({ map, roughness: 0.88, metalness: 0 });
      gltf.scene.traverse(o => { if (o.isSkinnedMesh) o.material = material; });
      return { scene: gltf.scene, material };
    }));
  }
  return templates.get(name);
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3();
const _e = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

function findBone(scene, name) {
  const re = new RegExp(`^mixamorig:?${name}(_\\d+)?$`);
  let hit = null;
  scene.traverse(o => { if (!hit && o.isBone && re.test(o.name)) hit = o; });
  return hit;
}

/** World rotation of an object in its root's space (the PlayerModel root). */
function rootQuat(o, rootInvQ, out) { return out.copy(rootInvQ).multiply(o.getWorldQuaternion(_q2)); }

export class RiggedBody {
  /** template: from loadBody(); model: the PlayerModel that wears it. */
  constructor(template, model) {
    this.model = model;
    this.scene = cloneSkinned(template.scene);
    this.bones = {};
    for (const [ours, theirs] of Object.entries(MAP)) this.bones[ours] = findBone(this.scene, theirs);
    this.spine1 = findBone(this.scene, 'Spine1');
    const aimBone = {};
    for (const [k, [, theirs]] of Object.entries(AIM)) aimBone[k] = findBone(this.scene, theirs);
    this.scene.traverse(o => { if (o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; this.mesh = o; } });
    // the bind pose (pose() works from the parents' world matrices, so bring those up to date first)
    this.scene.updateMatrixWorld(true);
    this.mesh.skeleton.pose();

    // Stand it up facing the same way as our players (+z forward, +x its left), at our hip height.
    this.scene.updateMatrixWorld(true);
    const pos = n => this.bones[n].getWorldPosition(new THREE.Vector3());
    const left = pos('thighL').sub(pos('thighR')).normalize();
    let up = pos('head').sub(pos('hips')).normalize();
    const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
    up = new THREE.Vector3().crossVectors(fwd, left).normalize();
    const basis = new THREE.Matrix4().makeBasis(left, up, fwd);
    const ankles = pos('footL').add(pos('footR')).multiplyScalar(0.5);
    const hipToAnkle = pos('hips').sub(ankles).dot(up);
    const ourHipToAnkle = -OFFSET.thighL[1] + LIMB.thigh + LIMB.shin;   // hip joint height above the ankle, standing
    this.container = new THREE.Group();
    this.container.name = 'riggedBody';
    this.container.quaternion.setFromRotationMatrix(basis).invert();
    this.container.scale.setScalar(ourHipToAnkle / hipToAnkle);
    this.container.add(this.scene);
    model.root.add(this.container);
    model.root.updateMatrixWorld(true);

    // Calibration: for each bone, the fixed offset K that maps our bone's rotation onto the model's, so that
    // our rest pose (turned so each limb points where the model's does in its bind pose) gives the bind pose.
    const rootInv = new THREE.Quaternion();
    model.root.getWorldQuaternion(rootInv).invert();
    const restDir = {};
    for (const b of ORDER) {
      const child = AIM[b]?.[0];
      restDir[b] = child ? new THREE.Vector3(...OFFSET[child]).normalize() : AIM[b] ? restDir[PARENT[b]].clone() : null;
    }
    const rootInvM = new THREE.Matrix4().copy(model.root.matrixWorld).invert();
    const at = o => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInvM);
    this.K = {};
    for (const b of ORDER) {
      const qm = rootQuat(this.bones[b], rootInv, new THREE.Quaternion());
      let swing = new THREE.Quaternion();
      if (AIM[b]) {
        const dm = at(aimBone[b]).sub(at(this.bones[b])).normalize();
        swing = new THREE.Quaternion().setFromUnitVectors(restDir[b], dm);
      }
      this.K[b] = swing.invert().multiply(qm);
    }
    // the model's spine has an extra bone: it takes half the bend between its neighbours
    this.K.spine1 = rootQuat(this.spine1, rootInv, new THREE.Quaternion());
    // Our skeleton takes his torso: the spine, neck and head joints and the shoulders go where his are (both rest
    // poses stand upright), so our arm IK works from his shoulders and the hands it puts on the bat are ones his can
    // reach. The legs keep ours (his feet are put on ours).
    const rel = (a, b) => at(this.bones[a]).sub(at(this.bones[b]));
    for (const [ours, from] of [['spine', 'hips'], ['chest', 'spine'], ['neck', 'chest'], ['head', 'neck'], ['armL', 'chest'], ['armR', 'chest']]) {
      model.b[ours].position.copy(rel(ours, from));
    }

    // His arms are a little shorter than ours: lengthen the upper and lower arm bones to our lengths, so his hands
    // can reach the grips wherever ours are (the stretch is a few centimetres, taken up at the elbow and wrist).
    this.armStretch = [];
    for (const [arm, fore, hand, upper, lower] of [['armL', 'foreL', 'handL', LIMB.upper, LIMB.fore], ['armR', 'foreR', 'handR', LIMB.upper, LIMB.fore]]) {
      const l1 = at(this.bones[fore]).distanceTo(at(this.bones[arm])), l2 = at(this.bones[hand]).distanceTo(at(this.bones[fore]));
      this.bones[fore].position.multiplyScalar(upper / l1);
      this.bones[hand].position.multiplyScalar(lower / l2);
      this.armStretch.push(+(upper / l1).toFixed(3), +(lower / l2).toFixed(3));
    }
    model.root.updateMatrixWorld(true);
    this.limbs = {
      armL: [this.bones.armL, this.bones.foreL, this.bones.handL], armR: [this.bones.armR, this.bones.foreR, this.bones.handR],
      legL: [this.bones.thighL, this.bones.shinL, this.bones.footL], legR: [this.bones.thighR, this.bones.shinR, this.bones.footR],
    };
    this.tq = {};
    for (const b of ORDER) this.tq[b] = new THREE.Quaternion();
  }

  /** Set a bone's rotation to a world-space target (its parent's world matrix must be up to date). */
  setWorld(bone, q) {
    bone.parent.getWorldQuaternion(_qs).invert();
    bone.quaternion.copy(_qs.multiply(q));
    bone.updateWorldMatrix(false, false);
  }

  /** Copy the PlayerModel's current pose (call after it has been applied). */
  update() {
    const m = this.model, B = this.bones;
    m.root.updateMatrixWorld(true);
    for (const b of ORDER) m.b[b].getWorldQuaternion(this.tq[b]).multiply(this.K[b]);
    // hips: rotation and position
    const hips = B.hips;
    hips.parent.updateWorldMatrix(true, false);
    m.b.hips.getWorldPosition(_p);
    hips.position.copy(_p.applyMatrix4(_m.copy(hips.parent.matrixWorld).invert()));
    this.setWorld(hips, this.tq.hips);
    this.setWorld(B.spine, this.tq.spine);
    // Spine1 halfway between Spine and Spine2 (each relative to its own rest)
    _q.copy(m.b.spine.getWorldQuaternion(_q2)).slerp(m.b.chest.getWorldQuaternion(new THREE.Quaternion()), 0.5).multiply(this.K.spine1);
    this.setWorld(this.spine1, _q);
    for (const b of ['chest', 'neck', 'head']) this.setWorld(B[b], this.tq[b]);
    for (const b of ['armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']) {
      B[b].parent.updateWorldMatrix(true, false);
      this.setWorld(B[b], this.tq[b]);
    }
    // hands onto our hands (on the bat), feet onto our feet, elbows and knees bending the same way
    this.reach(this.limbs.armL, m.b.handL, m.b.foreL, this.tq.handL);
    this.reach(this.limbs.armR, m.b.handR, m.b.foreR, this.tq.handR);
    this.reach(this.limbs.legL, m.b.footL, m.b.shinL, this.tq.footL);
    this.reach(this.limbs.legR, m.b.footR, m.b.shinR, this.tq.footR);
    this.container.updateMatrixWorld(true);
  }

  /** Two-bone IK: put the end joint of [upper, mid, end] on `target`'s position, bending towards `pole`. */
  reach([upper, mid, end], target, pole, endQ) {
    upper.getWorldPosition(_a); mid.getWorldPosition(_b); end.getWorldPosition(_c);
    target.getWorldPosition(_t); pole.getWorldPosition(_p);
    const l1 = _a.distanceTo(_b), l2 = _b.distanceTo(_c);
    const d = Math.min(Math.max(_a.distanceTo(_t), Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
    _u.subVectors(_t, _a).normalize();
    _v.subVectors(_p, _a); _v.addScaledVector(_u, -_v.dot(_u));
    if (_v.lengthSq() < 1e-10) _v.subVectors(_b, _a).addScaledVector(_u, -_b.clone().sub(_a).dot(_u));
    _v.normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    _e.copy(_a).addScaledVector(_u, along).addScaledVector(_v, h);                // where the elbow / knee goes
    // swing the upper bone so the middle joint lands on _e, then the middle bone so the end lands on the target
    _s.subVectors(_b, _a).normalize();
    _q.setFromUnitVectors(_s, _e.clone().sub(_a).normalize()).multiply(upper.getWorldQuaternion(_q2));
    this.setWorld(upper, _q);
    mid.updateWorldMatrix(false, false);
    mid.getWorldPosition(_b); end.updateWorldMatrix(false, false); end.getWorldPosition(_c);
    _s.subVectors(_c, _b).normalize();
    _q.setFromUnitVectors(_s, _t.clone().sub(_b).normalize()).multiply(mid.getWorldQuaternion(_q2));
    this.setWorld(mid, _q);
    end.updateWorldMatrix(false, false);
    this.setWorld(end, endQ);
  }

  dispose() { this.container.removeFromParent(); }
}
