/**
 * VehiclePicker — "What do you drive?"
 *
 * Full-screen sheet on phones, centered card on desktop. Type to filter
 * ("taycan", "ioniq", "tesla"); the list is grouped by make. Picking a car
 * sets its charge port, which drives the compatibility filter on the map.
 * "Any car" clears it.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Car, Check, Search, X } from 'lucide-react'
import { cn } from '../lib/utils'
import { PORT_LABEL, VEHICLES, type Vehicle } from '../lib/plugs'

type Props = {
  open: boolean
  selectedId: string | null
  onPick: (v: Vehicle | null) => void
  onClose: () => void
}

export default function VehiclePicker({ open, selectedId, onPick, onClose }: Props) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Keep the latest onClose without re-running the open effect: the parent
  // passes a new arrow every render, and re-running would wipe the search.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    setQ('')
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current()
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hits = VEHICLES.filter((v) => !needle || `${v.label} ${v.group} ${PORT_LABEL[v.port]}`.toLowerCase().includes(needle))
    const m = new Map<string, Vehicle[]>()
    for (const v of hits) m.set(v.group, [...(m.get(v.group) ?? []), v])
    return [...m.entries()]
  }, [q])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/60 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose your car"
        data-testid="vehicle-picker"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[92dvh] w-full flex-col rounded-t-2xl border border-border bg-card shadow-2xl md:h-[70vh] md:max-w-md md:rounded-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border p-4">
          <Car className="size-5 text-primary" />
          <h2 className="flex-1 text-base font-semibold">What do you drive?</h2>
          <button onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-accent">
            <X className="size-5" />
          </button>
        </div>

        <div className="p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search — Taycan, Ioniq 5, Model Y…"
              aria-label="Search vehicles"
              className="h-12 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring md:text-sm"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => onPick(null)}
            className={cn(
              'mb-2 flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-accent',
              !selectedId && 'bg-accent',
            )}
          >
            <span className="flex-1 font-medium">Any car — show every station</span>
            {!selectedId && <Check className="size-4 text-primary" />}
          </button>

          {groups.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Not listed? Pick your charge port under “By charge port” — search “port”.
            </p>
          )}

          {groups.map(([group, list]) => (
            <div key={group} className="mb-3">
              <h3 className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{group}</h3>
              {list.map((v) => (
                <button
                  key={v.id}
                  onClick={() => onPick(v)}
                  className={cn(
                    'flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-accent',
                    selectedId === v.id && 'bg-accent',
                  )}
                >
                  <span className="flex-1">{v.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{PORT_LABEL[v.port]}</span>
                  {selectedId === v.id && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          ))}

          <p className="px-3 pb-4 pt-2 text-xs text-muted-foreground">
            Several makers switched from CCS1 to the Tesla (NACS) port around 2025. If unsure, check the plug on your car.
          </p>
        </div>
      </div>
    </div>
  )
}
