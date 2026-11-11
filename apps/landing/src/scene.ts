import * as THREE from 'three'

/**
 * Cena persistente da landing. Recebe a "linha do tempo" t do scroll:
 *   0..1 abertura · 1..2 planejar (pinos caem) · 2..3 viajar (rota e câmera de perseguição)
 *   3..4 lembrar (fotos sobem e viram álbum) · 4..5 lista (noite, fotos acesas)
 * Toda cor vem da iluminação: o céu, o sol e a névoa andam juntos.
 */

const C = {
  forest: 0x1f4d3f,
  forestDark: 0x173b30,
  sage: 0x9fb7a6,
  sand: 0xe9d8bd,
  sandDeep: 0xd8c09b,
  mustard: 0xe9b872,
  terracotta: 0xc2410c,
  avatar: [0xe9b872, 0xf6c9b2, 0xb8dacb, 0xd9cfc1],
}

type Key = {
  t: number
  sky: number
  sun: number
  sunI: number
  hemiI: number
  sunPos: [number, number, number]
}

const LIGHT_KEYS: Key[] = [
  { t: 0, sky: 0xf2e9dc, sun: 0xfff1dc, sunI: 2.4, hemiI: 1.15, sunPos: [24, 30, 16] },
  { t: 2, sky: 0xf3dfc1, sun: 0xffdca8, sunI: 2.5, hemiI: 1.05, sunPos: [30, 20, 4] },
  { t: 3.3, sky: 0xe9ae80, sun: 0xff9d63, sunI: 2.1, hemiI: 0.85, sunPos: [34, 9, -12] },
  { t: 3.95, sky: 0xb9785a, sun: 0xff8a52, sunI: 1.2, hemiI: 0.6, sunPos: [36, 3, -16] },
  { t: 4.4, sky: 0x16271f, sun: 0xa9c4d6, sunI: 0.45, hemiI: 0.28, sunPos: [-20, 26, 10] },
]

const PIN_SPOTS: [number, number][] = [
  [-6, 15],
  [4.5, 6],
  [-3.5, -4],
  [7, -13.5],
  [-1, -24],
]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (a: number, b: number, v: number) => {
  const x = clamp01((v - a) / (b - a))
  return x * x * (3 - 2 * x)
}
const easeOutBack = (x: number) => {
  const c1 = 1.4
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Relevo baixo no vale da rota, morros nas bordas. */
function height(x: number, z: number) {
  const base = 0.55 * Math.sin(x * 0.21) * Math.cos(z * 0.17) + 0.35 * Math.sin(x * 0.07 + z * 0.12)
  const edge = Math.max(0, Math.abs(x + Math.sin(z * 0.08) * 4) - 13)
  const hills = edge * edge * 0.045 * (1 + 0.6 * Math.sin(z * 0.23 + x * 0.1))
  return base + hills
}

export interface SceneOptions {
  canvas: HTMLCanvasElement
  reducedMotion: boolean
  onSky: (hex: string, dark: boolean) => void
}

export function createScene({ canvas, reducedMotion, onSky }: SceneOptions) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  })
  const coarse = matchMedia('(pointer: coarse)').matches
  let dprCap = coarse ? 1.5 : 2
  renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.92
  renderer.shadowMap.enabled = !coarse
  renderer.shadowMap.type = THREE.PCFShadowMap

  const scene = new THREE.Scene()
  const sky = new THREE.Color(LIGHT_KEYS[0]!.sky)
  scene.background = sky
  scene.fog = new THREE.Fog(sky, 34, 96)

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200)

  // ---------- luz ----------
  const hemi = new THREE.HemisphereLight(0xfff6e8, 0x8a7a5e, 1)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xffffff, 2.4)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = -30
  sun.shadow.camera.right = 30
  sun.shadow.camera.top = 34
  sun.shadow.camera.bottom = -34
  sun.shadow.camera.far = 120
  sun.shadow.bias = -0.0008
  sun.target.position.set(0, 0, -4)
  scene.add(sun, sun.target)

  // ---------- terreno low-poly ----------
  const groundGeo = new THREE.PlaneGeometry(150, 150, 70, 70).toNonIndexed()
  groundGeo.rotateX(-Math.PI / 2)
  const pos = groundGeo.attributes.position as THREE.BufferAttribute
  const jitter = rng(7)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, height(x, z) + (jitter() - 0.5) * 0.12)
  }
  const colors = new Float32Array(pos.count * 3)
  const cLow = new THREE.Color(C.sand)
  const cMid = new THREE.Color(C.sandDeep)
  const cHigh = new THREE.Color(C.sage)
  const tmp = new THREE.Color()
  for (let f = 0; f < pos.count; f += 3) {
    const y = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3
    const n = jitter() * 0.08
    if (y < 1.2) tmp.copy(cLow).lerp(cMid, clamp01(y / 1.2) * 0.5 + n)
    else tmp.copy(cMid).lerp(cHigh, clamp01((y - 1.2) / 3) + n)
    for (let k = 0; k < 3; k++) tmp.toArray(colors, (f + k) * 3)
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  groundGeo.computeVertexNormals()
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  )
  ground.receiveShadow = true
  scene.add(ground)

  // ---------- rota ----------
  const pinPoints = PIN_SPOTS.map(([x, z]) => new THREE.Vector3(x, height(x, z), z))
  const control = [new THREE.Vector3(-12, 0, 26), ...pinPoints, new THREE.Vector3(4, 0, -34)]
  const rough = new THREE.CatmullRomCurve3(control, false, 'centripetal')
  const routePts = rough
    .getSpacedPoints(260)
    .map((p) => new THREE.Vector3(p.x, height(p.x, p.z) + 0.16, p.z))
  const route = new THREE.CatmullRomCurve3(routePts)
  const TUBE_SEG = 520
  const RADIAL = 6
  const routeGeo = new THREE.TubeGeometry(route, TUBE_SEG, 0.13, RADIAL, false)
  const routeMat = new THREE.MeshStandardMaterial({
    color: C.terracotta,
    emissive: C.terracotta,
    emissiveIntensity: 0.25,
    roughness: 0.6,
  })
  const routeMesh = new THREE.Mesh(routeGeo, routeMat)
  routeMesh.castShadow = true
  scene.add(routeMesh)
  const routeIndexCount = routeGeo.index ? routeGeo.index.count : 0
  routeGeo.setDrawRange(0, 0)

  // parâmetro (0..1) da rota mais perto de cada pino
  const pinU = pinPoints.map((p) => {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i <= 400; i++) {
      const u = i / 400
      const d = route.getPointAt(u).distanceToSquared(p)
      if (d < bestD) {
        bestD = d
        best = u
      }
    }
    return best
  })

  // marcador viajando
  const traveler = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 24, 16),
    new THREE.MeshStandardMaterial({
      color: C.mustard,
      emissive: C.mustard,
      emissiveIntensity: 0.6,
      roughness: 0.4,
    }),
  )
  traveler.castShadow = true
  traveler.visible = false
  scene.add(traveler)

  // ---------- árvores ----------
  const treeGeo = new THREE.ConeGeometry(0.55, 1.9, 6)
  treeGeo.translate(0, 0.95, 0)
  const trees = new THREE.InstancedMesh(
    treeGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }),
    150,
  )
  trees.castShadow = true
  const tr = rng(21)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  let placed = 0
  for (let tries = 0; placed < 150 && tries < 4000; tries++) {
    const x = (tr() - 0.5) * 80
    const z = 30 - tr() * 80
    let near = Infinity
    for (let i = 0; i < routePts.length; i += 4) {
      const p = routePts[i]!
      near = Math.min(near, (p.x - x) ** 2 + (p.z - z) ** 2)
    }
    if (near < 14) continue
    const k = 0.7 + tr() * 0.9
    s.set(k, k * (0.8 + tr() * 0.6), k)
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr() * Math.PI)
    m4.compose(new THREE.Vector3(x, height(x, z) - 0.1, z), q, s)
    trees.setMatrixAt(placed, m4)
    trees.setColorAt(placed, new THREE.Color(tr() > 0.5 ? C.forest : C.forestDark))
    placed++
  }
  trees.count = placed
  scene.add(trees)

  // ---------- pinos ----------
  const pinMat = new THREE.MeshStandardMaterial({ color: 0x2b6654, roughness: 0.4 })
  const ringMat = new THREE.MeshStandardMaterial({
    color: C.mustard,
    roughness: 0.5,
    emissive: C.mustard,
    emissiveIntensity: 0.15,
  })
  const headGeo = new THREE.SphereGeometry(0.95, 32, 20)
  const tipGeo = new THREE.ConeGeometry(0.82, 2.1, 32, 1, true)
  tipGeo.rotateX(Math.PI)
  const sunGeo = new THREE.SphereGeometry(0.42, 24, 16)
  const baseGeo = new THREE.RingGeometry(0.7, 1.15, 40)
  baseGeo.rotateX(-Math.PI / 2)

  const pins = pinPoints.map((p, i) => {
    const g = new THREE.Group()
    const body = new THREE.Group()
    const head = new THREE.Mesh(headGeo, pinMat)
    head.position.y = 2.75
    const tip = new THREE.Mesh(tipGeo, pinMat)
    tip.position.y = 1.32
    const dot = new THREE.Mesh(sunGeo, ringMat)
    dot.position.set(0, 2.75, 0.68)
    head.castShadow = tip.castShadow = true
    body.add(head, tip, dot)
    const base = new THREE.Mesh(
      baseGeo,
      new THREE.MeshStandardMaterial({
        color: C.avatar[i % 4]!,
        roughness: 0.8,
        transparent: true,
        opacity: 0,
      }),
    )
    base.position.y = 0.06
    g.add(body, base)
    g.position.copy(p)
    scene.add(g)
    return { g, body, base, dot }
  })

  // ---------- fotos ----------
  const PHOTO_COUNT = 10
  const photoGeo = new THREE.PlaneGeometry(1.6, 2)
  const photos = Array.from({ length: PHOTO_COUNT }, (_, i) => {
    const tex = new THREE.CanvasTexture(paintPhoto(i))
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 0.7,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    })
    const mesh = new THREE.Mesh(photoGeo, mat)
    // As fotos se cruzam enquanto voam para o álbum; pelo z-buffer, quem fica na frente
    // trocaria a cada quadro. Elas não escrevem profundidade e são desenhadas numa ordem
    // fixa (as mais fundas no álbum primeiro), mas ainda respeitam pinos e árvores.
    mesh.renderOrder = PHOTO_COUNT - i
    mesh.castShadow = true
    mesh.visible = false
    scene.add(mesh)
    const r = rng(100 + i)
    return {
      mesh,
      mat,
      pin: i % pinPoints.length,
      spin: (r() - 0.5) * 0.5,
      lift: 3.6 + r() * 1.6,
      side: r() > 0.5 ? 1 : -1,
    }
  })

  // ---------- câmera ----------
  type Pose = { pos: THREE.Vector3; look: THREE.Vector3 }
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const CAM_KEYS: { t: number; pos: THREE.Vector3; look: THREE.Vector3 }[] = [
    { t: 0, pos: P(-14, 13, 34), look: P(4, 0.5, 2) },
    { t: 1, pos: P(-17, 21, 25), look: P(3, 0, -4) },
    { t: 1.75, pos: P(-15, 19, 22), look: P(1, 0, -3) },
    { t: 3.15, pos: P(-12, 12, 16), look: P(2, 2.5, -6) },
    { t: 4, pos: P(-8, 9, 13), look: P(3, 4, -8) },
    { t: 5, pos: P(-7, 11, 12), look: P(3, 6, -8) },
  ]
  const camPose: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
  const chase: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
  const lookNow = new THREE.Vector3()

  function overview(t: number, out: Pose) {
    let a = CAM_KEYS[0]!
    let b = CAM_KEYS[CAM_KEYS.length - 1]!
    for (let i = 0; i < CAM_KEYS.length - 1; i++) {
      if (t >= CAM_KEYS[i]!.t && t <= CAM_KEYS[i + 1]!.t) {
        a = CAM_KEYS[i]!
        b = CAM_KEYS[i + 1]!
        break
      }
    }
    if (t > b.t) a = b
    const k = a === b ? 0 : smooth(a.t, b.t, t)
    out.pos.copy(a.pos).lerp(b.pos, k)
    out.look.copy(a.look).lerp(b.look, k)
  }

  const travelU = (t: number) => smooth(1.95, 2.95, t)

  function chaseCam(u: number, out: Pose) {
    const uu = Math.min(0.999, Math.max(0.001, u))
    const p = route.getPointAt(uu)
    const ahead = route.getPointAt(Math.min(0.999, uu + 0.12))
    const tangent = route.getTangentAt(uu)
    const side = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize()
    out.pos.copy(p).addScaledVector(tangent, -12).addScaledVector(side, 6)
    out.pos.y += 12
    out.look.copy(ahead)
    out.look.y += 0.6
  }

  // ---------- ajuste por tamanho de tela ----------
  let aspect = 1
  function resize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    aspect = w / h
    renderer.setSize(w, h, false)
    camera.aspect = aspect
    // no celular o texto fica embaixo: abre o campo de visão e sobe o enquadramento
    camera.fov = aspect < 0.8 ? 52 : 40
    camera.updateProjectionMatrix()
  }

  // slots do álbum, em coordenadas da câmera
  const slotLocal = new THREE.Vector3()
  function albumSlot(i: number, night: number, out: THREE.Vector3) {
    const d = 11
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d
    const halfW = halfH * aspect
    const cols = aspect < 0.8 ? 3 : 4
    const col = i % cols
    const row = Math.floor(i / cols)
    let x: number
    let y: number
    if (aspect < 0.8) {
      x = (col - (cols - 1) / 2) * 1.95
      y = halfH * 0.62 - row * 2.1
    } else {
      const left = halfW * 0.24
      const span = halfW * 0.86 - left
      x = left + (col / (cols - 1)) * span
      y = 2.1 - row * 2.3
    }
    const jx = Math.sin(i * 12.9898) * 0.25
    const jy = Math.cos(i * 78.233) * 0.25
    // à noite as fotos se espalham ao fundo, longe do formulário
    const nx = Math.sin(i * 3.1) * 0.9 * halfW * 1.5
    const ny = halfH * (0.15 + 0.7 * ((i * 0.37) % 1))
    out.set(
      THREE.MathUtils.lerp(x + jx, nx, night),
      THREE.MathUtils.lerp(y + jy, ny, night),
      // cada foto numa camada própria: fotos coplanares disputam o z-buffer e piscam
      -(THREE.MathUtils.lerp(d, 24, night) + i * 0.3),
    )
    return out
  }

  // ---------- quadro ----------
  const tmpV = new THREE.Vector3()
  const sunColor = new THREE.Color()
  const skyColor = new THREE.Color()
  let lastDark: boolean | null = null
  let lastSkyHex = ''

  function applyLight(t: number) {
    let a = LIGHT_KEYS[0]!
    let b = LIGHT_KEYS[LIGHT_KEYS.length - 1]!
    for (let i = 0; i < LIGHT_KEYS.length - 1; i++) {
      if (t >= LIGHT_KEYS[i]!.t && t <= LIGHT_KEYS[i + 1]!.t) {
        a = LIGHT_KEYS[i]!
        b = LIGHT_KEYS[i + 1]!
        break
      }
    }
    if (t > b.t) a = b
    const k = a === b ? 0 : smooth(a.t, b.t, t)
    skyColor.set(a.sky).lerp(tmp.set(b.sky), k)
    sky.copy(skyColor)
    ;(scene.fog as THREE.Fog).color.copy(skyColor)
    sunColor.set(a.sun).lerp(tmp.set(b.sun), k)
    sun.color.copy(sunColor)
    sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, k)
    hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, k)
    hemi.color.copy(skyColor).lerp(tmp.set(0xffffff), 0.5)
    sun.position.set(
      THREE.MathUtils.lerp(a.sunPos[0], b.sunPos[0], k),
      THREE.MathUtils.lerp(a.sunPos[1], b.sunPos[1], k),
      THREE.MathUtils.lerp(a.sunPos[2], b.sunPos[2], k),
    )
    const hex = '#' + skyColor.getHexString()
    const dark = t > 4.12
    if (hex !== lastSkyHex || dark !== lastDark) {
      lastSkyHex = hex
      lastDark = dark
      onSky(hex, dark)
    }
  }

  function frame(t: number, time: number) {
    applyLight(t)
    const night = smooth(3.95, 4.5, t)

    // pinos caem do céu, um de cada vez
    pins.forEach((pin, i) => {
      // o primeiro pino já está fincado na abertura: o ponto de partida
      const start = i === 0 ? -1 : 0.55 + i * 0.2
      const k = clamp01((t - start) / 0.5)
      const drop = k <= 0 ? 0 : easeOutBack(k)
      pin.g.visible = k > 0
      pin.body.position.y = (1 - drop) * 14
      pin.body.scale.setScalar(0.4 + 0.6 * Math.min(1, drop))
      const mat = pin.base.material as THREE.MeshStandardMaterial
      mat.opacity = smooth(start + 0.3, start + 0.6, t)
      pin.base.scale.setScalar(0.6 + 0.4 * mat.opacity)
      // pino aceso quando o viajante passa
      const lit = smooth(pinU[i]! - 0.02, pinU[i]! + 0.02, travelU(t))
      ;(pin.dot.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.15 + lit * 0.5 + night * 0.9
    })

    // rota se desenha enquanto o viajante anda
    const u = travelU(t)
    const reveal = Math.max(u, smooth(1.6, 1.95, t) * 0.04)
    routeGeo.setDrawRange(0, Math.floor((reveal * routeIndexCount) / (RADIAL * 6)) * RADIAL * 6)
    routeMat.emissiveIntensity = 0.25 + night * 0.8
    traveler.visible = t > 1.9 && t < 3.4
    if (traveler.visible) {
      route.getPointAt(Math.min(0.999, Math.max(0.001, u)), traveler.position)
      traveler.position.y += 0.55 + (reducedMotion ? 0 : Math.sin(time * 4) * 0.08)
      traveler.scale.setScalar(1 - smooth(3.1, 3.4, t))
    }

    // câmera: panorama ⇄ perseguição na rota
    overview(t, camPose)
    chaseCam(u, chase)
    const w = smooth(1.75, 2.12, t) * (1 - smooth(2.82, 3.2, t))
    camera.position.copy(camPose.pos).lerp(chase.pos, w)
    lookNow.copy(camPose.look).lerp(chase.look, w)
    if (aspect < 0.8) {
      // enquadramento vertical: o texto ocupa a metade de baixo, então a cena sobe
      camera.position.addScaledVector(
        tmpV.subVectors(camera.position, lookNow).normalize(),
        9 * (1 - w),
      )
      lookNow.y -= 8 * (1 - w) + 3 * w
      camera.position.y += 10 * w
    }
    if (!reducedMotion) {
      camera.position.x += Math.sin(time * 0.25) * 0.25
      camera.position.y += Math.sin(time * 0.31) * 0.15
    }
    camera.lookAt(lookNow)
    camera.updateMatrixWorld()

    // fotos sobem dos pinos e viram álbum
    const rise = (i: number) => smooth(2.95 + i * 0.035, 3.35 + i * 0.035, t)
    const gather = (i: number) => smooth(3.4 + i * 0.03, 3.88 + i * 0.03, t)
    photos.forEach((ph, i) => {
      const r1 = rise(i)
      ph.mesh.visible = r1 > 0
      if (!ph.mesh.visible) return
      const g = gather(i)
      const pinPos = pinPoints[ph.pin]!
      const floatPos = tmpV.set(pinPos.x + ph.side * 1.1, pinPos.y + 1.2 + r1 * ph.lift, pinPos.z)
      if (!reducedMotion) floatPos.y += Math.sin(time * 1.3 + i) * 0.12
      const slot = camera.localToWorld(albumSlot(i, night, slotLocal))
      ph.mesh.position.copy(floatPos).lerp(slot, g)
      // vira para a câmera conforme se junta
      ph.mesh.quaternion.copy(camera.quaternion)
      ph.mesh.rotateZ(ph.spin * (1 - night * 0.5))
      ph.mesh.rotateY((1 - g) * ph.side * 0.9)
      const sc = THREE.MathUtils.lerp(0.75, 1, g) * THREE.MathUtils.lerp(1, 1.25, night)
      ph.mesh.scale.setScalar(sc)
      ph.mat.opacity = r1
      // à noite as fotos recuam escurecendo, sem ficar translúcidas
      const dim = 1 - night * (aspect < 0.8 ? 0.65 : 0.3)
      ph.mat.color.setScalar(dim)
      ph.mat.emissiveIntensity = (0.12 + night * 0.55) * dim
    })

    renderer.render(scene, camera)
  }

  resize()

  // derruba a qualidade se o aparelho não acompanhar
  let slowFrames = 0
  let checked = 0
  function reportFrameTime(ms: number) {
    if (checked > 90) return
    checked++
    if (ms > 34) slowFrames++
    if (checked === 90 && slowFrames > 30) {
      dprCap = 1
      renderer.setPixelRatio(1)
      renderer.shadowMap.enabled = false
      resize()
    }
  }

  return { frame, resize, reportFrameTime, dispose: () => renderer.dispose() }
}

/** "Foto" geométrica de lugar, pintada em canvas com a paleta do app. */
function paintPhoto(i: number) {
  const W = 320
  const H = 400
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  const r = rng(300 + i * 7)
  g.fillStyle = '#FBF8F3'
  g.fillRect(0, 0, W, H)
  const pad = 16
  const iw = W - pad * 2
  const ih = H - pad - 64
  g.save()
  g.beginPath()
  g.rect(pad, pad, iw, ih)
  g.clip()
  const skies = [
    ['#F3D9B0', '#EAB98B'],
    ['#DCEBE4', '#B9C8BF'],
    ['#FBE3D6', '#E9B872'],
    ['#C9DCE3', '#EFE7DB'],
    ['#F6C9B2', '#C98A6A'],
  ]
  const [s0, s1] = skies[i % skies.length]!
  const grad = g.createLinearGradient(0, pad, 0, pad + ih)
  grad.addColorStop(0, s0!)
  grad.addColorStop(1, s1!)
  g.fillStyle = grad
  g.fillRect(pad, pad, iw, ih)
  // sol
  g.fillStyle = i % 3 === 0 ? '#C2410C' : '#E9B872'
  g.beginPath()
  g.arc(
    pad + iw * (0.25 + r() * 0.5),
    pad + ih * (0.22 + r() * 0.18),
    18 + r() * 16,
    0,
    Math.PI * 2,
  )
  g.fill()
  const kind = i % 3
  if (kind === 0) {
    // montanhas
    const layers = ['#9FB7A6', '#5F8574', '#1F4D3F']
    layers.forEach((c, li) => {
      g.fillStyle = c
      g.beginPath()
      g.moveTo(pad, pad + ih)
      const base = pad + ih * (0.5 + li * 0.14)
      for (let x = 0; x <= iw; x += iw / 4) {
        g.lineTo(pad + x, base - r() * ih * 0.22)
      }
      g.lineTo(pad + iw, pad + ih)
      g.closePath()
      g.fill()
    })
  } else if (kind === 1) {
    // cidade
    g.fillStyle = '#1F4D3F'
    let x = pad
    while (x < pad + iw) {
      const w = 22 + r() * 34
      const h = ih * (0.25 + r() * 0.4)
      g.fillRect(x, pad + ih - h, w - 4, h)
      x += w
    }
    g.fillStyle = '#E9B872'
    for (let k = 0; k < 18; k++) g.fillRect(pad + r() * iw, pad + ih * (0.62 + r() * 0.3), 5, 7)
  } else {
    // mar
    g.fillStyle = '#5F8C93'
    g.fillRect(pad, pad + ih * 0.58, iw, ih * 0.42)
    g.fillStyle = '#E9D8BD'
    g.beginPath()
    g.moveTo(pad, pad + ih)
    g.quadraticCurveTo(pad + iw * 0.5, pad + ih * (0.72 + r() * 0.1), pad + iw, pad + ih * 0.86)
    g.lineTo(pad + iw, pad + ih)
    g.fill()
  }
  g.restore()
  // legenda manuscrita fake: duas linhas finas
  g.fillStyle = '#D8CFC2'
  g.fillRect(pad + 4, H - 44, iw * (0.4 + r() * 0.3), 6)
  g.fillRect(pad + 4, H - 28, iw * (0.2 + r() * 0.2), 6)
  return cv
}
