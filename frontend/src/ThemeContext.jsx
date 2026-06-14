import React, { createContext, useContext, useState, useEffect } from 'react'
import { T, applyTheme } from './theme.js'

const ThemeContext = createContext(null)
export function useTheme() { return useContext(ThemeContext) }

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => localStorage.getItem('theme') || 'dark')

  useEffect(() => {
    applyTheme(mode)
  }, [mode])

  function toggle(m) {
    const next = m || (mode === 'dark' ? 'light' : 'dark')
    localStorage.setItem('theme', next)
    setMode(next)
    applyTheme(next)
    // Force re-render by triggering a storage event that components can listen to
    window.dispatchEvent(new Event('themechange'))
  }

  return (
    <ThemeContext.Provider value={{ mode, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}
