import type { ReactNode } from 'react'
import { Database, FileJson2, Smartphone } from 'lucide-react'
import { OptionCard } from '~/components/common/OptionCard'
import type { ImportMethod } from '~/store/slices/uiSlice'
import { IMPORT_METHOD_NOTICE, type ImportMethodPolicy } from '~/lib/import-methods'

/**
 * 每张导入方式卡片的文案与图标。
 *
 * 用 `Record<ImportMethod, ...>` 而不是数组：数组漏一项不会有类型错误，Record 漏一项立刻编译失败。
 * 顺序由策略决定（规范序的子序列），因此这里**不**排序。
 */
const IMPORT_METHOD_CARDS: Record<ImportMethod, { title: string; description: string; icon: ReactNode }> = {
  backup: {
    title: '导入已有数据',
    description: '用于换设备时恢复从数据管理页面导出的结构化数据。',
    icon: <Database className="size-4" />,
  },
  parser: {
    title: '从课程表解析',
    description: '导入学校课程表 JSON，并通过解析器生成课程数据。',
    icon: <FileJson2 className="size-4" />,
  },
  'native-webview': {
    title: '应用内打开教务系统',
    description: '在 Android App 内登录并直接捕获当前课表，无需安装书签脚本。',
    icon: <Smartphone className="size-4" />,
  },
}

type ImportMethodListProps = {
  /** 当前环境 + 学校下可选的导入方式（见 `resolveImportMethodPolicy`）。 */
  policy: ImportMethodPolicy
  selectedMethod: ImportMethod
  onSelect: (method: ImportMethod) => void
}

/**
 * 导入方式卡片列表 + 该环境下需要解释的一句话。
 *
 * **只渲染策略给的东西**：收窄口径（安卓只留应用内 + 备份）由 `resolveImportMethodPolicy` 决定，
 * 这里不做任何平台判断 —— 判断散进组件里就再也测不到了。
 */
export function ImportMethodList({ policy, selectedMethod, onSelect }: ImportMethodListProps) {
  return (
    <div className="grid gap-3 sm:gap-2" data-method-count={policy.methods.length}>
      {policy.methods.map((method) => {
        const card = IMPORT_METHOD_CARDS[method]

        return (
          <OptionCard
            key={method}
            title={card.title}
            description={card.description}
            icon={card.icon}
            selected={selectedMethod === method}
            onClick={() => onSelect(method)}
          />
        )
      })}

      {policy.noticeCode ? (
        // 文案自带换行（两句话分两行），因此必须 whitespace-pre-line。
        <p
          role="status"
          className="rounded-md border bg-muted/30 p-4 text-base leading-7 whitespace-pre-line text-muted-foreground sm:p-3 sm:text-sm sm:leading-6"
        >
          {IMPORT_METHOD_NOTICE[policy.noticeCode]}
        </p>
      ) : null}
    </div>
  )
}
