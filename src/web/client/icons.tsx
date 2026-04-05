import { useState, useEffect } from 'react'
import { T } from './tokens'

export function MenuIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <line x1={4} y1={7} x2={16} y2={7} />
      <line x1={4} y1={12} x2={13} y2={12} />
    </svg>
  )
}

export function ChevronDown({ s = 10 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <path d="M2.5 3.75l2.5 2.5 2.5-2.5" />
    </svg>
  )
}

export function SendIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10l12-6-6 12-1.5-5.5L4 10z" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <line x1={10} y1={4} x2={10} y2={16} />
      <line x1={4} y1={10} x2={16} y2={10} />
    </svg>
  )
}

export function XIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1={4} y1={4} x2={12} y2={12} />
      <line x1={12} y1={4} x2={4} y2={12} />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke={T.green} strokeWidth={2} strokeLinecap="round">
      <polyline points="3,7.5 5.5,10 11,4" />
    </svg>
  )
}

export function ErrIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke={T.red} strokeWidth={2} strokeLinecap="round">
      <line x1={4} y1={4} x2={10} y2={10} />
      <line x1={10} y1={4} x2={4} y2={10} />
    </svg>
  )
}

export function StopIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="currentColor">
      <rect x={3} y={3} width={8} height={8} rx={1.5} />
    </svg>
  )
}

export function QuarkLogo({ size = 32 }: { size?: number }) {
  const angles = [0, 45, 90, 135, 180, 225, 270, 315]
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx={24} cy={24} r={6} fill={T.accent} />
      {angles.map((a, i) => {
        const r = (a * Math.PI) / 180
        const len = 10 + (i % 2) * 4
        return (
          <line
            key={i}
            x1={24 + Math.cos(r) * 8}
            y1={24 + Math.sin(r) * 8}
            x2={24 + Math.cos(r) * len}
            y2={24 + Math.sin(r) * len}
            stroke={T.accent}
            strokeWidth={i % 2 === 0 ? 2.5 : 1.5}
            strokeLinecap="round"
            opacity={0.7 + (i % 2) * 0.3}
          />
        )
      })}
    </svg>
  )
}

export function AgentDot() {
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.accent, display: 'inline-block', flexShrink: 0 }} />
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL = 80

export function BrailleSpinner({ size = 14, color = T.accent }: { size?: number; color?: string }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), SPINNER_INTERVAL)
    return () => clearInterval(id)
  }, [])
  return (
    <span style={{ fontSize: size, color, fontFamily: T.mono, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
      {SPINNER_FRAMES[frame]}
    </span>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <BrailleSpinner size={size} />
}

export function WarningIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" fill="none" stroke={T.yellow} strokeWidth={1.5} strokeLinecap="round">
      <path d="M9 1.5l7.5 13.5H1.5L9 1.5z" />
      <line x1={9} y1={7} x2={9} y2={10} />
      <circle cx={9} cy={12.5} r={0.5} fill={T.yellow} />
    </svg>
  )
}

export function PaperclipIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 11.5l-5.5 5.5a3.5 3.5 0 01-5-5l7-7a2.5 2.5 0 013.5 3.5l-6.5 6.5a1.5 1.5 0 01-2-2l5-5" />
    </svg>
  )
}

export function CommandIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,6 10,10 4,14" />
      <line x1={12} y1={14} x2={16} y2={14} />
    </svg>
  )
}

export function XSmallIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1={3} y1={3} x2={9} y2={9} />
      <line x1={9} y1={3} x2={3} y2={9} />
    </svg>
  )
}
