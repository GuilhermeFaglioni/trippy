import {
  Check,
  ChevronLeft,
  GripVertical,
  Heart,
  Image,
  Images,
  ListOrdered,
  MapPin,
  Plus,
  Camera,
  Search,
  Star,
  Sun,
  Users,
  WifiOff,
  X,
  createLucideIcon,
  type LucideIcon,
} from 'lucide-react-native'

/** Cartão para mostrar (retângulo com duas linhas), traço da tela do lugar. */
const AddressCard = createLucideIcon('AddressCard', [
  ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2', key: 'frame' }],
  ['path', { d: 'M7 10h6M7 14h10', key: 'lines' }],
])

/** Três pontos das opções da linha (tela do grupo), preenchidos. */
const More = createLucideIcon('More', [
  ['circle', { cx: '5', cy: '12', r: '1.8', key: 'a' }],
  ['circle', { cx: '12', cy: '12', r: '1.8', key: 'b' }],
  ['circle', { cx: '19', cy: '12', r: '1.8', key: 'c' }],
])

/** Câmera de vídeo do aviso do recap. */
const VideoCamera = createLucideIcon('VideoCamera', [
  ['rect', { x: '3', y: '6', width: '13', height: '12', rx: '2', key: 'body' }],
  ['path', { d: 'M16 10l5-3v10l-5-3', key: 'lens' }],
])

export const iconSet = {
  sun: Sun,
  'list-ordered': ListOrdered,
  'map-pin': MapPin,
  images: Images,
  users: Users,
  check: Check,
  star: Star,
  heart: Heart,
  image: Image,
  camera: Camera,
  'wifi-off': WifiOff,
  'grip-vertical': GripVertical,
  'chevron-left': ChevronLeft,
  plus: Plus,
  search: Search,
  x: X,
  'address-card': AddressCard,
  more: More,
  'video-camera': VideoCamera,
} as const satisfies Record<string, LucideIcon>

export type IconName = keyof typeof iconSet

export type IconProps = {
  name: IconName
  color: string
  size?: number
  strokeWidth?: number
  /** Estado marcado de estrela e coração: mesmo ícone, preenchido. */
  filled?: boolean
}

export function Icon({ name, color, size = 20, strokeWidth = 2, filled = false }: IconProps) {
  const Glyph = iconSet[name]

  return (
    <Glyph
      color={color}
      fill={filled ? color : 'none'}
      size={size}
      strokeWidth={strokeWidth}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  )
}
