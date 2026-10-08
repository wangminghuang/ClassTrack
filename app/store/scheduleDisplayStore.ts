import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { PersistOptions } from 'zustand/middleware'
import type { CoursePaletteId } from '~/lib/types'

type ScheduleDisplayStore = {
  coursePalette: CoursePaletteId
  showAttendanceStatus: boolean
  showOutOfWeekCourses: boolean
  /**
   * 收窄「整周没有课程的日期列」，把宽度让给有课的日期。
   *
   * 默认关闭：它会让列宽随当前展示周变化（翻周时列宽跳动），属于用户显式选择才开启的取舍。
   */
  collapseEmptyWeekdayColumns: boolean
  /**
   * 手机端课表横向滑到最左/最右边缘后继续拖动时，用阻尼跟手位移 + 松手切上下周。
   *
   * 默认开启：它是「滑到边缘」才有反应的补强手势，不占用任何既有交互，关掉只是少一个翻周方式。
   */
  edgeSwipeWeekSwitch: boolean
  setCoursePalette: (value: CoursePaletteId) => void
  setShowAttendanceStatus: (value: boolean) => void
  setShowOutOfWeekCourses: (value: boolean) => void
  setCollapseEmptyWeekdayColumns: (value: boolean) => void
  setEdgeSwipeWeekSwitch: (value: boolean) => void
}

/** 真正落盘的字段：显示偏好，不包含 setter。 */
type ScheduleDisplayPersisted = Pick<
  ScheduleDisplayStore,
  'coursePalette' | 'showAttendanceStatus' | 'showOutOfWeekCourses' | 'collapseEmptyWeekdayColumns' | 'edgeSwipeWeekSwitch'
>

/**
 * 持久化策略。
 *
 * 单独导出是为了能被测试直接断言：这三个字段（初始值 / `partialize` / `merge`）必须同步维护，
 * 漏掉任何一处都会在「旧数据 + 新增字段」时静默丢值（见 `state-management.md` 的 Common Mistakes）。
 * 而 node 测试环境里没有 `localStorage`，`createJSONStorage` 的取值函数抛错后 `persist` 根本不会
 * 挂上 `store.persist` API，所以没法从 store 实例上读到这份配置。
 */
export const scheduleDisplayPersistOptions: PersistOptions<ScheduleDisplayStore, ScheduleDisplayPersisted> = {
  name: 'class-track-schedule-display',
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    coursePalette: state.coursePalette,
    showAttendanceStatus: state.showAttendanceStatus,
    showOutOfWeekCourses: state.showOutOfWeekCourses,
    collapseEmptyWeekdayColumns: state.collapseEmptyWeekdayColumns,
    edgeSwipeWeekSwitch: state.edgeSwipeWeekSwitch,
  }),
  merge: (persistedState, currentState) => {
    const persisted = persistedState as Partial<ScheduleDisplayPersisted> | undefined
    // 逐个字段回落到默认值：不能用 `{...currentState, ...persisted}`，那样旧数据里的
    // 缺失字段会以 undefined 覆盖掉默认值（`false` 是合法值，不能与「缺失」混为一谈）。
    return {
      ...currentState,
      coursePalette:
        persisted?.coursePalette === 'original' || persisted?.coursePalette === 'adjusted'
          ? persisted.coursePalette
          : currentState.coursePalette,
      showAttendanceStatus: persisted?.showAttendanceStatus ?? currentState.showAttendanceStatus,
      showOutOfWeekCourses: persisted?.showOutOfWeekCourses ?? currentState.showOutOfWeekCourses,
      collapseEmptyWeekdayColumns: persisted?.collapseEmptyWeekdayColumns ?? currentState.collapseEmptyWeekdayColumns,
      edgeSwipeWeekSwitch: persisted?.edgeSwipeWeekSwitch ?? currentState.edgeSwipeWeekSwitch,
    }
  },
}

export const useScheduleDisplayStore = create<ScheduleDisplayStore>()(
  persist(
    (set) => ({
      coursePalette: 'original',
      showAttendanceStatus: true,
      showOutOfWeekCourses: false,
      collapseEmptyWeekdayColumns: false,
      edgeSwipeWeekSwitch: true,
      setCoursePalette: (value) => set({ coursePalette: value }),
      setShowAttendanceStatus: (value) => set({ showAttendanceStatus: value }),
      setShowOutOfWeekCourses: (value) => set({ showOutOfWeekCourses: value }),
      setCollapseEmptyWeekdayColumns: (value) => set({ collapseEmptyWeekdayColumns: value }),
      setEdgeSwipeWeekSwitch: (value) => set({ edgeSwipeWeekSwitch: value }),
    }),
    scheduleDisplayPersistOptions
  )
)
