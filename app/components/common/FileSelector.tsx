import { forwardRef, type ChangeEvent, type ReactNode } from 'react'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/utils'

type FileSelectorProps = {
  id?: string
  accept?: string
  fileName?: string
  placeholder: string
  icon?: ReactNode
  className?: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}

export const FileSelector = forwardRef<HTMLInputElement, FileSelectorProps>(
  ({ id, accept, fileName, placeholder, icon, className, onChange }, ref) => {
    return (
      <>
        <Input ref={ref} id={id} type="file" accept={accept} onChange={onChange} className="hidden" />
        <button
          type="button"
          onClick={() => {
            if (ref && typeof ref !== 'function') {
              ref.current?.click()
            }
          }}
          className={cn(
            'flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-base shadow-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-h-10 sm:text-sm',
            className
          )}
        >
          {icon && <span className="flex shrink-0 items-center text-muted-foreground">{icon}</span>}
          <span className={fileName ? 'truncate text-foreground' : 'text-muted-foreground'}>{fileName || placeholder}</span>
        </button>
      </>
    )
  }
)

FileSelector.displayName = 'FileSelector'
