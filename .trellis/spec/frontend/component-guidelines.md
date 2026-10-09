# Component Guidelines

> 组件采用 TypeScript 函数组件、Tailwind 原子类和项目已有的共享 UI 组件。

---

## Overview

组件按复用范围放置：单 feature 组件在 `app/features/<feature>/components/`，跨 feature 组件在 `app/components/`，shadcn/ui 生成物在 `app/components/ui/`。页面和私有组件通常使用 default export；UI 组件及少量共享封装使用 named export。

展示型 JSX 通常保持直接，不为简单布局添加注释；日期、迁移和统计等复杂逻辑才写中文 JSDoc。交互反馈使用 `sonner` 的 `toast`，图标使用 `lucide-react`。

---

## Component Structure

业务 feature 页面和私有组件的 props 类型通常紧邻组件定义，参数位置直接解构，不使用 `React.FC` 或 PropTypes。该模式不是全仓硬性事实：shadcn/ui 生成物和少量共享组件仍存在 `interface`，例如 `app/components/ui/badge.tsx` 的 `BadgeProps`、`app/components/ui/date-picker.tsx` 的 `DatePickerProps` 和 `app/components/common/BookmarkletButton.tsx` 的 `BookmarkletButtonProps`；新增代码应跟随所属目录的现有模式：

```tsx
import { format } from 'date-fns'
import type { Class, ClassMark } from '~/lib/types'
import { cn } from '~/lib/utils'
import { dayNames, sections, weekDays } from './constants'
import ScheduleCourseCell from './ScheduleCourseCell'
import { getDayDate } from './utils'

type ScheduleTableProps = {
  weekClasses: Class[]
  classMarks: Record<string, ClassMark>
  currentWeek: number
  firstWeekStartDate: string | null
  onCourseClick: (course: Class) => void
}

export default function ScheduleTable({ weekClasses, classMarks, currentWeek, firstWeekStartDate, onCourseClick }: ScheduleTableProps) {
  const getClassMark = (classId: string, week: number) => classMarks[`${classId}-${week}`]
```

以上是 `app/features/schedule/ScheduleTable.tsx` 的真实文件头和 props/局部计算；其余 JSX 继续返回完整课程表网格。

实际的完整布局实现见 `app/features/schedule/ScheduleTable.tsx`；私有子组件通过同目录相对路径导入。`app/components/markdown/MarkdownEditor.tsx` 是共享封装的例子，使用 named export 的形式与 UI 组件保持一致。

---

## Props Conventions

使用不导出的 `type XxxProps = {}`，字段名称表达业务含义，回调以 `onXxx` 命名。事件回调参数使用共享类型或就近定义的明确类型；不透传 `children`，除布局组件确实需要组合内容的场景。

跨 feature 的类型从 `~/` 别名导入，同一 feature 的私有组件用 `./` 导入。类型必须使用 `import type`：

```tsx
import type { Class, ClassMark } from '~/lib/types'
import { getCourseColor } from './utils'

type ScheduleCourseCellProps = {
  course: Class
  mark: ClassMark | undefined
  onClick: () => void
}

export default function ScheduleCourseCell({ course, mark, onClick }: ScheduleCourseCellProps) {
  const isAttended = !!mark?.isAttended
  const note = mark?.note || ''
  const courseColor = getCourseColor(course.courseId)
```

上述 props 结构对应 `app/features/schedule/ScheduleCourseCell.tsx` 的真实用法；实际项目的类型字段以共享 `ClassMark` 为准，不要为方便而使用 `any`。

---

## Styling Patterns

样式直接写 Tailwind 原子类，不使用 CSS Module 或 styled-components。条件类名统一通过 `cn()`（`app/lib/utils.ts`）合并，响应式采用移动优先的 `sm:`、`md:` 断点；JS 侧响应式判断使用 `app/hooks/use-mobile.ts` 的 `useIsMobile()`。布局常见 `min-h-0 min-w-0 flex-1 overflow-hidden`，用于避免 flex 子项溢出。

```tsx
<div className={cn('flex items-center border-b border-border bg-muted/60 text-xs', day !== 7 && 'border-r')}>
  <span>{dayNames[day]}</span>
</div>
```

这段模式来自 `app/features/schedule/ScheduleTable.tsx`。图标使用 `lucide-react`，导航中可见类似 `<item.icon className="h-5 w-5" />` 的写法。`app/components/ui/button.tsx` 等 shadcn 文件允许直接改动，优先调整 `className` 或 `cva` variants，而不是整体替换生成文件。

### 手机多步骤对话框

手机上的多步骤流程若包含较长说明，应让 Dialog 在窄屏占满视口，把标题和操作栏留在滚动区之外，只滚动中间内容；左右、上下留白要考虑 `safe-area-inset-*`。动态视口高度以 `100vh` 为基础，并用 Tailwind `supports-[height:100dvh]` 变体覆盖，保留旧 WebView 可用的高度兜底。到 `sm` 断点再恢复居中 Dialog。

不要把桌面完整步骤条压缩到手机宽度。手机显示当前步骤名称、步数和简短进度条，桌面继续显示完整步骤条；正文至少用 `text-base leading-7`，触控按钮至少高 44px，再在 `sm` 断点恢复桌面字号和尺寸。当前实现见 `app/components/dialog/ImportDialog.tsx`、`app/components/stepper/Stepper.tsx` 和 `app/components/stepper/StepperActions.tsx`。

---

## Accessibility

当前代码没有系统性的 `aria-label`、键盘可达性或语义 HTML 规范，`app/features/schedule/ScheduleCourseCell.tsx`、layout 中的 `NavItem` 等存在 `div`/`button` 混用。因此本 bootstrap spec 不把新增 a11y 规则伪装成现行团队标准；新增组件应先遵循邻近组件的实际模式，若任务明确要求无障碍再单独补齐并验证。

---

## Common Mistakes

- 不要在 `app/routes/` 中实现页面逻辑，路由文件应继续保持 re-export 壳。
- feature 业务组件不要用 `React.FC`、未声明 props 的隐式 `children`，也不要无视同目录既有的非导出 `type XxxProps` 模式。`app/components/ui/*` 及少量共享组件已有 `interface`（如 `badge.tsx`、`date-picker.tsx`、`BookmarkletButton.tsx`），不要为统一文档而无关重构这些现存代码。
- 不要引入 CSS Module/styled-components，也不要手写字符串拼接条件 class；使用 Tailwind 和 `cn()`。
- `ScheduleTable` 当前的 `occupiedCells` 是每次 render 新建的 `Set`，这是现状而非强制推广的性能范式。
- `app/components/ui/{badge,button,sidebar}.tsx` 当前有 `react-refresh/only-export-components` warning；这属于已有 shadcn 导出形态，不要为了消除 warning 进行无关重构。
