import type { ReactNode } from 'react'

type ImportStepDescriptionProps = {
  steps: ReactNode[]
}

export function ImportStepDescription({ steps }: ImportStepDescriptionProps) {
  return (
    <div className="rounded-md border bg-muted/30 p-4 text-base leading-7 text-muted-foreground sm:text-sm sm:leading-6">
      <ol className="list-decimal space-y-2 pl-5 sm:space-y-1">
        {steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
    </div>
  )
}
