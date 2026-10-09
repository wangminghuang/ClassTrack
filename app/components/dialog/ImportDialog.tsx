import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { BackupImportStep } from '~/components/import-flow/BackupImportStep'
import { BookmarkletInstallStep } from '~/components/import-flow/BookmarkletInstallStep'
import { BookmarkletRunStep } from '~/components/import-flow/BookmarkletRunStep'
import { ImportSchoolStep } from '~/components/import-flow/ImportSchoolStep'
import { InAppImportStep } from '~/components/import-flow/InAppImportStep'
import { ParserImportStep } from '~/components/import-flow/ParserImportStep'
import { Stepper, StepperActions } from '~/components/stepper'
import { useImportFlow } from '~/components/import-flow/useImportFlow'

export default function ImportDialog() {
  const importFlow = useImportFlow()

  const renderStepContent = () => {
    if (importFlow.currentStep === 0) {
      return (
        <ImportSchoolStep
          selectedSchool={importFlow.activeSchool}
          selectedImportMethod={importFlow.selectedImportMethod}
          onSchoolChange={importFlow.handleSchoolChange}
          onImportMethodChange={importFlow.handleImportMethodChange}
          importMethodPolicy={importFlow.importMethodPolicy}
        />
      )
    }

    if (importFlow.isBackupImport) {
      return (
        <BackupImportStep
          inputRef={importFlow.backupFileInputRef}
          fileName={importFlow.backupFile?.name}
          onChange={importFlow.handleBackupFileChange}
        />
      )
    }

    if (importFlow.isNativeImport && importFlow.currentStep === 1) {
      return (
        <InAppImportStep
          term={importFlow.term}
          onTermChange={importFlow.setTerm}
          firstWeekStartDate={importFlow.parserFirstWeekStartDate}
          onFirstWeekStartDateChange={importFlow.handleParserFirstWeekStartDateChange}
          status={importFlow.nativeImportStatus}
          error={importFlow.nativeImportError}
        />
      )
    }

    if (importFlow.currentStep === 1) {
      return (
        <BookmarkletInstallStep
          adapter={importFlow.bookmarkletAdapter}
          term={importFlow.term}
          bookmarkletHref={importFlow.bookmarkletHref}
          onTermChange={importFlow.setTerm}
          onCopyBookmarklet={importFlow.handleCopyBookmarklet}
        />
      )
    }

    if (importFlow.currentStep === 2) {
      return <BookmarkletRunStep educationalSystemUrl={importFlow.bookmarkletAdapter?.educationalSystemUrl} />
    }

    return (
      <ParserImportStep
        inputRef={importFlow.parserFileInputRef}
        fileName={importFlow.parserFile?.name}
        selectedParserId={importFlow.selectedParserId}
        firstWeekStartDate={importFlow.parserFirstWeekStartDate}
        onFileChange={importFlow.handleParserFileChange}
        onParserChange={importFlow.setSelectedParserId}
        onFirstWeekStartDateChange={importFlow.handleParserFirstWeekStartDateChange}
      />
    )
  }

  return (
    <Dialog open={importFlow.showImportDialog} onOpenChange={importFlow.handleOpenChange}>
      <DialogContent className="fixed inset-0 left-0 top-0 flex h-screen max-h-screen w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 supports-[height:100dvh]:h-dvh supports-[height:100dvh]:max-h-dvh [&>button]:right-[calc(env(safe-area-inset-right)_+_1rem)] [&>button]:top-[calc(env(safe-area-inset-top)_+_1rem)] sm:inset-auto sm:left-[50%] sm:top-[50%] sm:grid sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-2xl sm:translate-x-[-50%] sm:translate-y-[-50%] sm:gap-4 sm:overflow-y-auto sm:rounded-md sm:border sm:p-6">
        <DialogHeader className="shrink-0 border-b bg-background pb-4 pl-[calc(env(safe-area-inset-left)_+_1rem)] pr-[calc(env(safe-area-inset-right)_+_3.5rem)] pt-[calc(env(safe-area-inset-top)_+_1rem)] text-left sm:border-0 sm:p-0">
          <DialogTitle className="text-lg">导入课程数据</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pl-[calc(env(safe-area-inset-left)_+_1rem)] pr-[calc(env(safe-area-inset-right)_+_1rem)] sm:flex-none sm:overflow-visible sm:px-0">
          <div className="space-y-5 py-4">
            <Stepper steps={importFlow.steps} currentStep={importFlow.currentStep} previousStep={importFlow.previousStep} />
            {renderStepContent()}
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-row gap-2 border-t bg-background py-3 pl-[calc(env(safe-area-inset-left)_+_1rem)] pr-[calc(env(safe-area-inset-right)_+_1rem)] pb-[calc(env(safe-area-inset-bottom)_+_0.75rem)] sm:justify-end sm:gap-0 sm:border-0 sm:p-0 sm:space-x-2">
          <StepperActions
            canGoBack={importFlow.canGoBack}
            isLastStep={importFlow.isLastStep}
            primaryLabel={importFlow.primaryLabel}
            primaryDisabled={importFlow.primaryDisabled}
            onBack={importFlow.goBack}
            onPrimary={importFlow.handlePrimaryAction}
            onCancel={() => importFlow.handleOpenChange(false)}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
