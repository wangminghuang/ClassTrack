import type { Class, School, AppData, ClassMark, CourseField, Semester } from '~/lib/types'
import type { StoreSlice } from '../types'
import { createSemester as createSemesterModel, ensureUniqueSemesterId, inferSemesterCode, formatSemesterName } from '../migrations'
import { createPastClassMarks, getCourseKey, getMarkKey } from '../utils'

export type CreateSemesterInput = {
  name: string
  code?: string
  firstWeekStartDate?: string | null
}

export interface DataSlice extends AppData {
  setSchool: (school: School | null) => void
  setClasses: (classes: Class[]) => void
  /** 追加一节课（手动创建的补课与导入课程完全同构，仅多一个 `isManual` 标记）。 */
  addClass: (classItem: Class) => void
  /** 批量追加课程（如按日期一次补过来整天的课）。 */
  addClasses: (classItems: Class[]) => void
  /** 删除一节课，并连带清掉它的所有出勤/备注标记（主要用于撤销手动补课）。 */
  removeClass: (classId: string) => void
  setClassMarks: (marks: Record<string, ClassMark>) => void
  toggleAttendance: (classId: string, week: number) => void
  markWeekAsAttended: (classIds: string[], week: number) => void
  markWeekAsUnattended: (classIds: string[], week: number) => void
  /** 放假：把这些课在该周一次性置为「已上」并把备注写成节日名称。 */
  applyHoliday: (classIds: string[], week: number, note: string) => void
  setNote: (classId: string, week: number, note: string) => void
  setCurrentWeek: (week: number) => void
  setIsInitialized: (initialized: boolean) => void
  resetData: () => void
  importClasses: (data: unknown, parser: (data: unknown) => Class[], options?: { firstWeekStartDate?: string | null }) => Class[]
  setFirstWeekStartDate: (date: string | null) => void
  createSemester: (input: CreateSemesterInput) => Semester
  deleteSemester: (semesterId: string) => void
  updateCourseField: (courseKey: string, fieldId: string, patch: Partial<Pick<CourseField, 'label' | 'content'>>) => void
  addCourseField: (courseKey: string) => string
  deleteCourseField: (courseKey: string, fieldId: string) => void
  setCurrentSemester: (semesterId: string) => void
}

export const createDataSlice: StoreSlice<DataSlice> = (set, get) => ({
  school: null,
  classes: [],
  classMarks: {},
  currentWeek: 1,
  isInitialized: false,
  firstWeekStartDate: null,
  semesters: [],
  currentSemesterId: null,
  courseMetadata: {},
  schemaVersion: 4,

  setSchool: (school) => {
    set((state) => {
      state.school = school
      const semester = getCurrentSemester(state)
      if (semester) {
        semester.schoolId = school?.id
        semester.updatedAt = new Date().toISOString()
      }
    })
  },

  setClasses: (classes) => {
    set((state) => {
      state.classes = classes
      syncCurrentSemester(state, { classes })
    })
  },

  addClass: (classItem) => {
    set((state) => {
      state.classes.push(classItem)
      syncCurrentSemester(state, { classes: state.classes })
    })
  },

  addClasses: (classItems) => {
    if (classItems.length === 0) return
    set((state) => {
      state.classes.push(...classItems)
      syncCurrentSemester(state, { classes: state.classes })
    })
  },

  removeClass: (classId) => {
    set((state) => {
      const index = state.classes.findIndex((classItem) => classItem.id === classId)
      if (index === -1) return

      state.classes.splice(index, 1)
      // 连带清掉这门课在所有周次的标记：标记键是 `${classId}-${week}`。
      for (const key of Object.keys(state.classMarks)) {
        if (state.classMarks[key].classId === classId) delete state.classMarks[key]
      }
      syncCurrentSemester(state, { classes: state.classes, classMarks: state.classMarks })
    })
  },

  setClassMarks: (marks) => {
    set((state) => {
      state.classMarks = marks
      syncCurrentSemester(state, { classMarks: marks })
    })
  },

  toggleAttendance: (classId, week) => {
    set((state) => {
      const key = getMarkKey(classId, week)
      if (!state.classMarks[key]) {
        state.classMarks[key] = {
          classId,
          week,
          isAttended: true,
          attendanceMarked: true,
          note: '',
        }
      } else {
        state.classMarks[key].isAttended = !state.classMarks[key].isAttended
        state.classMarks[key].attendanceMarked = true
      }
      syncCurrentSemester(state, { classMarks: state.classMarks })
    })
  },

  markWeekAsAttended: (classIds, week) => {
    set((state) => {
      classIds.forEach((classId) => {
        const key = getMarkKey(classId, week)
        if (!state.classMarks[key]) {
          state.classMarks[key] = {
            classId,
            week,
            isAttended: true,
            attendanceMarked: true,
            note: '',
          }
        } else {
          state.classMarks[key].isAttended = true
          state.classMarks[key].attendanceMarked = true
        }
      })
      syncCurrentSemester(state, { classMarks: state.classMarks })
    })
  },

  markWeekAsUnattended: (classIds, week) => {
    set((state) => {
      classIds.forEach((classId) => {
        const key = getMarkKey(classId, week)
        if (!state.classMarks[key]) {
          state.classMarks[key] = {
            classId,
            week,
            isAttended: false,
            attendanceMarked: true,
            note: '',
          }
        } else {
          state.classMarks[key].isAttended = false
          state.classMarks[key].attendanceMarked = true
        }
      })
      syncCurrentSemester(state, { classMarks: state.classMarks })
    })
  },

  applyHoliday: (classIds, week, note) => {
    set((state) => {
      classIds.forEach((classId) => {
        const key = getMarkKey(classId, week)
        if (!state.classMarks[key]) {
          state.classMarks[key] = {
            classId,
            week,
            isAttended: true,
            attendanceMarked: true,
            note,
          }
        } else {
          state.classMarks[key].isAttended = true
          state.classMarks[key].attendanceMarked = true
          state.classMarks[key].note = note
        }
      })
      syncCurrentSemester(state, { classMarks: state.classMarks })
    })
  },

  setNote: (classId, week, note) => {
    set((state) => {
      const key = getMarkKey(classId, week)
      if (!state.classMarks[key]) {
        state.classMarks[key] = {
          classId,
          week,
          isAttended: false,
          // 只在标记不存在时新建，也就是「只写了备注」：不构成一次出勤判断（看板按未标记计）
          attendanceMarked: false,
          note,
        }
      } else {
        state.classMarks[key].note = note
      }
      syncCurrentSemester(state, { classMarks: state.classMarks })
    })
  },

  setCurrentWeek: (week) => {
    set((state) => {
      state.currentWeek = week
      syncCurrentSemester(state, { currentWeek: week })
    })
  },

  setIsInitialized: (initialized) => {
    set({ isInitialized: initialized })
  },

  resetData: () => {
    set({
      school: null,
      classes: [],
      classMarks: {},
      currentWeek: 1,
      isInitialized: false,
      firstWeekStartDate: null,
      semesters: [],
      currentSemesterId: null,
      courseMetadata: {},
      schemaVersion: 4,
    })
  },

  importClasses: (data, parser, options) => {
    const classes = parser(data)
    const { currentWeek, firstWeekStartDate, school } = get()
    const effectiveFirstWeekStartDate = options?.firstWeekStartDate ?? firstWeekStartDate
    const pastClassMarks = createPastClassMarks(classes, effectiveFirstWeekStartDate, currentWeek)
    const importedCode = inferSemesterCode(classes)

    set((state) => {
      const nextMarks = {
        ...pastClassMarks,
        ...state.classMarks,
      }
      const currentSemester = getCurrentSemester(state)
      const shouldCreateSemester =
        !currentSemester ||
        Boolean(currentSemester.classes.length > 0 && importedCode && currentSemester.code && currentSemester.code !== importedCode)

      if (shouldCreateSemester) {
        const semester = ensureUniqueSemesterId(
          createSemesterModel({
            name: formatSemesterName(importedCode) || importedCode || '新导入学期',
            code: importedCode,
            schoolId: school?.id,
            classes,
            classMarks: nextMarks,
            currentWeek,
            firstWeekStartDate: effectiveFirstWeekStartDate,
          }),
          state.semesters
        )

        state.semesters.push(semester)
        state.currentSemesterId = semester.id
        state.classes = semester.classes
        state.classMarks = semester.classMarks
        state.currentWeek = semester.currentWeek
        state.firstWeekStartDate = semester.firstWeekStartDate
        state.courseMetadata = semester.courseMetadata
        state.isInitialized = true
        return
      }

      state.classes = classes
      state.classMarks = nextMarks
      state.firstWeekStartDate = effectiveFirstWeekStartDate
      state.isInitialized = true
      syncCurrentSemester(state, {
        classes,
        classMarks: nextMarks,
        firstWeekStartDate: effectiveFirstWeekStartDate,
        code: currentSemester?.code || importedCode,
        name: currentSemester?.name || formatSemesterName(importedCode) || importedCode || '当前学期',
        schoolId: school?.id,
      })
    })
    return classes
  },

  setFirstWeekStartDate: (date) => {
    set((state) => {
      state.firstWeekStartDate = date
      syncCurrentSemester(state, { firstWeekStartDate: date })
    })
  },

  createSemester: (input) => {
    const state = get()
    const semester = ensureUniqueSemesterId(
      createSemesterModel({
        name: input.name,
        code: input.code,
        schoolId: state.school?.id,
        firstWeekStartDate: input.firstWeekStartDate ?? null,
      }),
      state.semesters
    )

    set((draft) => {
      draft.semesters.push(semester)
      draft.currentSemesterId = semester.id
      draft.classes = semester.classes
      draft.classMarks = semester.classMarks
      draft.currentWeek = semester.currentWeek
      draft.firstWeekStartDate = semester.firstWeekStartDate
      draft.courseMetadata = semester.courseMetadata
      draft.isInitialized = semester.classes.length > 0
    })

    return semester
  },

  deleteSemester: (semesterId) => {
    set((state) => {
      const deletedIndex = state.semesters.findIndex((semester) => semester.id === semesterId)
      if (deletedIndex === -1) return

      state.semesters.splice(deletedIndex, 1)

      if (state.currentSemesterId !== semesterId) return

      const nextSemester = state.semesters[deletedIndex] || state.semesters[deletedIndex - 1]
      if (!nextSemester) {
        state.currentSemesterId = null
        state.classes = []
        state.classMarks = {}
        state.currentWeek = 1
        state.firstWeekStartDate = null
        state.courseMetadata = {}
        state.isInitialized = false
        return
      }

      state.currentSemesterId = nextSemester.id
      state.classes = nextSemester.classes
      state.classMarks = nextSemester.classMarks
      state.currentWeek = nextSemester.currentWeek
      state.firstWeekStartDate = nextSemester.firstWeekStartDate
      state.courseMetadata = nextSemester.courseMetadata
      state.isInitialized = nextSemester.classes.length > 0
    })
  },

  setCurrentSemester: (semesterId) => {
    set((state) => {
      const semester = state.semesters.find((item) => item.id === semesterId)
      if (!semester) return

      state.currentSemesterId = semester.id
      state.classes = semester.classes
      state.classMarks = semester.classMarks
      state.currentWeek = semester.currentWeek
      state.firstWeekStartDate = semester.firstWeekStartDate
      state.courseMetadata = semester.courseMetadata
      state.isInitialized = semester.classes.length > 0 || state.isInitialized
    })
  },

  updateCourseField: (courseKey, fieldId, patch) => {
    set((state) => {
      const metadata = ensureCourseMetadata(state, courseKey)
      const field = metadata.fields.find((item) => item.id === fieldId)
      if (!field) return

      if (patch.label !== undefined) field.label = patch.label
      if (patch.content !== undefined) field.content = patch.content
      syncCurrentSemester(state, { courseMetadata: state.courseMetadata })
    })
  },

  addCourseField: (courseKey) => {
    const fieldId = createCourseFieldId()

    set((state) => {
      const metadata = ensureCourseMetadata(state, courseKey)
      metadata.fields.push({
        id: fieldId,
        label: '新字段',
        content: '',
        contentType: 'text',
        canDelete: true,
      })
      syncCurrentSemester(state, { courseMetadata: state.courseMetadata })
    })

    return fieldId
  },

  deleteCourseField: (courseKey, fieldId) => {
    set((state) => {
      const metadata = ensureCourseMetadata(state, courseKey)
      const fieldIndex = metadata.fields.findIndex((item) => item.id === fieldId)
      if (fieldIndex === -1 || !metadata.fields[fieldIndex].canDelete) return

      metadata.fields.splice(fieldIndex, 1)
      syncCurrentSemester(state, { courseMetadata: state.courseMetadata })
    })
  },
})

function getCurrentSemester(state: Pick<DataSlice, 'semesters' | 'currentSemesterId'>) {
  return state.semesters.find((semester) => semester.id === state.currentSemesterId)
}

function syncCurrentSemester(state: DataSlice, patch: Partial<Semester>) {
  const semester = getCurrentSemester(state)
  if (!semester) return

  Object.assign(semester, patch, { updatedAt: new Date().toISOString() })
}

function ensureCourseMetadata(state: DataSlice, courseKey: string) {
  const metadata = state.courseMetadata[courseKey]
  if (metadata) return metadata

  const nextMetadata = {
    fields: [
      {
        id: 'builtin-teacher',
        label: '上课教师',
        content: findCourseClass(state.classes, courseKey)?.teacher || '未记录教师',
        contentType: 'text' as const,
        canDelete: false,
      },
      {
        id: 'builtin-course-id',
        label: '课程号',
        content: findCourseClass(state.classes, courseKey)?.courseId || '未记录课程号',
        contentType: 'text' as const,
        canDelete: false,
      },
      {
        id: 'builtin-note',
        label: '备注',
        content: '',
        contentType: 'markdown' as const,
        canDelete: false,
      },
    ],
  }

  state.courseMetadata[courseKey] = nextMetadata
  return nextMetadata
}

function findCourseClass(classes: Class[], courseKey: string) {
  return classes.find((classItem) => getCourseKey(classItem) === courseKey)
}

function createCourseFieldId() {
  return `field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
