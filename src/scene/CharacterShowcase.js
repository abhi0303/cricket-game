// Developer tool (?debug=characters): every character type lined up on the pitch for inspection.
//   &view=front|back|side|three   camera angle      &anim=<clip>  force one clip for everybody
//   &t=<seconds>                   freeze time       &q=low|high   geometry quality
//   &ball=x,y,z                    ball marker in the first batter's local space (+x to the bowler, +z off side)
//   &aim=1                         steer that batter's shot onto the ball marker (as in a match)
import * as THREE from 'three';
import { PlayerModel } from './PlayerModel.js';

export function startShowcase({ stadium, camera, q }) {
  const team1 = { primary: '#14806a', secondary: '#f4d35e', short: 'MCC', emblem: { shape: 'shield', icon: 'bat' } };
  const team2 = { primary: '#5b3fa6', secondary: '#c0f0ff', short: 'NLX', emblem: { shape: 'shield', icon: 'star' } };
  const p = (id, name, number) => ({ id, name, number });
  const quality = q.get('q') || 'high';
  const cast = [
    { m: new PlayerModel({ player: p('a1', 'Rafi Quint', 51), team: team1, role: 'batter', withBat: true, quality }), clip: 'stance', yaw: Math.PI / 2 },
    { m: new PlayerModel({ player: p('b2', 'Silas Barrett', 19), team: team2, role: 'fielder', quality }), clip: 'standField', yaw: 0 },
    { m: new PlayerModel({ player: p('c3', 'Kofi Mensah', 7), team: team2, role: 'fielder', quality }), clip: 'ready', yaw: 0 },
    { m: new PlayerModel({ player: p('d4', 'Dev Okafor', 33), team: team2, role: 'keeper', quality }), clip: 'crouch', yaw: 0 },
    { m: new PlayerModel({ player: p('u1', 'Umpire', 0), team: null, role: 'umpire', quality }), clip: 'umpire', yaw: 0 },
    { m: new PlayerModel({ player: p('e5', 'Hamish Lomax', 4), team: team1, role: 'batter', withBat: true, quality }), clip: 'waitBat', yaw: 0 },
  ];
  cast.forEach((c, i) => { c.m.setPosition((i - (cast.length - 1) / 2) * 1.25, 2, c.yaw); stadium.frame.add(c.m.root); });
  if (q.get('only') != null) cast.forEach((c, i) => { c.m.root.visible = i === Number(q.get('only')); });
  let anim = q.get('anim');
  let fixedT = q.get('t') != null ? Number(q.get('t')) : null;
  const view = q.get('view') || 'front';
  const cams = {
    front: [[0, 1.25, 8.4], [0, 1.0, 2]],
    back: [[0, 1.4, -4.6], [0, 1.0, 2]],
    side: [[7.2, 1.3, 2.2], [0, 1.0, 2]],
    three: [[4.8, 2.2, 7.2], [0, 0.9, 2]],
    close: [[-2.2, 1.55, 3.6], [-3.1, 1.2, 2]],
    face: [[-1.875, 1.74, 3.05], [-1.875, 1.68, 2]],
    // batter (cast 0, faces the bowler at -z): behind like the game camera, square-leg side-on, from the bowler
    bbehind: [[-2.75, 2.1, 7.2], [-3.1, 0.95, -1]],
    bside: [[-8.2, 1.25, 1.6], [-3.1, 0.95, 1.6]],
    bfront: [[-3.3, 1.5, -4.2], [-3.1, 0.95, 2]],
    bpoint: [[1.9, 1.25, 1.3], [-3.1, 0.9, 1.6]],
    bat: [[-1.2, 1.3, 3.4], [-3.1, 0.9, 2]],
  }[view] || [[0, 1.25, 8.4], [0, 1, 2]];
  camera.position.set(...cams[0]);
  camera.lookAt(new THREE.Vector3(...cams[1]));
  camera.fov = view === 'close' ? 30 : view === 'face' ? 22 : view === 'bat' ? 32 : view.startsWith('b') && view !== 'back' ? 34 : 42; camera.updateProjectionMatrix();
  // optional ball marker + bat aim for the first batter
  const bat0 = cast[0].m;
  let aimAt = null;
  const reAim = () => { if (aimAt && anim) bat0.aimShot(anim, aimAt); };
  if (q.get('ball')) {
    const [bx, by, bz] = q.get('ball').split(',').map(Number);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.036, 16, 12), new THREE.MeshStandardMaterial({ color: '#b3121a', roughness: 0.4 }));
    bat0.root.add(ball);
    ball.position.set(bx, by, bz);
    ball.scale.setScalar(1 / bat0.root.scale.x);
    if (q.get('aim')) aimAt = new THREE.Vector3(bx, by, bz);
  }
  let t = 0;
  reAim();
  window.__showcase = { cast, THREE, set(a, tt) { anim = a; fixedT = tt; reAim(); }, camera };
  return {
    cast,
    update(dt) {
      t += dt;
      for (const c of cast) c.m.play(anim || c.clip, fixedT ?? t, dt);
    },
  };
}
