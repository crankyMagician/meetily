'use client'

import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useEffect, useState } from 'react'

const themes = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
] as const

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  if (compact) {
    // Cycle: light -> dark -> system -> light
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    const CurrentIcon = themes.find(t => t.value === theme)?.icon ?? Monitor
    return (
      <button
        onClick={() => setTheme(next)}
        className="p-2 rounded-lg hover:bg-surface-tertiary transition-colors"
        aria-label={`Switch to ${next} theme`}
        title={`Theme: ${theme}`}
      >
        <CurrentIcon className="w-4 h-4 text-text-secondary" />
      </button>
    )
  }

  return (
    <div className="inline-flex rounded-lg border border-border p-0.5 bg-surface-secondary">
      {themes.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
            theme === value
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-text-secondary hover:text-foreground'
          }`}
          aria-label={`${label} theme`}
        >
          <Icon className="w-4 h-4" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
