// ========================================================
// VORTEX // Hybrid Engine: Moving Bots + 1v1 P2P Multiplayer
// ========================================================

let scene, camera, renderer, clock;
let isGameRunning = false;
let isAiming = false;
let isPointerLocked = false;
let gameMode = 'single'; // 'single' or 'multiplayer'

// Player State
const player = {
  pos: new THREE.Vector3(0, 2, 25),
  vel: new THREE.Vector3(0, 0, 0),
  rot: new THREE.Euler(0, 0, 0, 'YXZ'),
  radius: 0.6,
  onGround: true,
  health: 100,
  ammo: 30,
  maxAmmo: 30,
  reserveAmmo: 90,
  isReloading: false
};

const MOVE_SPEED = 14;
const GRAVITY = 32;
const JUMP_FORCE = 11;
const keys = { w: false, a: false, s: false, d: false };

// Colliders & Bots
const solidBoxes = [];
const bots = [];

// 1v1 PeerJS P2P State
let peer = null;
let peerConn = null;
let remotePlayerMesh = null;
let remotePlayerState = { pos: new THREE.Vector3(0, 2, -25), rotY: 0 };

// Weapon Visuals
let rifleGroup, muzzleLight;

// ========================================================
// 1. Initializer
// ========================================================
function initEngine() {
  const container = document.getElementById('gameViewport');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe3f7);
  scene.fog = new THREE.FogExp2(0xbfe3f7, 0.008);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 800);
  camera.position.copy(player.pos);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  clock = new THREE.Clock();

  // Lighting
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd4bda5, 0.7));
  const sun = new THREE.DirectionalLight(0xfff5e6, 1.4);
  sun.position.set(45, 80, 40);
  sun.castShadow = true;
  scene.add(sun);

  buildSolidArena();
  buildAssaultRifle();
  buildRemotePlayerModel();
  spawnAIBots();
  bindControls();
  initPeerNetworking();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ========================================================
// 2. Arena with Solid Walls
// ========================================================
function buildSolidArena() {
  const floorGeo = new THREE.PlaneGeometry(240, 240);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xdfd2be, roughness: 0.9 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6 });
  const coverMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4 });

  function addSolidBox(size, pos, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const box = new THREE.Box3();
    box.setFromObject(mesh);
    solidBoxes.push(box);
  }

  // Perimeter Walls
  addSolidBox([220, 10, 4], [0, 5, -110], wallMat);
  addSolidBox([220, 10, 4], [0, 5, 110], wallMat);
  addSolidBox([4, 10, 220], [-110, 5, 0], wallMat);
  addSolidBox([4, 10, 220], [110, 5, 0], wallMat);

  // Cover Bunkers
  const coverList = [
    { size: [6, 4, 3], pos: [-12, 2, -12] },
    { size: [6, 4, 3], pos: [12, 2, -12] },
    { size: [6, 4, 3], pos: [-12, 2, 12] },
    { size: [6, 4, 3], pos: [12, 2, 12] },
    { size: [10, 5, 4], pos: [0, 2.5, 0] },
    { size: [4, 4, 12], pos: [-35, 2, 0] },
    { size: [4, 4, 12], pos: [35, 2, 0] }
  ];
  coverList.forEach(c => addSolidBox(c.size, c.pos, coverMat));
}

// ========================================================
// 3. AI Bots
// ========================================================
function spawnAIBots() {
  const botSpawns = [
    [-18, 0, -30], [18, 0, -30], [0, 0, -45],
    [-28, 0, 5], [28, 0, 5]
  ];

  botSpawns.forEach((spawn, idx) => {
    const botGroup = new THREE.Group();
    botGroup.position.set(...spawn);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 });
    const limbMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.4), bodyMat);
    torso.position.y = 1.6;
    botGroup.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), new THREE.MeshStandardMaterial({ color: 0xffedd5 }));
    head.position.y = 2.45;
    botGroup.add(head);

    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 0.28), limbMat);
    leftLeg.position.set(-0.25, 0.5, 0);
    botGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.9, 0.28), limbMat);
    rightLeg.position.set(0.25, 0.5, 0);
    botGroup.add(rightLeg);

    botGroup.userData = {
      id: idx,
      hp: 100,
      alive: true,
      speed: 4.5,
      patrolTarget: getRandomPoint(),
      leftLeg, rightLeg,
      walkCycle: Math.random() * Math.PI,
      lastShotTime: 0
    };

    scene.add(botGroup);
    bots.push(botGroup);
  });
}

function getRandomPoint() {
  return new THREE.Vector3((Math.random() - 0.5) * 120, 0, (Math.random() - 0.5) * 120);
}

function updateBots(delta) {
  if (!isGameRunning || gameMode !== 'single') return;

  const now = performance.now();

  bots.forEach(bot => {
    if (!bot.userData.alive) return;
    const data = bot.userData;
    const distToPlayer = bot.position.distanceTo(player.pos);

    let targetPos = distToPlayer < 40 ? player.pos : data.patrolTarget;

    if (distToPlayer >= 40 && bot.position.distanceTo(data.patrolTarget) < 4) {
      data.patrolTarget = getRandomPoint();
      targetPos = data.patrolTarget;
    }

    const dir = new THREE.Vector3().subVectors(targetPos, bot.position);
    dir.y = 0;
    dir.normalize();
    bot.lookAt(targetPos.x, bot.position.y, targetPos.z);

    if (distToPlayer > 6) {
      bot.position.addScaledVector(dir, data.speed * delta);
      data.walkCycle += delta * data.speed * 2.5;
      data.leftLeg.rotation.x = Math.sin(data.walkCycle) * 0.6;
      data.rightLeg.rotation.x = -Math.sin(data.walkCycle) * 0.6;
    }

    // Bot shoots at player
    if (distToPlayer < 35 && now - data.lastShotTime > 1300) {
      data.lastShotTime = now;
      if (Math.random() > 0.4) {
        player.health = Math.max(0, player.health - 12);
        updatePlayerHUD();
        if (player.health <= 0) {
          const redScore = document.getElementById('redScore');
          if (redScore) redScore.innerText = parseInt(redScore.innerText) + 1;
          respawnPlayer();
        }
      }
    }
  });
}

// ========================================================
// 4. Remote Player Model (Dost ka model)
// ========================================================
function buildRemotePlayerModel() {
  remotePlayerMesh = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0284c7 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.4), bodyMat);
  torso.position.y = 1.6;
  remotePlayerMesh.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), new THREE.MeshStandardMaterial({ color: 0xffedd5 }));
  head.position.y = 2.45;
  remotePlayerMesh.add(head);

  remotePlayerMesh.visible = false;
  scene.add(remotePlayerMesh);
}

// ========================================================
// 5. Solid Collision Algorithm
// ========================================================
function resolveCollisions(newPos) {
  const pMinX = newPos.x - player.radius;
  const pMaxX = newPos.x + player.radius;
  const pMinZ = newPos.z - player.radius;
  const pMaxZ = newPos.z + player.radius;

  for (let i = 0; i < solidBoxes.length; i++) {
    const box = solidBoxes[i];
    if (pMaxX > box.min.x && pMinX < box.max.x &&
        pMaxZ > box.min.z && pMinZ < box.max.z &&
        newPos.y < box.max.y) {
      const dx1 = box.max.x - pMinX;
      const dx2 = pMaxX - box.min.x;
      const dz1 = box.max.z - pMinZ;
      const dz2 = pMaxZ - box.min.z;
      const minX = Math.min(dx1, dx2);
      const minZ = Math.min(dz1, dz2);

      if (minX < minZ) {
        newPos.x += (dx1 < dx2) ? dx1 : -dx2;
      } else {
        newPos.z += (dz1 < dz2) ? dz1 : -dz2;
      }
    }
  }
}

// ========================================================
// 6. Weapon & Shooting
// ========================================================
function buildAssaultRifle() {
  rifleGroup = new THREE.Group();
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x0284c7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.65), gunMat);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 16), gunMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.45);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.1), trimMat);
  mag.position.set(0, -0.14, -0.05);

  rifleGroup.add(body, barrel, mag);

  muzzleLight = new THREE.PointLight(0xffaa00, 0, 15);
  muzzleLight.position.set(0, 0.03, -0.7);
  rifleGroup.add(muzzleLight);

  rifleGroup.position.set(0.28, -0.25, -0.55);
  camera.add(rifleGroup);
  scene.add(camera);
}

function fireWeapon() {
  if (!isGameRunning || player.isReloading) return;
  if (player.ammo <= 0) { reloadWeapon(); return; }

  player.ammo--;
  const ammoElem = document.getElementById('ammoCurrent');
  if (ammoElem) ammoElem.innerText = player.ammo;

  rifleGroup.position.z += 0.08;
  setTimeout(() => rifleGroup.position.z = isAiming ? -0.38 : -0.55, 70);

  muzzleLight.intensity = 5;
  setTimeout(() => muzzleLight.intensity = 0, 40);

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  // Single Mode: Raycast Bot hits
  if (gameMode === 'single') {
    const hitCandidates = [];
    bots.forEach(b => { if (b.userData.alive) b.children.forEach(c => hitCandidates.push(c)); });
    const intersects = raycaster.intersectObjects(hitCandidates, false);
    if (intersects.length > 0) {
      const hitBot = intersects[0].object.parent;
      if (hitBot && hitBot.userData.alive) {
        hitBot.userData.hp -= 34;
        if (hitBot.userData.hp <= 0) {
          hitBot.userData.alive = false;
          hitBot.position.y = -20;
          const blueScore = document.getElementById('blueScore');
          if (blueScore) blueScore.innerText = parseInt(blueScore.innerText) + 1;
          setTimeout(() => {
            hitBot.userData.hp = 100;
            hitBot.userData.alive = true;
            const pt = getRandomPoint();
            hitBot.position.set(pt.x, 0, pt.z);
          }, 3000);
        }
      }
    }
  }

  // 1v1 Mode: Raycast Remote Player
  if (gameMode === 'multiplayer' && remotePlayerMesh && remotePlayerMesh.visible) {
    const hit = raycaster.intersectObjects(remotePlayerMesh.children, false);
    if (hit.length > 0 && peerConn && peerConn.open) {
      peerConn.send({ type: 'hit', damage: 34 });
    }
  }
}

function reloadWeapon() {
  if (player.isReloading || player.ammo === player.maxAmmo) return;
  player.isReloading = true;
  const ammoElem = document.getElementById('ammoCurrent');
  if (ammoElem) ammoElem.innerText = '--';
  rifleGroup.position.y -= 0.2;

  setTimeout(() => {
    player.ammo = player.maxAmmo;
    player.isReloading = false;
    rifleGroup.position.y = -0.25;
    if (ammoElem) ammoElem.innerText = player.ammo;
  }, 1200);
}

// ========================================================
// 7. P2P 1v1 Networking
// ========================================================
function initPeerNetworking() {
  const code = 'VORTEX-' + Math.floor(1000 + Math.random() * 9000);
  peer = new Peer(code);

  peer.on('open', id => {
    const myPeerElem = document.getElementById('myPeerId');
    if (myPeerElem) myPeerElem.value = id;
  });

  peer.on('connection', conn => {
    peerConn = conn;
    setupNetworkListeners();
    startBattle('multiplayer');
  });
}

function copyMyId() {
  const field = document.getElementById('myPeerId');
  if (!field) return;
  navigator.clipboard.writeText(field.value);
  alert('Room ID copied! Send this to your friend.');
}

function joinFriend() {
  const friendId = document.getElementById('friendPeerId').value.trim();
  if (!friendId) { alert('Enter Friend Room ID!'); return; }
  peerConn = peer.connect(friendId);
  setupNetworkListeners();
  startBattle('multiplayer');
}

function setupNetworkListeners() {
  peerConn.on('open', () => {
    if (remotePlayerMesh) remotePlayerMesh.visible = true;
    const statusElem = document.getElementById('connectionStatus');
    if (statusElem) {
      statusElem.innerText = '1v1 LIVE';
      statusElem.style.color = '#10b981';
    }

    // Hide bots during 1v1 match
    bots.forEach(b => b.visible = false);

    setInterval(() => {
      if (peerConn && peerConn.open && isGameRunning) {
        peerConn.send({
          type: 'transform',
          pos: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
          rotY: player.rot.y
        });
      }
    }, 30);
  });

  peerConn.on('data', data => {
    if (data.type === 'transform') {
      remotePlayerState.pos.set(data.pos.x, data.pos.y, data.pos.z);
      remotePlayerState.rotY = data.rotY;
    } else if (data.type === 'hit') {
      player.health = Math.max(0, player.health - data.damage);
      updatePlayerHUD();
      if (player.health <= 0) {
        const redScore = document.getElementById('redScore');
        if (redScore) redScore.innerText = parseInt(redScore.innerText) + 1;
        peerConn.send({ type: 'died' });
        respawnPlayer();
      }
    } else if (data.type === 'died') {
      const blueScore = document.getElementById('blueScore');
      if (blueScore) blueScore.innerText = parseInt(blueScore.innerText) + 1;
    }
  });
}

// ========================================================
// 8. Start Battle & Force Hide Lobby (FIXED)
// ========================================================
function startBattle(mode) {
  gameMode = mode;

  // 1. Force hide lobby wrapper completely
  const lobby = document.getElementById('lobbyScreen');
  if (lobby) {
    lobby.style.setProperty('display', 'none', 'important');
    lobby.style.visibility = 'hidden';
    lobby.style.pointerEvents = 'none';
  }

  // 2. Force show in-game HUD
  const hud = document.getElementById('gameHUD');
  if (hud) {
    hud.style.setProperty('display', 'flex', 'important');
    hud.style.visibility = 'visible';
    hud.style.pointerEvents = 'none';
  }

  isGameRunning = true;

  // Pointer lock on PC
  if (!('ontouchstart' in window)) {
    const vp = document.getElementById('gameViewport');
    if (vp) vp.requestPointerLock();
  }
}

function startSinglePractice() {
  startBattle('single');
}

function respawnPlayer() {
  player.health = 100;
  player.pos.set((Math.random() - 0.5) * 40, 2, 25);
  camera.position.copy(player.pos);
  updatePlayerHUD();
}

function updatePlayerHUD() {
  const hpText = document.getElementById('hpText');
  const hpBar = document.getElementById('hpBar');
  if (hpText) hpText.innerText = player.health;
  if (hpBar) hpBar.style.width = player.health + '%';
}

// ========================================================
// 9. Controls
// ========================================================
function bindControls() {
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyW') keys.w = true;
    if (e.code === 'KeyS') keys.s = true;
    if (e.code === 'KeyA') keys.a = true;
    if (e.code === 'KeyD') keys.d = true;
    if (e.code === 'Space' && player.onGround) { player.vel.y = JUMP_FORCE; player.onGround = false; }
    if (e.code === 'KeyR') reloadWeapon();
  });

  window.addEventListener('keyup', e => {
    if (e.code === 'KeyW') keys.w = false;
    if (e.code === 'KeyS') keys.s = false;
    if (e.code === 'KeyA') keys.a = false;
    if (e.code === 'KeyD') keys.d = false;
  });

  const vp = document.getElementById('gameViewport');
  vp.addEventListener('click', () => { 
    if (isGameRunning && !isPointerLocked) vp.requestPointerLock(); 
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = (document.pointerLockElement === vp);
  });

  window.addEventListener('mousemove', e => {
    if (!isPointerLocked) return;
    player.rot.y -= e.movementX * 0.0022;
    player.rot.x -= e.movementY * 0.0022;
    player.rot.x = Math.max(-1.4, Math.min(1.4, player.rot.x));
  });

  window.addEventListener('mousedown', e => {
    if (!isPointerLocked) return;
    if (e.button === 0) fireWeapon();
  });

  const btnFire = document.getElementById('btnFire');
  const btnReload = document.getElementById('btnReload');
  const btnJump = document.getElementById('btnJump');

  if (btnFire) btnFire.addEventListener('touchstart', (e) => { e.preventDefault(); fireWeapon(); });
  if (btnReload) btnReload.addEventListener('touchstart', (e) => { e.preventDefault(); reloadWeapon(); });
  if (btnJump) btnJump.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (player.onGround) { player.vel.y = JUMP_FORCE; player.onGround = false; }
  });
}

function updatePhysics(delta) {
  if (!isGameRunning) return;

  camera.rotation.copy(player.rot);

  const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rot.y);
  const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rot.y);
  const moveDir = new THREE.Vector3();

  if (keys.w) moveDir.add(forward);
  if (keys.s) moveDir.add(forward.clone().negate());
  if (keys.a) moveDir.add(right.clone().negate());
  if (keys.d) moveDir.add(right);

  if (moveDir.lengthSq() > 0) moveDir.normalize();

  player.vel.x = moveDir.x * MOVE_SPEED;
  player.vel.z = moveDir.z * MOVE_SPEED;
  player.vel.y -= GRAVITY * delta;

  const nextPos = player.pos.clone();
  nextPos.x += player.vel.x * delta;
  nextPos.z += player.vel.z * delta;
  nextPos.y += player.vel.y * delta;

  resolveCollisions(nextPos);

  if (nextPos.y <= 2) {
    nextPos.y = 2;
    player.vel.y = 0;
    player.onGround = true;
  }

  player.pos.copy(nextPos);
  camera.position.copy(player.pos);

  if (gameMode === 'multiplayer' && remotePlayerMesh && remotePlayerMesh.visible) {
    remotePlayerMesh.position.lerp(remotePlayerState.pos, 0.3);
    remotePlayerMesh.rotation.y = remotePlayerState.rotY;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  updatePhysics(delta);
  updateBots(delta);
  renderer.render(scene, camera);
}

window.addEventListener('DOMContentLoaded', () => {
  initEngine();
  animate();
});
