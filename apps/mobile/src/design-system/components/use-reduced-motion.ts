import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/** "Reduzir movimento" ligado no celular: só opacidade, sem deslocamento. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)

    return () => {
      active = false
      subscription.remove()
    }
  }, [])

  return reduced
}
