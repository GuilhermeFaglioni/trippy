import {
  Check,
  ChevronLeft,
  GripVertical,
  Heart,
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

/** Calendário com seta: mover o lugar para outro dia. */
const CalendarMove = createLucideIcon('CalendarMove', [
  ['rect', { x: '3', y: '5', width: '18', height: '16', rx: '2', key: 'frame' }],
  ['path', { d: 'M3 10h18M8 3v4M16 3v4M10 15h6M14 13l2 2-2 2', key: 'detalhes' }],
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
  camera: Camera,
  'wifi-off': WifiOff,
  'grip-vertical': GripVertical,
  'chevron-left': ChevronLeft,
  plus: Plus,
  search: Search,
  x: X,
  'address-card': AddressCard,
  'calendar-move': CalendarMove,
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
