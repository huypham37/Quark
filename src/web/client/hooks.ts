import { useState, useEffect } from 'react'

const VH_FALLBACK = CSS.supports('height', '100svh')
  ? '100svh'
  : CSS.supports('height', '100dvh')
    ? '100dvh'
    : '100vh'

export function useViewportHeight() {
  const [vh, setVh] = useState(() => {
    if (window.visualViewport) return window.visualViewport.height + 'px'
    return VH_FALLBACK
  })

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const h = vv.height + 'px'
      setVh(h)
      document.documentElement.style.setProperty('--vh-actual', h)
      // Prevent the browser from scrolling the page when the virtual
      // keyboard opens — our layout handles the reduced height itself.
      if (vv.offsetTop !== 0) window.scrollTo(0, 0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return vh
}

export function fmtTokens(n: number) {
  if (!n) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  return String(n)
}

export function getGreeting() {
  const h = new Date().getHours()
  return h < 12 ? 'this morning' : h < 17 ? 'this afternoon' : 'this evening'
}
