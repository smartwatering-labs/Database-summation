// One scene is shared by all routes. Frame the visible assembly, not removed shells.
import { productStudio } from './product-studio.js';
const stage = document.querySelector('#model-stage');
const canvas = document.querySelector('#model-canvas');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let route = 'home', config, THREE, renderer, scene, camera, rig, root, environment;
let ready = false, disposed = false, lost = false, frame = 0, open = 0;
let width = 0, height = 0, parts = [], textures = [], frames = {};
let poseTween, manualTarget, drag, pinch, interactive = false, interactionRequested = false;
let resolveSettled, settledPromise = Promise.resolve(), lastFrameTime = 0, captureRequest;
let zoom = 1, targetZoom = 1, resetZoom = 1;
let layoutDirty = true, layout, renderWidth = 0, renderHeight = 0;
let floor, floorRig, baseShell, floorHeight;
let groundOpacity = 0, groundTarget = 0, groundTween;
const orbit = { yaw: 0, pitch: 0 };
const pointers = new Map();
const CAMERA_HEIGHT = 6;
const displayPixelRatio = () => Math.min(devicePixelRatio, productStudio.renderer.maxPixelRatio,
  Math.sqrt(productStudio.renderer.maxViewportPixels / Math.max(1, innerWidth * innerHeight)));

function wake() {
  if (ready && !disposed && !lost && !document.hidden && !frame) frame = requestAnimationFrame(tick);
}
function settle() {
  stage.dataset.moving = 'false';
  resolveSettled?.(); resolveSettled = null;
}
function partState(part, page) {
  const state = part.config.states?.[page] || {};
  return { position: part.base.clone().add(new THREE.Vector3(...(state.offset || [0, 0, 0]))), opacity: state.opacity ?? 1 };
}
function applyPartOpacity(part, opacity) {
  part.node.visible = opacity > .001;
  if (part.opacity === opacity) return;
  part.opacity = opacity;
  for (const mesh of part.meshes) {
    mesh.castShadow = opacity > .995;
    for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
      // Keep shell shaders transparent-capable; fading must not recompile them mid-transition.
      material.opacity = opacity;
      // Keep occlusion stable throughout the fade; changing this near opacity=1
      // suddenly removes the overlapping back faces and makes the shell pop.
      material.depthWrite = true;
    }
  }
}
function visibleBounds() {
  scene.updateMatrixWorld(true);
  const result = new THREE.Box3();
  root.traverseVisible(node => {
    if (!node.isMesh) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    result.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
  });
  return result;
}
function prepareFrames(unit) {
  for (const [page, pose] of Object.entries(config.poses)) {
    for (const part of parts) {
      const state = partState(part, page);
      part.node.position.copy(state.position); applyPartOpacity(part, state.opacity);
    }
    rig.quaternion.identity(); root.position.set(0, 0, 0);
    // Each route has its own pivot, regardless of which URL was opened first.
    const focus = visibleBounds().getCenter(new THREE.Vector3()).multiplyScalar(-1 / unit);
    root.position.copy(focus);
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.rotation, pose.rotationOrder || 'YXZ'));
    rig.quaternion.copy(quaternion);
    const bounds = visibleBounds();
    frames[page] = { focus, quaternion, size: bounds.getSize(new THREE.Vector3()), center: bounds.getCenter(new THREE.Vector3()) };
  }
}
function createGround(normalized) {
  baseShell = parts.find(p => p.config.kind === 'shell' && p.config.name !== '外壳-顶盖');
  if (!baseShell) return;
  const saved = baseShell.node.position.clone(); baseShell.node.position.copy(baseShell.base);
  scene.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(), bounds = new THREE.Box3();
  for (const mesh of baseShell.meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)));
  }
  baseShell.node.position.copy(saved);
  const settings = productStudio.ground, size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const zUp = config.upAxis === 'z';
  floorHeight = (zUp ? bounds.min.z : bounds.min.y) - settings.gap;
  floor = new THREE.Mesh(new THREE.PlaneGeometry(size.x * settings.sizeRatio, (zUp ? size.y : size.z) * settings.sizeRatio),
    new THREE.ShadowMaterial({ opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  floor.name = 'studio-shadow-receiver'; floor.receiveShadow = true; floor.renderOrder = -1;
  floor.position.set(center.x, zUp ? center.y : floorHeight, zUp ? floorHeight : center.z);
  if (!zUp) floor.rotation.x = -Math.PI / 2;
  floorRig = new THREE.Group(); floorRig.rotation.copy(root.rotation); floorRig.add(floor); normalized.add(floorRig);
  stage.dataset.ground = 'geometry-shadow';
}
function layoutFor(page) {
  const pose = config.poses[page], reference = frames[page];
  const frameConfig = innerWidth < 768 || (page === 'product' && innerWidth < 1200) ? pose.frame.mobile : pose.frame.desktop;
  const cameraWidth = CAMERA_HEIGHT * width / height;
  let centerY = frameConfig.center[1] * height, availableHeight = height * frameConfig.fill[1];
  const main = document.querySelector('#main');
  // The product occupies an explicit column/row in the page grid. Measure that
  // region so model framing and copy share one layout, including sidebar resize.
  const region = main?.dataset.route === page ? main.querySelector('.hero-visual-region') : null;
  if (region) {
    const box = region.getBoundingClientRect(), stageBox = stage.getBoundingClientRect();
    // Reserve room for the real ground shadow as well as the assembly bounds.
    const inset = page === 'product' ? (innerWidth < 768 ? 14 : 10) : (innerWidth < 768 ? 20 : 24);
    const captionHeight = page === 'product' && innerWidth >= 1200 ? 0 : 56;
    const usableWidth = Math.max(80, box.width - inset * 2);
    const usableHeight = Math.max(80, box.height - inset * 2 - captionHeight);
    const tallPoster = Math.min(1, Math.max(0, (innerHeight - 720) / 180));
    const posterScale = page === 'home'
      ? (innerWidth < 768 ? 1.16 : innerWidth < 960 ? 1.18 : 1.23)
      : (innerWidth < 768 ? 1.12 : innerWidth < 960 ? 1.10 : innerWidth < 1200 ? 1.14 : 1.10 + .04 * tallPoster);
    // On shorter wide posters, leave enough canvas below the case for the soft shadow.
    const shadowClearance = Math.min(112, Math.max(96, stageBox.height * .12));
    const safePosterScale = page === 'product' && innerWidth >= 1200
      ? Math.min(posterScale, (stageBox.height - shadowClearance) / usableHeight) : posterScale;
    const scale = Math.min(CAMERA_HEIGHT * usableWidth / height / reference.size.x,
      CAMERA_HEIGHT * usableHeight / height / reference.size.y) * safePosterScale;
    const details = page === 'home' && innerWidth >= 960 ? main.querySelector('.hero-side-stack') : null;
    // Balance the home model between the visible copy column and the right edge.
    const x = details
      ? (details.getBoundingClientRect().right + stageBox.right) / 2 - stageBox.left
      : box.left - stageBox.left + box.width / 2;
    // Leave a little more room below the exploded assembly for its ground shadow.
    const productLift = page === 'product' && innerWidth >= 960
      ? Math.min(20, Math.max(10, (stageBox.height - 500) * .04)) : 0;
    const y = page === 'product'
      ? (innerWidth >= 960 ? stageBox.height / 2 - productLift : box.top - stageBox.top + box.height / 2)
      : box.top - stageBox.top + inset + usableHeight / 2;
    return { scale, x: (x / width - .5) * cameraWidth - reference.center.x * scale,
      y: (.5 - y / height) * CAMERA_HEIGHT - reference.center.y * scale };
  }
  const copy = main?.dataset.route === page ? main.querySelector('.hero-copy') : null;
  let top = 16, bottom = height;
  const besideCopy = page === 'product' && innerWidth >= 1200;
  if (copy && !besideCopy) {
    const stageTop = stage.getBoundingClientRect().top;
    const clearance = page === 'home' ? 20 : 28;
    bottom = Math.min(height, copy.getBoundingClientRect().top - stageTop - clearance);
    // The headline bounds the home model vertically. The auxiliary controls
    // sit to its right; reserving their whole row pushes the product upward.
    const heading = main.querySelector('.hero-product-heading');
    if (heading) top = Math.max(top, heading.getBoundingClientRect().bottom - stageTop + 12);
    availableHeight = Math.min(availableHeight, Math.max(80, bottom - top));
  }
  let scale = Math.min(cameraWidth * frameConfig.fill[0] / reference.size.x, CAMERA_HEIGHT * availableHeight / height / reference.size.y);
  let centerX = page === 'product' && !besideCopy ? .5 : frameConfig.center[0];
  if (copy && besideCopy) {
    const stageLeft = stage.getBoundingClientRect().left;
    const textRight = copy.getBoundingClientRect().right - stageLeft + 20;
    const rightEdge = width - 16;
    const usableWidth = Math.max(80, rightEdge - textRight);
    scale = Math.min(scale, CAMERA_HEIGHT * usableWidth / height / reference.size.x);
    const halfWidth = reference.size.x * scale * height / CAMERA_HEIGHT / 2;
    centerX = THREE.MathUtils.clamp(centerX * width, textRight + halfWidth, rightEdge - halfWidth) / width;
  }
  if (copy && !besideCopy) {
    const halfModel = reference.size.y * scale * height / CAMERA_HEIGHT / 2;
    centerY = THREE.MathUtils.clamp(centerY, top + halfModel, Math.max(top + halfModel, bottom - halfModel));
  }
  return {
    scale,
    x: (centerX - .5) * cameraWidth - reference.center.x * scale,
    y: (.5 - centerY / height) * CAMERA_HEIGHT - reference.center.y * scale,
  };
}
function cancelPointers() {
  const ids = [...pointers.keys()];
  pointers.clear(); drag = null; pinch = null;
  for (const id of ids) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}
function beginPose(duration = 420) {
  layoutDirty = true;
  cancelPointers(); manualTarget = null;
  resolveSettled?.(); settledPromise = new Promise(resolve => resolveSettled = resolve);
  if (!ready || lost) { settle(); return; }
  const partStates = parts.map(part => {
    const target = partState(part, route);
    return { part, startPosition: part.node.position.clone(), targetPosition: target.position, startOpacity: part.opacity, targetOpacity: target.opacity };
  });
  poseTween = {
    start: performance.now(), duration, quaternion: rig.quaternion.clone(), focus: root.position.clone(),
    position: rig.position.clone(), scale: rig.scale.x, viewport: { width, height }, open, partStates,
  };
  resetZoom = zoom; targetZoom = 1;
  stage.dataset.moving = 'true'; wake();
}
function setInteractive(enabled) {
  interactionRequested = enabled;
  interactive = enabled && ready && !lost;
  stage.dataset.interactive = String(interactive); stage.setAttribute('aria-hidden', String(!interactive));
  canvas.tabIndex = interactive ? 0 : -1; cancelPointers();
  if (!enabled && ready) beginPose();
}
function updateGround(time) {
  if (!floorRig) return;
  floorRig.position.copy(root.position);
  const axis = config.upAxis === 'z' ? 'z' : 'y';
  floor.position[axis] = floorHeight + baseShell.node.position[axis] - baseShell.base[axis];
  const settings = productStudio.ground;
  const target = poseTween ? 0 : route === 'home' ? settings.homeOpacity : route === 'product' ? settings.productOpacity : 0;
  if (target !== groundTarget) {
    groundTarget = target;
    groundTween = { start: time, from: groundOpacity, to: target, duration: target > groundOpacity ? settings.fadeInMs : settings.fadeOutMs };
  }
  if (groundTween) {
    const t = reduced.matches || groundTween.duration <= 0 ? 1 : Math.min(1, Math.max(0, (time - groundTween.start) / groundTween.duration));
    groundOpacity = THREE.MathUtils.lerp(groundTween.from, groundTween.to, t * t * (3 - 2 * t));
    if (t === 1) groundTween = null;
  }
  // Keep the receiver while it fades; toggling it off first would still flash.
  floorRig.visible = groundOpacity > 0 || !!groundTween?.to;
  floor.material.opacity = groundOpacity;
  stage.dataset.shadowMoving = String(!!groundTween);
  stage.dataset.shadowOpacity = groundOpacity.toFixed(4);
}
function tick(time) {
  frame = 0;
  if (!ready || disposed || lost || document.hidden) return;
  const dt = Math.min(50, Math.max(1, time - lastFrameTime)); lastFrameTime = time;
  const w = Math.max(1, Math.round(stage.clientWidth)), h = Math.max(1, Math.round(stage.clientHeight));
  if (width !== w || height !== h) {
    if (poseTween && poseTween.viewport.height) {
      // Route-specific stage heights change instantly. Keep the model's old
      // screen position and pixel size as the animation's starting point.
      const previous = poseTween.viewport, ratio = previous.height / h;
      poseTween.position.x = poseTween.position.x * ratio + 3 * (previous.width - w) / h;
      poseTween.position.y = poseTween.position.y * ratio + 3 * (h - previous.height) / h;
      poseTween.scale *= ratio;
      poseTween.viewport = { width: w, height: h };
    }
    width = w; height = h; layoutDirty = true;
    const ratio = displayPixelRatio();
    if (Math.abs(renderer.getPixelRatio() - ratio) > .01) renderer.setPixelRatio(ratio);
    camera.left = -CAMERA_HEIGHT * w / h / 2; camera.right = -camera.left;
    camera.top = CAMERA_HEIGHT / 2; camera.bottom = -camera.top; camera.updateProjectionMatrix();
  }
  // Tall posters need enough vertical pixels to keep the model sharp. Keep the
  // larger buffer across route changes; release that allocation on viewport resize.
  const desiredHeight = Math.max(innerWidth < 768 ? 680 : 620, Math.min(h, 1600));
  const bufferHeight = renderWidth === w ? Math.max(renderHeight, desiredHeight) : desiredHeight;
  if (renderWidth !== w || renderHeight !== bufferHeight) {
    renderWidth = w; renderHeight = bufferHeight; renderer.setSize(w, bufferHeight, false);
  }
  if (layoutDirty) { layout = layoutFor(route); layoutDirty = false; }
  const target = layout;
  if (poseTween) {
    const a = poseTween, t = reduced.matches ? 1 : Math.min(1, Math.max(0, (time - a.start) / a.duration));
    const p = t * t * (3 - 2 * t), reference = frames[route];
    rig.quaternion.slerpQuaternions(a.quaternion, reference.quaternion, p);
    root.position.lerpVectors(a.focus, reference.focus, p);
    rig.position.set(THREE.MathUtils.lerp(a.position.x, target.x, p), THREE.MathUtils.lerp(a.position.y, target.y, p), 0);
    rig.scale.setScalar(THREE.MathUtils.lerp(a.scale, target.scale, p));
    open = THREE.MathUtils.lerp(a.open, config.poses[route].open, p);
    zoom = THREE.MathUtils.lerp(resetZoom, 1, p);
    for (const state of a.partStates) {
      state.part.node.position.lerpVectors(state.startPosition, state.targetPosition, p);
      applyPartOpacity(state.part, THREE.MathUtils.lerp(state.startOpacity, state.targetOpacity, p));
    }
    if (t === 1) { poseTween = null; zoom = targetZoom = 1; syncOrbit(); }
  } else {
    if (manualTarget) {
      // Pointer movement is already sampled by RAF. A second filter adds hand lag.
      if (drag || reduced.matches) rig.quaternion.copy(manualTarget);
      else rig.quaternion.slerp(manualTarget, 1 - Math.exp(-dt / 16));
      if (rig.quaternion.angleTo(manualTarget) < .0001) { rig.quaternion.copy(manualTarget); manualTarget = null; }
    }
    zoom = pinch || reduced.matches ? targetZoom : THREE.MathUtils.lerp(zoom, targetZoom, 1 - Math.exp(-dt / 45));
    if (Math.abs(zoom - targetZoom) < .0001) zoom = targetZoom;
    rig.scale.setScalar(target.scale * zoom); rig.position.set(target.x, target.y, 0);
  }
  updateGround(time);
  renderer.render(scene, camera);
  if (captureRequest && !poseTween && !manualTarget) {
    const request = captureRequest; captureRequest = null;
    try {
      createImageBitmap(canvas, {
        resizeWidth: Math.max(1, Math.round(canvas.width * .5)),
        resizeHeight: Math.max(1, Math.round(canvas.height * .5)),
        resizeQuality: 'high',
      }).then(request.resolve, () => request.resolve(null));
    } catch { request.resolve(null); }
  }
  stage.dataset.route = route; stage.dataset.open = open.toFixed(4);
  stage.dataset.orientation = rig.quaternion.toArray().join(','); stage.dataset.zoom = zoom.toFixed(4);
  if (poseTween || manualTarget || zoom !== targetZoom) wake(); else settle();
  // Shadow-only frames continue after the pose settles, without delaying page
  // reveal or locking navigation. Interruptions resume from the current alpha.
  if (groundTween) wake();
}
function planarUV(geometry) {
  const p = geometry.attributes.position, n = geometry.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    uv[i * 2] = (ax > ay && ax > az ? p.getY(i) : p.getX(i)) / 6;
    uv[i * 2 + 1] = (az >= ax && az >= ay ? p.getY(i) : p.getZ(i)) / 6;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function moldedGrain() {
  const data = new Uint8Array(256 * 256 * 4); let seed = 9100;
  for (let i = 0; i < data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = 244 + Math.floor((seed >>> 28) * 11 / 16);
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 256, 256);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(7, 7);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true; textures.push(texture); return texture;
}
function studioEnvironment() {
  const settings = productStudio.environment;
  const studio = new THREE.Scene(); studio.background = new THREE.Color(settings.background);
  const geometry = new THREE.PlaneGeometry(1, 1), materials = [];
  // Feathered softbox luminance gives continuous reflections on the CAD fillets
  // rather than uniformly white panels or hard rectangular highlights.
  const pixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const edge = Math.min(x, y, 63 - x, 63 - y) / 12;
    const t = Math.min(1, edge), value = Math.round(255 * (.3 + .7 * t * t * (3 - 2 * t)));
    const i = (y * 64 + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = value; pixels[i + 3] = 255;
  }
  const softbox = new THREE.DataTexture(pixels, 64, 64); softbox.magFilter = softbox.minFilter = THREE.LinearFilter; softbox.needsUpdate = true;
  for (const { position, size, power } of settings.cards) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(power, power, power), map: softbox, side: THREE.DoubleSide });
    const card = new THREE.Mesh(geometry, material);
    card.position.set(...position); card.scale.set(...size, 1); card.lookAt(0, 0, 0);
    studio.add(card); materials.push(material);
  }
  const pmrem = new THREE.PMREMGenerator(renderer); environment = pmrem.fromScene(studio, settings.blur, .1, 100, { size: settings.resolution });
  scene.environment = environment.texture; pmrem.dispose(); geometry.dispose(); softbox.dispose(); materials.forEach(m => m.dispose());
}
function modelMaterial(source, shell, grain) {
  if (shell && source.name === 'shell-silkscreen') return new THREE.MeshStandardMaterial({
    name: source.name, color: 0x161718, metalness: 0, roughness: .82,
    envMapIntensity: .15, side: THREE.DoubleSide, transparent: true, forceSinglePass: true,
  });
  if (shell) return new THREE.MeshPhysicalMaterial({
    name: 'abs-plastic', ...productStudio.shell, roughnessMap: grain,
    // Keep the original CAD normals clean. Micro variation affects roughness
    // only: ABS must read as a moulded satin surface, never as textured chalk.
    side: THREE.DoubleSide, shadowSide: THREE.FrontSide, transparent: true, forceSinglePass: true,
  });
  // Roles come from complete CAD solids, separating white silkscreen from metal.
  const finishes = productStudio.finishes;
  const name = source.name, [color, metalness, roughness] = finishes[name] || [0x34393d, 0, .7];
  if (name === 'solder-mask') return new THREE.MeshPhysicalMaterial({
    name, color, metalness: 0, roughness, specularIntensity: .45,
    ior: 1.5, clearcoat: .04, clearcoatRoughness: .48, envMapIntensity: .4, side: THREE.DoubleSide,
  });
  if (name === 'ic-epoxy' || name === 'connector-polymer') return new THREE.MeshPhysicalMaterial({
    name, color, metalness: 0, roughness, roughnessMap: grain, bumpMap: grain,
    bumpScale: name === 'ic-epoxy' ? .0006 : .0003,
    specularIntensity: name === 'ic-epoxy' ? .28 : .5,
    envMapIntensity: .5, side: THREE.DoubleSide,
  });
  return new THREE.MeshStandardMaterial({ name, color, metalness, roughness, envMapIntensity: metalness > .5 ? 1.1 : .3, side: THREE.DoubleSide });
}
function stableAreaLightBasis(shader) {
  // r180's LTC tangent normalizes V - N * dot(V, N). In an orthographic
  // top view V and N are parallel, so that vector is zero and area lighting
  // disappears until the model is rotated. Supply a perpendicular basis.
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
    'T1 = normalize( V - N * dot( V, N ) );',
    `vec3 tangent = V - N * dot( V, N );
    if ( dot( tangent, tangent ) < 1e-6 ) {
      vec3 axis = abs( N.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 0.0, 1.0, 0.0 );
      tangent = cross( axis, N );
    }
    T1 = normalize( tangent );`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', chunk);
}
const yieldToBrowser = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
async function initialize() {
  try {
    // Start the model transfer while the independent graphics modules load.
    const modelData = fetch('/static/assets/models/model.json').then(async response => {
      if (!response.ok) throw Error('模型配置读取失败');
      const settings = await response.json();
      if (settings.format === 'obj') return { settings };
      const asset = await fetch(settings.url);
      if (!asset.ok) throw Error('模型文件读取失败');
      return { settings, bytes: await asset.arrayBuffer() };
    });
    const [three, { GLTFLoader }, { RectAreaLightUniformsLib }, data] = await Promise.all([
      import('../vendor/three/build/three.module.js'),
      import('../vendor/three/addons/loaders/GLTFLoader.js'),
      import('../vendor/three/addons/lights/RectAreaLightUniformsLib.js'),
      modelData,
    ]);
    THREE = three; config = data.settings;
    // Let the heading, navigation and primary actions paint before GPU setup.
    await yieldToBrowser(); if (disposed) return;
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(displayPixelRatio()); renderer.setClearColor(0xffffff, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = productStudio.renderer.exposure;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
    scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-4, 4, 3, -3, .1, 100); camera.position.set(0, 0, 15);
    const lighting = productStudio.lights;
    await yieldToBrowser();
    studioEnvironment(); scene.add(new THREE.HemisphereLight(lighting.hemisphere.sky, lighting.hemisphere.ground, lighting.hemisphere.intensity));
    await yieldToBrowser();
    RectAreaLightUniformsLib.init();
    textures.push(...['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2'].map(name => THREE.UniformsLib[name]));
    const shadow = lighting.shadow, extent = shadow.extent;
    const key = new THREE.DirectionalLight(0xffffff, shadow.intensity); key.position.set(...shadow.position);
    key.castShadow = true; key.shadow.mapSize.set(shadow.mapSize, shadow.mapSize);
    Object.assign(key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: .1, far: 35 });
    key.shadow.normalBias = shadow.normalBias; key.shadow.bias = shadow.bias; key.shadow.radius = shadow.radius; key.shadow.blurSamples = shadow.blurSamples; scene.add(key);
    for (const [name, spec] of Object.entries({ key: lighting.key, fill: lighting.fill, rim: lighting.rim })) {
      const light = new THREE.RectAreaLight(spec.color, spec.intensity, ...spec.size); light.name = `studio-${name}`; light.position.set(...spec.position); light.lookAt(0, 0, 0); scene.add(light);
    }
    if (config.format === 'obj') {
      const [{ OBJLoader }, { MTLLoader }] = await Promise.all([import('../vendor/three/addons/loaders/OBJLoader.js'), import('../vendor/three/addons/loaders/MTLLoader.js')]);
      root = await new OBJLoader().setMaterials(await new MTLLoader().loadAsync(config.materials)).loadAsync(config.url);
    } else {
      root = (await new GLTFLoader().parseAsync(data.bytes, new URL('.', new URL(config.url, location.href)).href)).scene;
    }
    if (disposed) { release(); return; }
    const grain = moldedGrain();
    const shells = new Set((config.parts || []).filter(p => p.kind === 'shell').map(p => p.name));
    root.traverse(node => {
      if (!node.isMesh) return; let ancestor = node, shell;
      while (ancestor && ancestor !== root) { if (shells.has(ancestor.name)) { shell = ancestor.name; break; } ancestor = ancestor.parent; }
      if (shell || ['ic-epoxy', 'connector-polymer'].includes(node.material.name)) planarUV(node.geometry);
      const old = Array.isArray(node.material) ? node.material : [node.material];
      const replacements = old.map(m => modelMaterial(m, shell, grain));
      node.material = Array.isArray(node.material) ? replacements : replacements[0];
      node.castShadow = true; node.receiveShadow = true;
      replacements.forEach(m => {
        m.shadowSide = THREE.FrontSide;
        if (m.isMeshStandardMaterial) {
          m.onBeforeCompile = stableAreaLightBasis;
          m.customProgramCacheKey = () => 'ltc-normal-incidence-v1';
        }
      }); old.forEach(m => m.dispose());
    });
    parts = (config.parts || []).map(p => {
      const node = root.getObjectByName(p.name); if (!node) throw Error('缺少模型部件：' + p.name);
      const meshes = []; node.traverse(child => { if (child.isMesh) meshes.push(child); });
      return { node, config: p, base: node.position.clone(), opacity: undefined, meshes };
    });
    const sourceSize = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    const unit = 4.2 / Math.max(sourceSize.x, config.upAxis === 'z' ? sourceSize.y : sourceSize.z);
    if (config.upAxis === 'z') root.rotation.x = -Math.PI / 2;
    const normalized = new THREE.Group(); normalized.scale.setScalar(unit); normalized.add(root);
    rig = new THREE.Group(); rig.add(normalized); scene.add(rig); prepareFrames(unit); createGround(normalized);
    // Warm every material, including shells hidden by a directly opened hardware page.
    for (const part of parts) applyPartOpacity(part, 1);
    await yieldToBrowser();
    await renderer.compileAsync(scene, camera);
    if (disposed) { release(); return; }
    // Navigation and panel actions can happen while the GLB or shaders are loading.
    for (const part of parts) { const state = partState(part, route); part.node.position.copy(state.position); applyPartOpacity(part, state.opacity); }
    root.position.copy(frames[route].focus); rig.quaternion.copy(frames[route].quaternion); open = config.poses[route].open; syncOrbit();
    ready = true; stage.dataset.ready = 'true'; document.body.classList.add('model-ready');
    if (interactionRequested) setInteractive(true);
    wake();
  } catch (error) {
    stage.dataset.error = error.message; stage.classList.add('model-failed'); document.body.classList.remove('model-ready');
    captureRequest?.resolve(null); captureRequest = null;
    console.warn('3D 展示暂不可用，全部业务操作仍可使用', error); ready = false; settle(); release();
  }
}
function release() {
  cancelAnimationFrame(frame); frame = 0;
  root?.traverse(node => { node.geometry?.dispose(); (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => m?.dispose()); });
  scene?.traverse(node => node.shadow?.dispose());
  textures.forEach(t => t.dispose()); environment?.dispose(); renderer?.dispose();
  floor?.geometry.dispose(); floor?.material.dispose();
}
function syncOrbit() {
  const euler = new THREE.Euler().setFromQuaternion(rig.quaternion, config.poses[route].rotationOrder || 'YXZ');
  orbit.yaw = euler.y; orbit.pitch = euler.x;
}
function startDrag(pointer) {
  const rect = canvas.getBoundingClientRect();
  drag = { ...pointer, base: { ...orbit }, axis: null, sensitivity: Math.PI / Math.max(500, Math.min(rect.width, rect.height)) };
}
function stopPoseForInput() {
  if (poseTween) {
    poseTween = null; zoom = targetZoom = 1; root.position.copy(frames[route].focus);
    for (const part of parts) { const state = partState(part, route); part.node.position.copy(state.position); applyPartOpacity(part, state.opacity); }
  }
}
function rotate(dx, dy, base = orbit) {
  // Turntable: one fixed model-up yaw axis and one fixed horizontal tilt axis.
  // Rebuild from two scalar angles; never accumulate quaternion roll from drags.
  orbit.yaw = base.yaw + dx;
  orbit.pitch = THREE.MathUtils.clamp(base.pitch + dy, -Math.PI + .02, Math.PI - .02);
  manualTarget = new THREE.Quaternion().setFromEuler(new THREE.Euler(orbit.pitch, orbit.yaw, 0, config.poses[route].rotationOrder || 'YXZ'));
  rig.quaternion.copy(manualTarget);
  stage.dataset.moving = 'true'; wake();
}
canvas.addEventListener('pointerdown', event => {
  if (!interactive || (event.pointerType === 'mouse' && event.button !== 0)) return;
  stopPoseForInput(); manualTarget = null;
  const pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  pointers.set(pointer.id, pointer); canvas.setPointerCapture(pointer.id); canvas.focus({ preventScroll: true });
  if (pointers.size === 1) startDrag(pointer);
  else { const [a, b] = [...pointers.values()]; pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom }; drag = null; }
});
canvas.addEventListener('pointermove', event => {
  if (!interactive || !pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY });
  if (pinch && pointers.size > 1) {
    const [a, b] = [...pointers.values()];
    targetZoom = THREE.MathUtils.clamp(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance, .7, 1.75);
    stage.dataset.moving = 'true'; wake(); return;
  }
  if (!drag || drag.id !== event.pointerId) return;
  let dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (!drag.axis && Math.hypot(dx, dy) > 2) drag.axis = Math.abs(dx) > Math.abs(dy) * 2.4 ? 'horizontal' : Math.abs(dy) > Math.abs(dx) * 2.4 ? 'vertical' : 'free';
  // Reject tiny hand tremor; deliberate direction changes engage after eight pixels.
  if (drag.axis === 'horizontal') dy = Math.sign(dy) * Math.max(0, Math.abs(dy) - 8);
  if (drag.axis === 'vertical') dx = Math.sign(dx) * Math.max(0, Math.abs(dx) - 8);
  rotate(dx * drag.sensitivity, dy * drag.sensitivity, drag.base);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
  if (!pointers.has(event.pointerId)) return;
  pointers.delete(event.pointerId); pinch = null;
  if (manualTarget) { rig.quaternion.copy(manualTarget); manualTarget = null; }
  drag = null; if (pointers.size === 1) startDrag([...pointers.values()][0]); wake();
});
canvas.addEventListener('wheel', event => {
  if (!interactive) return; event.preventDefault(); stopPoseForInput();
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
  targetZoom = THREE.MathUtils.clamp(targetZoom * Math.exp(-pixels * .0012), .7, 1.75);
  stage.dataset.moving = 'true'; wake();
}, { passive: false });
canvas.addEventListener('dblclick', () => { if (interactive) beginPose(360); });
canvas.addEventListener('keydown', event => {
  if (!interactive) return;
  const moves = { ArrowLeft: [-.12, 0], ArrowRight: [.12, 0], ArrowUp: [0, -.12], ArrowDown: [0, .12] };
  if (moves[event.key]) { event.preventDefault(); stopPoseForInput(); rotate(...moves[event.key]); }
  else if (event.key === 'Home') { event.preventDefault(); beginPose(360); }
  else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); targetZoom = THREE.MathUtils.clamp(targetZoom * (event.key === '-' ? .9 : 1.1), .7, 1.75); wake(); }
});
canvas.setAttribute('role', 'img');
canvas.setAttribute('aria-label', '三维模型，拖动或方向键旋转，滚轮或双指缩放，双击或 Home 键归位');
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; cancelPointers(); cancelAnimationFrame(frame); frame = 0; captureRequest?.resolve(null); captureRequest = null; stage.classList.add('model-failed'); document.body.classList.remove('model-ready'); settle(); });
canvas.addEventListener('webglcontextrestored', () => { lost = false; stage.classList.remove('model-failed'); document.body.classList.add('model-ready'); beginPose(0); });
addEventListener('resize', () => { layoutDirty = true; wake(); }); reduced.addEventListener('change', wake);
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelPointers(); cancelAnimationFrame(frame); frame = 0; settle(); } else wake(); });
const observer = new ResizeObserver(() => { layoutDirty = true; wake(); }); observer.observe(stage);
observer.observe(document.querySelector('#main'));
addEventListener('pagehide', () => { disposed = true; ready = false; observer.disconnect(); captureRequest?.resolve(null); captureRequest = null; settle(); release(); }, { once: true });
export const modelStage = {
  update(next, publish = true) {
    layoutDirty = true;
    if (next !== route) { captureRequest?.resolve(null); captureRequest = null; }
    if (publish) document.body.dataset.page = next;
    if (next !== route) {
      interactive = interactionRequested = false; stage.dataset.interactive = 'false'; stage.setAttribute('aria-hidden', 'true'); canvas.tabIndex = -1;
      route = next; beginPose();
    } else if (ready) wake();
    return settledPromise;
  },
  setInteractive,
  whenSettled() { return settledPromise; },
  captureStill() {
    return new Promise(resolve => {
      captureRequest?.resolve(null);
      captureRequest = { resolve };
      if (disposed || lost) { captureRequest = null; resolve(null); }
      else if (ready) wake();
    });
  },
  diagnostics() {
    return ready ? {
      renderer: { revision: THREE.REVISION, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, pixelRatio: renderer.getPixelRatio() },
      lights: scene.children.filter(n => n.isRectAreaLight).map(n => ({ name: n.name, width: n.width, height: n.height })),
      ground: { receiver: floor?.receiveShadow, visible: floorRig?.visible },
      shells: parts.filter(p => p.config.kind === 'shell').map(p => ({ name: p.config.name, casts: p.meshes.every(m => m.castShadow), receives: p.meshes.every(m => m.receiveShadow) })),
    } : null;
  },
};
initialize();
