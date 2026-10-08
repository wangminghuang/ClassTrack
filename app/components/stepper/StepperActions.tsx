import { Button } from '~/components/ui/button'

type StepperActionsProps = {
  canGoBack: boolean
  isLastStep: boolean
  primaryLabel?: string
  primaryDisabled?: boolean
  backLabel?: string
  cancelLabel?: string
  onBack: () => void
  onPrimary: () => void
  onCancel?: () => void
}

export function StepperActions({
  canGoBack,
  isLastStep,
  primaryLabel = isLastStep ? '完成' : '下一步',
  primaryDisabled = false,
  backLabel = '上一步',
  cancelLabel = '取消',
  onBack,
  onPrimary,
  onCancel,
}: StepperActionsProps) {
  return (
    <>
      {onCancel && (
        <Button variant="outline" className="min-h-11 flex-none px-2 sm:min-h-9 sm:flex-initial sm:px-4" onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}
      {canGoBack && (
        <Button variant="outline" className="min-h-11 flex-none px-2 sm:min-h-9 sm:flex-initial sm:px-4" onClick={onBack}>
          {backLabel}
        </Button>
      )}
      <Button className="min-h-11 min-w-0 flex-1 px-2 sm:min-h-9 sm:flex-initial sm:px-4" onClick={onPrimary} disabled={primaryDisabled}>
        {primaryLabel}
      </Button>
    </>
  )
}
