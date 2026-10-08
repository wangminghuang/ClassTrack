import { StepperItem, type StepperItemData } from './StepperItem'

type StepperProps = {
  steps: StepperItemData[]
  currentStep: number
  previousStep: number
}

export function Stepper({ steps, currentStep, previousStep }: StepperProps) {
  const currentStepLabel = steps[currentStep]?.label ?? ''
  const progress = steps.length === 0 ? 0 : ((currentStep + 1) / steps.length) * 100

  return (
    <>
      <div className="space-y-2 rounded-md border bg-muted/20 px-3 py-3 sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <span className="shrink-0 text-sm text-muted-foreground">
            第 {currentStep + 1} 步 / 共 {steps.length} 步
          </span>
          <span className="truncate text-base font-semibold text-foreground">{currentStepLabel}</span>
        </div>
        <div
          role="progressbar"
          aria-label="导入进度"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={steps.length === 0 ? 0 : currentStep + 1}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="hidden rounded-md border bg-muted/20 px-4 py-4 sm:block">
        <div className="flex items-start justify-between gap-2">
          {steps.map((step, index) => (
            <StepperItem
              key={step.id}
              step={step}
              index={index}
              currentStep={currentStep}
              previousStep={previousStep}
              isLast={index === steps.length - 1}
            />
          ))}
        </div>
      </div>
    </>
  )
}
