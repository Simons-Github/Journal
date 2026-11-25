import { createContext, ReactNode, useContext, useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
const KEY = '12wm-theme'

const Ctx = createContext<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>({ mode: 'system', setMode: () => {} })
export const useTheme = () => useContext(Ctx)

/** Hell/Dunkel: folgt dem System, lässt sich aber pro Gerät festlegen */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try { return (localStorage.getItem(KEY) as ThemeMode) || 'system' } catch { return 'system' }
  })
  useEffect(() => {
    const root = document.documentElement
    if (mode === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', mode)
    try { localStorage.setItem(KEY, mode) } catch { /* ignore */ }
  }, [mode])
  return <Ctx.Provider value={{ mode, setMode }}>{children}</Ctx.Provider>
}
