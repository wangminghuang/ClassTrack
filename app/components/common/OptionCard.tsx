import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

type OptionCardProps = {
  title: string
  description: string
  icon?: ReactNode
  selected?: boolean
  disabled?: boolean
  onClick: () => void
}

export function OptionCard({ title, description, icon, selected = false, disabled = false, onClick }: OptionCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 rounded-md border bg-card px-4 py-4 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:py-3',
        selected ? 'border-primary ring-2 ring-primary/10' : 'border-border'
      )}
    >
      {icon && (
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-md border sm:size-9',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted text-muted-foreground'
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-base font-medium text-foreground sm:text-sm">{title}</span>
        <span className="block text-sm leading-6 text-muted-foreground sm:text-xs sm:leading-5">{description}</span>
      </span>
    </button>
  )
}
