import './styles.css'
import { setupWaitlist } from './waitlist.ts'

const root = document.documentElement
const canvas = document.getElementById('cena') as HTMLCanvasElement
const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-chapter]'))
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const themeMeta = document.querySelector('meta[name="theme-color"]')

setupWaitlist(document.getElementById('form-lista') as HTMLFormElement)

function setSky(hex: string, dark: boolean) {
  root.style.setProperty('--sky', hex)
  themeMeta?.setAttribute('content', hex)
  document.body.classList.toggle('is-dark', dark)
}

/**
 * Linha do tempo t a partir do scroll: cada seção vale 1 unidade.
 * A última começa quando a lista aparece embaixo da tela, para a noite cair enquanto ela sobe.
 */
let anchors: number[] = []
function measure() {
  const vh = innerHeight
  const tops = sections.map((s) => s.getBoundingClientRect().top + scrollY)
  const max = Math.max(1, document.documentElement.scrollHeight - vh)
  anchors = [
    0,
    tops[1]!,
    tops[2]!,
    tops[3]!,
    Math.max(tops[3]! + 1, tops[4]! - vh),
    Math.max(tops[4]! - vh + 2, max),
  ]
}
function scrollT() {
  const y = scrollY
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!
    const b = anchors[i + 1]!
    if (y < b || i === anchors.length - 2)
      return Math.min(i + 1, i + Math.max(0, (y - a) / (b - a)))
  }
  return 0
}

/** No modo "reduzir movimento" a cena não anda: cada capítulo é um quadro fixo. */
const STILL = [0, 1.8, 2.75, 3.95, 4.9]

async function start() {
  let createScene: typeof import('./scene.ts').createScene
  try {
    ;({ createScene } = await import('./scene.ts'))
  } catch {
    root.classList.add('no-3d')
    return
  }
  let scene: ReturnType<typeof createScene>
  try {
    scene = createScene({ canvas, reducedMotion, onSky: setSky })
  } catch {
    // sem WebGL: paisagem estática
    root.classList.add('no-3d')
    return
  }
  root.classList.add('is-3d')

  measure()
  addEventListener('resize', () => {
    measure()
    scene.resize()
  })
  new ResizeObserver(measure).observe(document.body)

  if (reducedMotion) {
    let shown = -1
    const show = () => {
      const t = scrollT()
      const idx = Math.min(STILL.length - 1, Math.floor(t + 0.15))
      if (idx === shown) return
      const first = shown === -1
      shown = idx
      const draw = () => scene.frame(STILL[idx]!, 0)
      if (first) return draw()
      canvas.style.opacity = '0'
      setTimeout(() => {
        draw()
        canvas.style.opacity = ''
      }, 150)
    }
    addEventListener('scroll', show, { passive: true })
    addEventListener('resize', () => {
      shown = -1
      show()
    })
    show()
    return
  }

  let current = scrollT()
  let last = performance.now()
  const loop = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    scene.reportFrameTime(now - last)
    last = now
    const target = scrollT()
    // amortecimento exponencial: o scroll vira movimento de câmera suave
    current += (target - current) * (1 - Math.exp(-dt * 5))
    if (Math.abs(target - current) < 0.0005) current = target
    scene.frame(current, now / 1000)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}

void start()
