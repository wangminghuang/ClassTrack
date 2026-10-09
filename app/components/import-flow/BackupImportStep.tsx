import type { ChangeEvent, RefObject } from 'react'
import { FileSelector } from '~/components/common/FileSelector'
import { Label } from '~/components/ui/label'

type BackupImportStepProps = {
  inputRef: RefObject<HTMLInputElement | null>
  fileName?: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}

export function BackupImportStep({ inputRef, fileName, onChange }: BackupImportStepProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-4 text-base leading-7 text-muted-foreground sm:text-sm sm:leading-6">
        请选择从数据管理页面导出的 ClassTrack 备份 JSON 文件。导入成功后会恢复学校、课程、考勤标记和当前周次等数据。
      </div>
      <div className="space-y-2">
        <Label htmlFor="backup-file" className="text-base sm:text-sm">
          备份 JSON 文件
        </Label>
        <FileSelector
          ref={inputRef}
          id="backup-file"
          accept=".json"
          fileName={fileName}
          placeholder="请选择 ClassTrack 备份文件"
          onChange={onChange}
        />
      </div>
    </div>
  )
}
