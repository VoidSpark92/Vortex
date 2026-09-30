// ========================================================
// VORTEX // Solid Collision Physics + P2P WebRTC 1v1 Engine
// ========================================================

let scene, camera, renderer, clock;
let isGameRunning = false;
let isAiming = false;
let isPointerLocked = false;

// Player Physics & State
const player = {
  pos: new THREE.Vector3(0, 2, 20),
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

// Solid Colliders Array
const solidBoxes = [];

// Multiplayer State (PeerJS P2P)
let peer = null;
let peerConn = null;
let isMultiplayer = false;
let remotePlayerMesh = null;
let remotePlayerState = { pos: new THREE.Vector3(0, 2, -20), rotY: 0, hp: 100 };

// Weapon Visuals
let rifleGroup, muzzleLight;

// ========================================================
// 1. Initializer & Arena Setup
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
  bindControls();
  initPeerNetworking();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ========================================================
// 2. Solid Arena & Collision Bounds Registration
// ========================================================
function buildSolidArena() {
  // Ground
  const floorGeo = new THREE.PlaneGeometry(240, 240);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xdfd2be, roughness: 0.9 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Concrete Material
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6 });
  const coverMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4 });

  // Helper to add Solid Objects with Collision Bounds
  function addSolidBox(size, pos, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Compute bounding box for collision detection
    const box = new THREE.Box3();
    box.setFromObject(mesh);
    solidBoxes.push(box);
  }

  // 4 Outer Perimeter Boundary Walls
  addSolidBox([220, 10, 4], [0, 5, -110], wallMat);
  addSolidBox([220, 10, 4], [0, 5, 110], wallMat);
  addSolidBox([4, 10, 220], [-110, 5, 0], wallMat);
  addSolidBox([4, 10, 220], [110, 5, 0], wallMat);

  // Tactical Covers (Boxes player CANNOT walk through)
  const coverList = [
    { size: [6, 4, 3], pos: [-12, 2, -12] },
    { size: [6, 4, 3], pos: [12, 2, -12] },
    { size: [6, 4, 3], pos: [-12, 2, 12] },
    { size: [6, 4, 3], pos: [12, 2, 12] },
    { size: [10, 5, 4], pos: [0, 2.5, 0] },     // Center bunker
    { size: [4, 4, 12], pos: [-35, 2, 0] },
    { size: [4, 4, 12], pos: [35, 2, 0] }
  ];

  coverList.forEach(c => addSolidBox(c.size, c.pos, coverMat));
}

// ========================================================
// 3. Remote Rival Player Model (1v1 Opponent)
// ========================================================
function buildRemotePlayerModel() {
  remotePlayerMesh = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe11d48 }); // Red Rival
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.4), bodyMat);
  torso.position.y = 1.6;
  remotePlayerMesh.add(torso);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 16), new THREE.MeshStandardMaterial({ color: 0xffedd5 }));
  head.position.y = 2.45;
  remotePlayerMesh.add(head);

  // Gun
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6), darkMat);
  gun.position.set(0.45, 1.4, -0.4);
  remotePlayerMesh.add(gun);

  remotePlayerMesh.position.set(0, 0, -20);
  remotePlayerMesh.visible = false;
  scene.add(remotePlayerMesh);
}

// ========================================================
// 4. Solid AABB Collision Resolution Algorithm
// ========================================================
function resolveCollisions(newPos) {
  const pMinX = newPos.x - player.radius;
  const pMaxX = newPos.x + player.radius;
  const pMinZ = newPos.z - player.radius;
  const pMaxZ = newPos.z + player.radius;

  for (let i = 0; i < solidBoxes.length; i++) {
    const box = solidBoxes[i];

    // Check overlap on X and Z axis
    if (pMaxX > box.min.x && pMinX < box.max.x &&
        pMaxZ > box.min.z && pMinZ < box.max.z &&
        newPos.y < box.max.y) {

      // Determine shallowest penetration axis to push player back
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
// 5. Weapon & Shooting Mechanics
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
  document.getElementById('ammoCurrent').innerText = player.ammo;

  // Recoil
  rifleGroup.position.z += 0.08;
  setTimeout(() => rifleGroup.position.z = isAiming ? -0.38 : -0.55, 70);

  muzzleLight.intensity = 5;
  setTimeout(() => muzzleLight.intensity = 0, 40);

  // Send Shoot Event to Rival
  if (peerConn && peerConn.open) {
    peerConn.send({ type: 'shoot' });
  }

  // Raycast Hit Check on Remote Player
  if (isMultiplayer && remotePlayerMesh.visible) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    const hit = raycaster.intersectObjects(remotePlayerMesh.children, false);
    if (hit.length > 0) {
      // Hit rival!
      peerConn.send({ type: 'hit', damage: 34 });
    }
  }
}

function reloadWeapon() {
  if (player.isReloading || player.ammo === player.maxAmmo) return;
  player.isReloading = true;
  document.getElementById('ammoCurrent').innerText = '--';
  rifleGroup.position.y -= 0.2;

  setTimeout(() => {
    player.ammo = player.maxAmmo;
    player.isReloading = false;
    rifleGroup.position.y = -0.25;
    document.getElementById('ammoCurrent').innerText = player.ammo;
  }, 1200);
}

// ========================================================
// 6. PeerJS Direct 1v1 P2P Networking
// ========================================================
function initPeerNetworking() {
  // Generate random 4-digit room code
  const code = 'VORTEX-' + Math.floor(1000 + Math.random() * 9000);
  peer = new Peer(code);

  peer.on('open', id => {
    document.getElementById('myPeerId').value = id;
  });

  // When friend connects to us
  peer.on('connection', conn => {
    peerConn = conn;
    setupNetworkListeners();
    startBattleSession();
  });
}

function copyMyId() {
  const field = document.getElementById('myPeerId');
  navigator.clipboard.writeText(field.value);
  alert('Room ID copied! Send this to your friend.');
}

function joinFriend() {
  const friendId = document.getElementById('friendPeerId').value.trim();
  if (!friendId) { alert('Enter Friend Room ID!'); return; }

  peerConn = peer.connect(friendId);
  setupNetworkListeners();
  startBattleSession();
}

function setupNetworkListeners() {
  peerConn.on('open', () => {
    isMultiplayer = true;
    remotePlayerMesh.visible = true;
    document.getElementById('connectionStatus').innerText = '1v1 LIVE';
    document.getElementById('connectionStatus').style.color = '#10b981';

    // Broadcast our position every 30ms (33 FPS network tick)
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
      // We were hit by friend
      player.health = Math.max(0, player.health - data.damage);
      document.getElementById('hpText').innerText = player.health;
      document.getElementById('hpBar').style.width = player.health + '%';

      if (player.health <= 0) {
        // Friend gets point
        const redScore = document.getElementById('redScore');
        redScore.innerText = parseInt(redScore.innerText) + 1;
        peerConn.send({ type: 'died' });
        respawnPlayer();
      }
    } else if (data.type === 'died') {
      // We eliminated friend
      const blueScore = document.getElementById('blueScore');
      blueScore.innerText = parseInt(blueScore.innerText) + 1;
    }
  });
}

function startBattleSession() {
  document.getElementById('lobbyScreen').style.display = 'none';
  document.getElementById('gameHUD').style.display = 'flex';
  isGameRunning = true;
  if (!('ontouchstart' in window)) document.getElementById('gameViewport').requestPointerLock();
}

function startSinglePractice() {
  startBattleSession();
}

function respawnPlayer() {
  player.health = 100;
  player.pos.set((Math.random() - 0.5) * 40, 2, 35);
  camera.position.copy(player.pos);
  document.getElementById('hpText').innerText = '100';
  document.getElementById('hpBar').style.width = '100%';
}

// ========================================================
// 7. Physics, Collision & Input Loop
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
  vp.addEventListener('click', () => { if (isGameRunning) vp.requestPointerLock(); });

  window.addEventListener('mousemove', e => {
    if (document.pointerLockElement !== vp) return;
    player.rot.y -= e.movementX * 0.0022;
    player.rot.x -= e.movementY * 0.0022;
    player.rot.x = Math.max(-1.4, Math.min(1.4, player.rot.x));
  });

  window.addEventListener('mousedown', e => {
    if (document.pointerLockElement !== vp) return;
    if (e.button === 0) fireWeapon();
  });

  document.getElementById('btnFire').addEventListener('touchstart', (e) => { e.preventDefault(); fireWeapon(); });
  document.getElementById('btnReload').addEventListener('touchstart', (e) => { e.preventDefault(); reloadWeapon(); });
  document.getElementById('btnJump').addEventListener('touchstart', (e) => {
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

  // Predict new intended position
  const nextPos = player.pos.clone();
  nextPos.x += player.vel.x * delta;
  nextPos.z += player.vel.z * delta;
  nextPos.y += player.vel.y * delta;

  // Solid Collision Resolution Against Boxes
  resolveCollisions(nextPos);

  // Ground check
  if (nextPos.y <= 2) {
    nextPos.y = 2;
    player.vel.y = 0;
    player.onGround = true;
  }

  player.pos.copy(nextPos);
  camera.position.copy(player.pos);

  // Interpolate Remote Rival Position
  if (remotePlayerMesh && remotePlayerMesh.visible) {
    remotePlayerMesh.position.lerp(remotePlayerState.pos, 0.3);
    remotePlayerMesh.rotation.y = remotePlayerState.rotY;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  updatePhysics(delta);
  renderer.render(scene, camera);
}

window.addEventListener('DOMContentLoaded', () => {
  initEngine();
  animate();
});
