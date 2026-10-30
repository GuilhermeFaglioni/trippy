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
  Star,
  Sun,
  Users,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react-native'

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
  x: X,
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
