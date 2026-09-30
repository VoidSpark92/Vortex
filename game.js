// ========================================================
// VORTEX // Core 3D FPS & Mobile HUD Engine
// Three.js Tactical Arena + PBR Lighting + Cross-Platform Input
// ========================================================

// --- Global Engine Variables ---
let scene, camera, renderer, clock;
let isGameRunning = false;
let isAiming = false;
let isPointerLocked = false;

// Player Physics & State
const player = {
  pos: new THREE.Vector3(0, 2, 0),
  vel: new THREE.Vector3(0, 0, 0),
  rot: new THREE.Euler(0, 0, 0, 'YXZ'),
  onGround: true,
  health: 100,
  maxHealth: 100,
  ammo: 30,
  maxAmmo: 30,
  reserveAmmo: 90,
  isReloading: false
};

const MOVE_SPEED = 14;
const GRAVITY = 32;
const JUMP_FORCE = 11;

// PC Input Map
const keys = { w: false, a: false, s: false, d: false, space: false };

// Mobile Touch Control State
const touchState = {
  joystickActive: false,
  joystickOrigin: { x: 0, y: 0 },
  joystickVector: { x: 0, y: 0 },
  lookTouchId: null,
  lookLastPos: { x: 0, y: 0 }
};

// Target Dummies & Impact Particles
const targets = [];
const particles = [];
let rifleGroup, muzzleLight;

// ========================================================
// 1. Initializer & Daylight Arena Setup
// ========================================================
function initEngine() {
  const container = document.getElementById('gameViewport');

  // Scene & Fog (Soft Daylight Blue Horizon)
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe3f7);
  scene.fog = new THREE.FogExp2(0xbfe3f7, 0.008);

  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 800);
  camera.position.set(0, 2, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  clock = new THREE.Clock();

  // Natural Daylight PBR Lighting
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xd4bda5, 0.7);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
  sunLight.position.set(45, 80, 40);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 250;
  const shadowRange = 80;
  sunLight.shadow.camera.left = -shadowRange;
  sunLight.shadow.camera.right = shadowRange;
  sunLight.shadow.camera.top = shadowRange;
  sunLight.shadow.camera.bottom = -shadowRange;
  scene.add(sunLight);

  buildBrightArena();
  buildAssaultRifle();
  spawnTargetDummies();
  bindInputEvents();
  loadSavedHUDLayout();

  window.addEventListener('resize', onWindowResize);
}

// ========================================================
// 2. Smooth Modern Map (Sand Arena, Tactical Bunkers)
// ========================================================
function buildBrightArena() {
  // Smooth Sand / Concrete Ground
  const floorGeo = new THREE.PlaneGeometry(240, 240);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xdfd2be,
    roughness: 0.9,
    metalness: 0.05
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Outer Perimeter Walls (Clean Concrete)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6 });
  const arenaHalf = 110;
  const wallConfigs = [
    { size: [220, 10, 4], pos: [0, 5, -arenaHalf] },
    { size: [220, 10, 4], pos: [0, 5, arenaHalf] },
    { size: [4, 10, 220], pos: [-arenaHalf, 5, 0] },
    { size: [4, 10, 220], pos: [arenaHalf, 5, 0] }
  ];

  wallConfigs.forEach(w => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(...w.size), wallMat);
    wall.position.set(...w.pos);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  });

  // Tactical Bunkers, Rounded Pillars & Cover Blocks
  const coverMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.4 });
  const coverPositions = [
    [-15, 2, -18], [15, 2, -18], [-18, 2, 20], [18, 2, 20],
    [-35, 3, 0], [35, 3, 0], [0, 2.5, -45], [0, 2.5, 45]
  ];

  coverPositions.forEach(p => {
    const cover = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 3), coverMat);
    cover.position.set(...p);
    cover.castShadow = true;
    cover.receiveShadow = true;
    scene.add(cover);
  });

  // Central Training Platform
  const centerPlat = new THREE.Mesh(
    new THREE.CylinderGeometry(14, 15, 1.2, 32),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.5, metalness: 0.2 })
  );
  centerPlat.position.set(0, 0.6, 0);
  centerPlat.receiveShadow = true;
  scene.add(centerPlat);
}

// ========================================================
// 3. Realistic Assault Rifle Model
// ========================================================
function buildAssaultRifle() {
  rifleGroup = new THREE.Group();

  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 });

  // Main Receiver & Barrel
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.65), gunMat);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 16), gunMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.45);

  // Magazine & Grip
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.1), trimMat);
  mag.position.set(0, -0.14, -0.05);
  mag.rotation.x = 0.2;

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.08), gunMat);
  grip.position.set(0, -0.12, 0.18);
  grip.rotation.x = -0.3;

  // Red Dot Scope
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 16), gunMat);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.12, 0.02);

  rifleGroup.add(body, barrel, mag, grip, scope);

  // Muzzle Flash PointLight
  muzzleLight = new THREE.PointLight(0xffaa00, 0, 15);
  muzzleLight.position.set(0, 0.03, -0.7);
  rifleGroup.add(muzzleLight);

  rifleGroup.position.set(0.28, -0.25, -0.55);
  camera.add(rifleGroup);
  scene.add(camera);
}

// ========================================================
// 4. Target Dummies (Hit React & Damage Test)
// ========================================================
function spawnTargetDummies() {
  const dummyLocations = [
    [-12, 0, -28], [12, 0, -28], [0, 0, -55],
    [-25, 0, -10], [25, 0, -10], [-8, 0, 32], [8, 0, 32]
  ];

  dummyLocations.forEach(loc => {
    const dummyGroup = new THREE.Group();
    dummyGroup.position.set(...loc);

    const mat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.6 });

    // Torso
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 1.4, 16), mat);
    torso.position.y = 1.6;
    torso.castShadow = true;

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    head.position.y = 2.65;
    head.castShadow = true;

    dummyGroup.add(torso, head);
    dummyGroup.userData = { hp: 100, isTarget: true };

    scene.add(dummyGroup);
    targets.push(dummyGroup);
  });
}

// ========================================================
// 5. Shooting & Hit Detection (Raycasting)
// ========================================================
function fireWeapon() {
  if (!isGameRunning || player.isReloading) return;
  if (player.ammo <= 0) {
    reloadWeapon();
    return;
  }

  player.ammo--;
  updateHUDAmmo();

  // Recoil Animation
  rifleGroup.position.z += 0.08;
  rifleGroup.rotation.x += 0.06;
  setTimeout(() => {
    rifleGroup.position.z = isAiming ? -0.38 : -0.55;
    rifleGroup.rotation.x = 0;
  }, 70);

  // Muzzle Light Flash
  muzzleLight.intensity = 5;
  setTimeout(() => muzzleLight.intensity = 0, 45);

  // Center Screen Raycast
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  // Collect target meshes
  const hitCandidates = [];
  targets.forEach(t => t.children.forEach(c => hitCandidates.push(c)));

  const intersects = raycaster.intersectObjects(hitCandidates, false);

  if (intersects.length > 0) {
    const hit = intersects[0];
    const parentDummy = hit.object.parent;

    // Impact Sparks
    createImpactSparks(hit.point);

    if (parentDummy && parentDummy.userData.isTarget) {
      parentDummy.userData.hp -= 34;

      // Hit Reaction Jolt
      parentDummy.position.y -= 0.15;
      setTimeout(() => parentDummy.position.y += 0.15, 100);

      // Dummy Elimination & Respawn
      if (parentDummy.userData.hp <= 0) {
        parentDummy.position.y = -20; // Hide
        const blueScore = document.getElementById('blueScore');
        blueScore.innerText = parseInt(blueScore.innerText) + 1;

        setTimeout(() => {
          parentDummy.userData.hp = 100;
          parentDummy.position.y = 0;
        }, 3000);
      }
    }
  }
}

function createImpactSparks(pos) {
  for (let i = 0; i < 8; i++) {
    particles.push({
      x: pos.x, y: pos.y, z: pos.z,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 4,
      vz: (Math.random() - 0.5) * 4,
      life: 0.25
    });
  }
}

function reloadWeapon() {
  if (player.isReloading || player.ammo === player.maxAmmo || player.reserveAmmo <= 0) return;
  player.isReloading = true;

  const ammoCurrentElem = document.getElementById('ammoCurrent');
  ammoCurrentElem.innerText = '--';

  // Lower weapon during reload
  rifleGroup.position.y -= 0.2;

  setTimeout(() => {
    const needed = player.maxAmmo - player.ammo;
    const toLoad = Math.min(needed, player.reserveAmmo);
    player.ammo += toLoad;
    player.reserveAmmo -= toLoad;
    player.isReloading = false;

    rifleGroup.position.y = -0.25;
    updateHUDAmmo();
  }, 1200);
}

function toggleAim(forcedState = null) {
  isAiming = forcedState !== null ? forcedState : !isAiming;

  if (isAiming) {
    camera.fov = 42; // Zoom in
    rifleGroup.position.set(0, -0.16, -0.38); // Center weapon on screen
  } else {
    camera.fov = 72; // Normal FOV
    rifleGroup.position.set(0.28, -0.25, -0.55);
  }
  camera.updateProjectionMatrix();
}

function updateHUDAmmo() {
  document.getElementById('ammoCurrent').innerText = player.ammo;
  document.getElementById('ammoReserve').innerText = player.reserveAmmo;
}

// ========================================================
// 6. Cross-Platform Input (Mouse, Pointer Lock & Touch)
// ========================================================
function bindInputEvents() {
  // PC Keyboard
  window.addEventListener('keydown', e => {
    switch (e.code) {
      case 'KeyW': keys.w = true; break;
      case 'KeyA': keys.a = true; break;
      case 'KeyS': keys.s = true; break;
      case 'KeyD': keys.d = true; break;
      case 'Space':
        if (player.onGround) {
          player.vel.y = JUMP_FORCE;
          player.onGround = false;
        }
        break;
      case 'KeyR': reloadWeapon(); break;
    }
  });

  window.addEventListener('keyup', e => {
    switch (e.code) {
      case 'KeyW': keys.w = false; break;
      case 'KeyA': keys.a = false; break;
      case 'KeyS': keys.s = false; break;
      case 'KeyD': keys.d = false; break;
    }
  });

  // Pointer Lock API (PC Mouse Look)
  const viewport = document.getElementById('gameViewport');
  viewport.addEventListener('click', () => {
    if (isGameRunning && !isPointerLocked) {
      viewport.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = (document.pointerLockElement === viewport);
  });

  window.addEventListener('mousemove', e => {
    if (!isPointerLocked) return;
    const sensitivity = 0.0022;
    player.rot.y -= e.movementX * sensitivity;
    player.rot.x -= e.movementY * sensitivity;
    player.rot.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, player.rot.x));
  });

  window.addEventListener('mousedown', e => {
    if (!isPointerLocked) return;
    if (e.button === 0) fireWeapon();
    if (e.button === 2) toggleAim(true);
  });

  window.addEventListener('mouseup', e => {
    if (e.button === 2) toggleAim(false);
  });

  window.addEventListener('contextmenu', e => e.preventDefault());

  // Mobile Touch Controls
  bindMobileTouchControls();
}

function bindMobileTouchControls() {
  const joystick = document.getElementById('touchJoystick');
  const knob = document.getElementById('joystickKnob');

  // Virtual Joystick Touch Handling
  joystick.addEventListener('touchstart', e => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = joystick.getBoundingClientRect();
    touchState.joystickActive = true;
    touchState.joystickOrigin = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    if (!isGameRunning) return;

    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];

      // Joystick Movement (Left screen)
      if (touchState.joystickActive && t.clientX < window.innerWidth / 2) {
        const dx = t.clientX - touchState.joystickOrigin.x;
        const dy = t.clientY - touchState.joystickOrigin.y;
        const dist = Math.hypot(dx, dy);
        const maxRadius = 45;
        const angle = Math.atan2(dy, dx);
        const clampedDist = Math.min(dist, maxRadius);

        knob.style.transform = `translate(${Math.cos(angle) * clampedDist}px, ${Math.sin(angle) * clampedDist}px)`;

        touchState.joystickVector.x = (Math.cos(angle) * clampedDist) / maxRadius;
        touchState.joystickVector.y = (Math.sin(angle) * clampedDist) / maxRadius;
      }

      // Camera Aim Drag (Right screen)
      if (t.clientX >= window.innerWidth / 2) {
        if (touchState.lookTouchId === null) {
          touchState.lookTouchId = t.identifier;
          touchState.lookLastPos = { x: t.clientX, y: t.clientY };
        } else if (touchState.lookTouchId === t.identifier) {
          const deltaX = t.clientX - touchState.lookLastPos.x;
          const deltaY = t.clientY - touchState.lookLastPos.y;
          touchState.lookLastPos = { x: t.clientX, y: t.clientY };

          player.rot.y -= deltaX * 0.005;
          player.rot.x -= deltaY * 0.005;
          player.rot.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, player.rot.x));
        }
      }
    }
  }, { passive: false });

  window.addEventListener('touchend', e => {
    // Reset joystick if released
    let hasLeftTouch = false;
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].clientX < window.innerWidth / 2) hasLeftTouch = true;
      if (e.touches[i].identifier === touchState.lookTouchId) touchState.lookTouchId = null;
    }

    if (!hasLeftTouch) {
      touchState.joystickActive = false;
      touchState.joystickVector = { x: 0, y: 0 };
      knob.style.transform = 'translate(0px, 0px)';
    }
  });

  // Action Buttons
  document.getElementById('btnFire').addEventListener('touchstart', e => { e.preventDefault(); fireWeapon(); });
  document.getElementById('btnAim').addEventListener('touchstart', e => { e.preventDefault(); toggleAim(); });
  document.getElementById('btnReload').addEventListener('touchstart', e => { e.preventDefault(); reloadWeapon(); });
  document.getElementById('btnJump').addEventListener('touchstart', e => {
    e.preventDefault();
    if (player.onGround) {
      player.vel.y = JUMP_FORCE;
      player.onGround = false;
    }
  });
}

// ========================================================
// 7. Physics & Movement Frame Update
// ========================================================
function updatePhysics(delta) {
  if (!isGameRunning) return;

  // Apply Rotation to Camera
  camera.rotation.copy(player.rot);

  // Direction Vectors
  const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rot.y);
  const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rot.y);

  const moveDir = new THREE.Vector3();

  // Combine PC + Mobile Joystick inputs
  if (keys.w) moveDir.add(forward);
  if (keys.s) moveDir.add(forward.clone().negate());
  if (keys.a) moveDir.add(right.clone().negate());
  if (keys.d) moveDir.add(right);

  if (touchState.joystickActive) {
    moveDir.add(right.clone().multiplyScalar(touchState.joystickVector.x));
    moveDir.add(forward.clone().multiplyScalar(-touchState.joystickVector.y));
  }

  if (moveDir.lengthSq() > 0) moveDir.normalize();

  // Horizontal Velocity
  player.vel.x = moveDir.x * MOVE_SPEED;
  player.vel.z = moveDir.z * MOVE_SPEED;

  // Gravity
  player.vel.y -= GRAVITY * delta;

  // Integrate Position
  player.pos.x += player.vel.x * delta;
  player.pos.y += player.vel.y * delta;
  player.pos.z += player.vel.z * delta;

  // Arena Floor Collision
  if (player.pos.y <= 2) {
    player.pos.y = 2;
    player.vel.y = 0;
    player.onGround = true;
  }

  // Arena Boundaries (-105 to 105)
  player.pos.x = Math.max(-105, Math.min(105, player.pos.x));
  player.pos.z = Math.max(-105, Math.min(105, player.pos.z));

  camera.position.copy(player.pos);
}

// ========================================================
// 8. Customizable Mobile HUD Editor Engine
// ========================================================
let isEditingHUD = false;

function openHUDEditor() {
  isEditingHUD = true;
  document.getElementById('lobbyScreen').style.display = 'none';
  document.getElementById('gameHUD').style.display = 'flex';
  document.getElementById('hudEditorModal').style.display = 'block';

  // Enable dragging on all HUD action elements
  document.querySelectorAll('.hud-element').forEach(elem => {
    makeElementDraggable(elem);
  });
}

function makeElementDraggable(el) {
  let startX, startY, initLeft, initTop;

  function onTouchStart(e) {
    if (!isEditingHUD) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    const rect = el.getBoundingClientRect();
    initLeft = rect.left;
    initTop = rect.top;

    el.style.bottom = 'auto';
    el.style.right = 'auto';
    el.style.left = initLeft + 'px';
    el.style.top = initTop + 'px';
  }

  function onTouchMove(e) {
    if (!isEditingHUD) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    el.style.left = (initLeft + dx) + 'px';
    el.style.top = (initTop + dy) + 'px';
  }

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: true });
}

function saveHUDLayout() {
  const layout = {};
  document.querySelectorAll('.hud-element').forEach(el => {
    const id = el.getAttribute('data-id');
    layout[id] = {
      left: el.style.left,
      top: el.style.top,
      bottom: el.style.bottom,
      right: el.style.right
    };
  });

  localStorage.setItem('vortex_custom_hud', JSON.stringify(layout));
  isEditingHUD = false;
  document.getElementById('hudEditorModal').style.display = 'none';
  document.getElementById('lobbyScreen').style.display = 'flex';
  document.getElementById('gameHUD').style.display = 'none';
}

function resetHUD() {
  localStorage.removeItem('vortex_custom_hud');
  location.reload();
}

function loadSavedHUDLayout() {
  const saved = localStorage.getItem('vortex_custom_hud');
  if (!saved) return;

  const layout = JSON.parse(saved);
  document.querySelectorAll('.hud-element').forEach(el => {
    const id = el.getAttribute('data-id');
    if (layout[id]) {
      el.style.left = layout[id].left || 'auto';
      el.style.top = layout[id].top || 'auto';
      el.style.bottom = layout[id].bottom || 'auto';
      el.style.right = layout[id].right || 'auto';
    }
  });
}

// ========================================================
// 9. Match Lifecycle & Lobby Integration
// ========================================================
function selectMode(mode, btnElement) {
  document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
  btnElement.classList.add('active');
}

function startGame() {
  document.getElementById('lobbyScreen').style.display = 'none';
  document.getElementById('gameHUD').style.display = 'flex';
  isGameRunning = true;

  // Request pointer lock on desktop
  if (!('ontouchstart' in window)) {
    document.getElementById('gameViewport').requestPointerLock();
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ========================================================
// 10. Core Game Render Loop
// ========================================================
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
