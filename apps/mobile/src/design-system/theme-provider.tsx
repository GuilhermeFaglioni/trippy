import { createContext, useContext, useMemo, type PropsWithChildren } from 'react'
import { useColorScheme } from 'react-native'

import { createDesignTheme, resolveThemeMode, type DesignTheme } from './theme-model'

const DesignSystemContext = createContext<DesignTheme | null>(null)

export function DesignSystemProvider({ children }: PropsWithChildren) {
  const systemColorScheme = useColorScheme()
  const mode = resolveThemeMode(systemColorScheme)
  const theme = useMemo(() => createDesignTheme(mode), [mode])

  return <DesignSystemContext.Provider value={theme}>{children}</DesignSystemContext.Provider>
}

export function useTheme(): DesignTheme {
  const theme = useContext(DesignSystemContext)

  if (!theme) {
    throw new Error('useTheme deve ser usado dentro de DesignSystemProvider')
  }

  return theme
}
