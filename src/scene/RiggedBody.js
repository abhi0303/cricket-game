// A rigged character model worn in place of a PlayerModel's own body. The PlayerModel keeps animating its own
// skeleton exactly as before (clips, foot and hand IK, the bat); every frame its pose is copied onto the model's
// skeleton, and then the model's hands are pulled onto the same places as the player's hands (on the bat grips)
// and its feet onto the same places on the ground with two-bone IK, so the model's own proportions don't matter.
//
// The players (assets/models/fielder: batters, bowlers and fielders) are "indian male character" by Aashutosh
// Dabhade, CC BY 4.0, a Ready Player Me avatar on a Mixamo-style skeleton (scripts/fielder-model.html paints out
// its shirt lettering); its kit is recoloured by texture region. The keeper (assets/models/keeper) is "Stylized
// Cricketer" by kanesk06, CC BY 4.0, rigged by scripts/keeper-model.html with the same bone names; his orange
// shirt and navy trousers are recoloured to the team's kit (whites in Tests).
// Every body is sized so the player stands as tall as the built-in ones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { OFFSET, PARENT, LIMB, HIP_HEIGHT } from './CharacterGeometry.js';
import { loadGear, mirrored } from './GearModels.js';

// Leg pads on a batter: sized to his shin (knee to ankle): from a little over the top of the foot to the knee roll
// about 18 cm above the knee. length and below (how far it reaches under the ankle) are in shin lengths; girth
// narrows the width and depth a little for the slim players.
const PAD = { length: 1.6, below: 0.12, girth: 0.88, ahead: 0.05 };   // ahead: off the shin, so a bent knee stays inside

// Colours a kit swap looks for in a texture.
const CLASS = {
  keeperOrange: (r, g, b) => r > 90 && g < r * 0.58 && b < r * 0.42,
  navy: (r, g, b) => b > r + 6 && b > g + 6 && r < 95 && Math.abs(r - g) < 14,
  blue: (r, g, b) => b > r + 30 && b > g + 5,
  orange: (r, g, b) => r > 150 && r > g + 40 && b < r * 0.6,
};

// recolor: parts of the texture (rect: [x0, y0, x1, y1] as fractions) and in each, which colour becomes which part of
// the team's kit (PlayerModel.kit: shirt, trousers, trim).
export const BODIES = {
  keeper: {
    glb: 'assets/models/keeper/keeper.glb', tex: 'assets/models/keeper/base.jpg', normal: 'assets/models/keeper/normal.jpg',
    recolor: [{ rect: [0, 0, 1, 1], swaps: [['keeperOrange', 'shirt'], ['navy', 'trousers']] }],
  },
  fielder: {
    glb: 'assets/models/fielder/fielder.glb', tex: 'assets/models/fielder/base.jpg', normal: 'assets/models/fielder/normal.jpg',
    recolor: [
      { rect: [0, 0, 0.5, 0.5], swaps: [['blue', 'shirt'], ['orange', 'trim']] },            // shirt and sleeves
      { rect: [0, 0.5, 0.375, 0.875], swaps: [['blue', 'trousers'], ['orange', 'trim']] },    // trousers
    ],
  },
};

const hexRGB = h => { const n = parseInt(String(h).replace('#', '').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = ([r, g, b]) => 0.3 * r + 0.59 * g + 0.11 * b;

/**
 * The texture in a kit's colours, keeping the shading: in each region, each pixel of a swapped colour takes the
 * kit colour scaled by how light or dark it is against that colour's average there. Everything else (skin, hair,
 * gloves, shoes) stays.
 */
function recolor(img, regions, kit) {
  const c = document.createElement('canvas');
  const W = c.width = img.width, H = c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, W, H), d = data.data;
  for (const { rect, swaps } of regions) {
    const [x0, y0, x1, y1] = [rect[0] * W, rect[1] * H, rect[2] * W, rect[3] * H].map(Math.round);
    const sw = swaps.map(([cls, part]) => ({ test: CLASS[cls], to: hexRGB(kit[part]), sum: 0, n: 0 }));
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 1) for (const s of sw) { s.from = s.n ? s.sum / s.n : 1; s.light = lum(s.to) > 150; }
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2];
        const s = sw.find(q => q.test(r, gg, b));
        if (!s) continue;
        if (pass === 0) { s.sum += lum([r, gg, b]); s.n++; continue; }
        let k = lum([r, gg, b]) / s.from;
        if (s.light) k = 0.82 + 0.18 * k;                     // a pale kit: keep the folds, don't blow out
        d[i] = Math.min(255, s.to[0] * k); d[i + 1] = Math.min(255, s.to[1] * k); d[i + 2] = Math.min(255, s.to[2] * k);
      }
    }
  }
  g.putImageData(data, 0, 0);
  return c;
}

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
    const tl = new THREE.TextureLoader();
    templates.set(name, Promise.all([new GLTFLoader().loadAsync(def.glb), tl.loadAsync(def.tex), def.normal ? tl.loadAsync(def.normal) : null]).then(([gltf, map, normalMap]) => {
      const prep = (t, srgb) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4; return t; };   // glTF texture coordinates
      prep(map, true);
      if (normalMap) prep(normalMap, false);
      const make = m => new THREE.MeshStandardMaterial({ map: m, normalMap, roughness: 0.88, metalness: 0 });
      const material = make(map);
      gltf.scene.traverse(o => { if (o.isSkinnedMesh) o.material = material; });
      // per kit: the texture recoloured to the team's shirt and trousers (cached)
      const kits = new Map();
      const materialFor = kit => {
        if (!def.recolor || !kit) return material;
        const key = `${kit.shirt}|${kit.trousers}|${kit.trim}`;
        if (!kits.has(key)) kits.set(key, make(prep(new THREE.CanvasTexture(recolor(map.image, def.recolor, kit)), true)));
        return kits.get(key);
      };
      return { scene: gltf.scene, material, materialFor };
    }));
  }
  return templates.get(name);
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3();
const _e = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

function findBone(scene, name) {
  const re = new RegExp(`^(mixamorig:?)?${name}(_\\d+)?$`);   // Mixamo, or the same names bare (Ready Player Me)
  let hit = null;
  scene.traverse(o => { if (!hit && o.isBone && re.test(o.name)) hit = o; });
  return hit;
}

/** World rotation of an object in its root's space (the PlayerModel root). */
function rootQuat(o, rootInvQ, out) { return out.copy(rootInvQ).multiply(o.getWorldQuaternion(_q2)); }

export class RiggedBody {
  /** template: from loadBody(); model: the PlayerModel that wears it; pads: put leg pads on him (batters). */
  constructor(template, model, { pads = false } = {}) {
    this.model = model;
    this.scene = cloneSkinned(template.scene);
    this.bones = {};
    for (const [ours, theirs] of Object.entries(MAP)) this.bones[ours] = findBone(this.scene, theirs);
    this.spine1 = findBone(this.scene, 'Spine1');
    const aimBone = {};
    for (const [k, [, theirs]] of Object.entries(AIM)) aimBone[k] = findBone(this.scene, theirs);
    this.scene.traverse(o => { if (o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; this.mesh = o; } });
    this.mesh.material = template.materialFor(model.kit);
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
    // Sized like everyone else: the body was scaled to our leg length, so a model with a long body (or a stylised one,
    // short in the leg and big in the head) would stand too tall. Scale the whole player so the head is at the height
    // of a built-in player's.
    const headAt = o => HIP_HEIGHT + o.spine[1] + o.chest[1] + o.neck[1] + o.head[1];
    this.sizeFix = headAt(OFFSET) / headAt(Object.fromEntries(['spine', 'chest', 'neck', 'head'].map(k => [k, model.b[k].position.toArray()])));
    model.root.scale.multiplyScalar(this.sizeFix);
    model.heightScale *= this.sizeFix;

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
    if (pads) this.addPads();
  }

  /**
   * Leg pads, one on each shin bone so they go with the leg. Placed now, in the bind pose (legs straight, facing the
   * player's forward): along the shin, face forward, wrapped round it; the right one is the left one mirrored.
   */
  addPads() {
    const root = this.model.root;
    root.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(0, 0, 1).transformDirection(root.matrixWorld);
    const place = {};
    for (const side of ['L', 'R']) {
      const shin = this.bones['shin' + side], foot = this.bones['foot' + side];
      const knee = shin.getWorldPosition(new THREE.Vector3()), ankle = foot.getWorldPosition(new THREE.Vector3());
      const len = knee.distanceTo(ankle);
      const up = knee.clone().sub(ankle).normalize();
      const z = fwd.clone().addScaledVector(up, -fwd.dot(up)).normalize();
      const x = new THREE.Vector3().crossVectors(up, z);
      const s = len * PAD.length;
      const world = new THREE.Matrix4().makeBasis(x, up, z).scale(new THREE.Vector3(s * PAD.girth, s, s * PAD.girth));
      world.setPosition(ankle.clone().addScaledVector(up, -len * PAD.below).addScaledVector(z, len * PAD.ahead));
      place[side] = new THREE.Matrix4().copy(shin.matrixWorld).invert().multiply(world);   // in the shin bone's frame
    }
    loadGear('pad').then(scene => {
      for (const side of ['L', 'R']) {
        const pad = side === 'L' ? scene.clone() : mirrored(scene);
        pad.matrixAutoUpdate = false;
        pad.matrix.copy(place[side]);
        pad.name = 'pad' + side;
        this.bones['shin' + side].add(pad);
      }
      this.container.updateMatrixWorld(true);
    }).catch(err => console.warn('Pads not loaded.', err));
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
