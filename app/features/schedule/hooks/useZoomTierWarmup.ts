import { useEffect } from 'react'
import type { RefObject } from 'react'
import { createCellLayoutJob, fitCourseCells, withCellLayoutScope } from '../cellLayout'
import { geometryKeyOf } from '../cellLayoutCache'
import {
  WARMUP_CELLS_PER_SLICE,
  WARMUP_IDLE_DELAY_MS,
  WARMUP_IDLE_TIMEOUT_MS,
  isWarmupStale,
  warmupSlices,
  warmupTiers,
} from '../zoomWarmup'

/** 离屏宿主与克隆网格的锚点，浏览器验收脚本据此确认预热**没有**动过真实 DOM。 */
export const ZOOM_WARMUP_ATTR = 'data-schedule-zoom-warmup'

export type ZoomTierWarmupOptions = {
  /** 真实网格（克隆的源）。 */
  gridRef: RefObject<HTMLElement | null>
  /** 真实滚动容器：提供内容宽，也是「用户一滚动就放弃」的监听点。 */
  scrollRef: RefObject<HTMLElement | null>
  /** 当前已提交档位；只预热它之外的档位。 */
  zoom: number
  isMobile: boolean
  /** 列模板（与几何读取器同一口径：关掉折叠空列时传 `'even'`）。 */
  columns: string
}

/**
 * 空闲预热：把「首次切到某个档位」那一次落定测量提前到用户看不见的空闲窗口。
 *
 * ## 为什么要克隆
 *
 * 预热要算的是「**在那个档位下**每个格子要丢几行、缩到哪一档、文字块多宽」，而算它的唯一可靠办法
 * 就是真的把格子摆成那个档位量一遍。直接改真实网格的宽度会让用户看见一次跳变，所以在离屏宿主里
 * 克隆一份网格、给它单独写上 `--schedule-zoom: T`，量完即弃 —— 真实 DOM 从头到尾没被碰过。
 *
 * ## 关键约束：克隆的盒子必须与真实网格逐项相同
 *
 * 快照按「几何 × 内容 × 档位」入库，几何键取（滚动容器内容宽 × **网格自身高度** × 列模板 × 断点）。
 * 宿主的尺寸因此不是随便定的：
 *
 * - 宽取滚容器 `clientWidth` —— 网格宽是「档位 × 这一项」，档位由 `--schedule-zoom` 单独给，
 *   于是克隆出来的网格宽恰好是真实档位下的宽度；
 * - 高取真实网格 `offsetHeight` —— 网格的 `min-h-full` 因此落在同一个高度上，行高一致。
 *
 * 两项都对上时，克隆格子的盒子与真实档位下的盒子逐像素一致，预热记下的快照才会被真实路径查到；
 * 万一哪天对不上，结果也只会是「预热白做」（键不同、查不到），不会让用户看到没算过的排布。
 *
 * ## 什么时候立刻收手
 *
 * 任何交互（`pointerdown` / `wheel` / `touchstart` / 滚动）都立刻取消并卸载克隆 —— 预热是
 * 「趁没人用的时候算」，抢在用户前面算完是赚，抢用户的时间是亏。几何与档位变化由 React 依赖
 * 触发重排，几何变化另有每片一次的复查（见 `isWarmupStale`）。
 *
 * 引擎不支持 `requestIdleCallback` 时整体跳过：预热是纯优化，不值得为它退回 `setTimeout` 抢帧。
 *
 * @param options 见 {@link ZoomTierWarmupOptions}。
 */
export function useZoomTierWarmup({ gridRef, scrollRef, zoom, isMobile, columns }: ZoomTierWarmupOptions): void {
  useEffect(() => {
    const requestIdle = globalThis.requestIdleCallback
    const cancelIdle = globalThis.cancelIdleCallback
    if (!requestIdle || !cancelIdle) return

    const grid = gridRef.current
    const scroll = scrollRef.current
    if (!grid || !scroll) return

    const width = scroll.clientWidth
    const height = grid.offsetHeight
    // 还没完成首次布局（宽或高为 0）时不做：这时候量出来的盒子不代表任何东西。
    if (width === 0 || height === 0) return

    const tiers = warmupTiers(zoom)
    if (tiers.length === 0) return

    const scope = { geometry: geometryKeyOf({ width, height }, columns, isMobile), cancelled: false }
    let timer: ReturnType<typeof setTimeout> | null = null
    let idle: number | null = null
    let host: HTMLElement | null = null
    let clone: HTMLElement | null = null
    let cells: HTMLElement[] = []
    let slices: Array<[number, number]> = []
    let tierIndex = 0
    let sliceIndex = 0

    const readCloneGeometry = () => geometryKeyOf({ width, height: clone?.offsetHeight ?? height }, columns, isMobile)

    const disposeHost = () => {
      host?.remove()
      host = null
      clone = null
      cells = []
      slices = []
    }

    const stop = () => {
      if (scope.cancelled) return

      scope.cancelled = true
      if (timer !== null) clearTimeout(timer)
      if (idle !== null) cancelIdle(idle)
      timer = null
      idle = null
      disposeHost()

      window.removeEventListener('pointerdown', stop, true)
      window.removeEventListener('wheel', stop, true)
      window.removeEventListener('touchstart', stop, true)
      scroll.removeEventListener('scroll', stop)
    }

    const mountClone = (tier: number) => {
      disposeHost()

      host = document.createElement('div')
      host.setAttribute(ZOOM_WARMUP_ATTR, String(tier))
      host.style.cssText = `position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;overflow:hidden;width:${width}px;height:${height}px`

      // 克隆整份网格：结构、类名、`data-course-key` 全部带过来，`prepare()` 会把上一轮留下的内联
      // 覆盖（隐藏的行 / `--cc-scale` / 文字块宽度）清干净，因此不需要额外复位。
      clone = grid.cloneNode(true) as HTMLElement
      clone.removeAttribute('data-schedule-grid')
      clone.style.setProperty('--schedule-zoom', String(tier))
      host.appendChild(clone)
      document.body.appendChild(host)

      cells = [...clone.querySelectorAll<HTMLElement>('[data-course-key]')]

      // 抹掉格子的锚点：预热是「不存在」的，任何全局读数都不该被这份克隆影响
      // （验收脚本按 `[data-course-cell]` 数格子、按格子断言排布，克隆混进去就是 36 格）。
      // 作业构造只看格子里面的 `[data-course-content]` / `[data-course-block]`，不受影响。
      for (const cell of cells) cell.removeAttribute('data-course-cell')

      slices = warmupSlices(cells.length, WARMUP_CELLS_PER_SLICE)
    }

    const runSlice = () => {
      idle = null
      if (scope.cancelled) return

      // 每片复一次几何：旋屏、折叠列开关、断点跨越都会在没有档位变化的情况下换掉几何。
      if (
        isWarmupStale(
          scope,
          grid.isConnected ? geometryKeyOf({ width: scroll.clientWidth, height: grid.offsetHeight }, columns, isMobile) : ''
        )
      ) {
        stop()
        return
      }

      const tier = tiers[tierIndex]
      if (!clone) mountClone(tier)

      const slice = slices[sliceIndex]
      if (slice) {
        const jobs = cells
          .slice(slice[0], slice[1])
          .map((cell) => createCellLayoutJob(cell, cell.dataset.courseKey ?? ''))
          .filter((job) => job !== null)

        // 档位与几何一起换：`fitCourseCells` 从这两个来源取「这批格子属于哪一档、什么盒子」，
        // 而它们平时由真实路径写入（`commit` 声明档位、`ScheduleTable` 注册读取器）。
        if (jobs.length > 0) {
          withCellLayoutScope({ tier, readGeometry: readCloneGeometry }, () => fitCourseCells(jobs))
        }

        sliceIndex += 1
      }

      if (sliceIndex >= slices.length) {
        // 这一档算完，换下一档：卸载旧克隆，下一片重新挂一份新档位的。
        tierIndex += 1
        sliceIndex = 0
        disposeHost()
        if (tierIndex >= tiers.length) {
          stop()
          return
        }
      }

      idle = requestIdle(runSlice, { timeout: WARMUP_IDLE_TIMEOUT_MS })
    }

    // 监听先挂上：静默期里用户一碰课表就整体放弃，不必等到第一片跑起来。
    window.addEventListener('pointerdown', stop, true)
    window.addEventListener('wheel', stop, true)
    window.addEventListener('touchstart', stop, true)
    scroll.addEventListener('scroll', stop, { passive: true })
    timer = setTimeout(() => {
      timer = null
      if (scope.cancelled) return

      idle = requestIdle(runSlice, { timeout: WARMUP_IDLE_TIMEOUT_MS })
    }, WARMUP_IDLE_DELAY_MS)

    return stop
  }, [gridRef, scrollRef, zoom, isMobile, columns])
}
