import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { schools } from '~/lib/parsers'
import type { School } from '~/lib/types'
import type { ImportMethod } from '~/store/slices/uiSlice'
import type { ImportMethodPolicy } from '~/lib/import-methods'
import { ImportMethodList } from './ImportMethodList'

type ImportSchoolStepProps = {
  selectedSchool: School | null
  selectedImportMethod: ImportMethod
  /** 当前环境 + 学校下可选的导入方式；判定都在 `resolveImportMethodPolicy` 里，这里只渲染。 */
  importMethodPolicy: ImportMethodPolicy
  onSchoolChange: (school: School | null) => void
  onImportMethodChange: (method: ImportMethod) => void
}

export function ImportSchoolStep({
  selectedSchool,
  selectedImportMethod,
  importMethodPolicy,
  onSchoolChange,
  onImportMethodChange,
}: ImportSchoolStepProps) {
  const handleSchoolChange = (schoolId: string) => {
    onSchoolChange(schools.find((school) => school.id === schoolId) || null)
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="school" className="text-base sm:text-sm">
          学校
        </Label>
        <Select value={selectedSchool?.id} onValueChange={handleSchoolChange}>
          <SelectTrigger id="school" className="min-h-11 w-full text-base sm:min-h-8 sm:text-sm">
            <SelectValue placeholder="请选择学校" />
          </SelectTrigger>
          <SelectContent>
            {schools.map((school) => (
              <SelectItem key={school.id} value={school.id}>
                {school.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-base sm:text-sm">导入方式</Label>
        <ImportMethodList policy={importMethodPolicy} selectedMethod={selectedImportMethod} onSelect={onImportMethodChange} />
      </div>
    </div>
  )
}
