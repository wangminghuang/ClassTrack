/**
 * 档位空闲预热的纯策略。
 *
 * 与 DOM 分开的理由：**选哪些档位 / 怎么分片 / 前提还在不在** 这三件事都能在 node 里单测，
 * 于是 `useZoomTierWarmup` 只剩下「克隆、排帧、卸载」这类没法脱离浏览器断言的接线。
 */
import { ZOOM_TIERS } from './constants'

/**
 * 首片之前的静默期：让首屏的布局、字体与首次真实适配先落地，避免预热去和它们抢同一段空闲时间。
 */
export const WARMUP_IDLE_DELAY_MS = 500

/**
 * 每片测几个格子。
 *
 * 定这个数的依据是实测：18 格走一次实测在 `research/p4-profile.json.cpuprofile` 里是 ~39ms 的
 * `overflows()` 自身耗时（每格 2~3ms），4 格一片约 8ms，落在一次 `requestIdleCallback` 的
 * 典型预算（~10ms）之内；分得太细则空闲回调的调度开销占比过高。
 */
export const WARMUP_CELLS_PER_SLICE = 4

/**
 * 空闲回调的兜底超时。
 *
 * 持续忙碌时 `requestIdleCallback` 可能长时间不给机会，给个上界让它有终点；真正的安全阀是
 * 「任何交互立刻取消」（见 `useZoomTierWarmup`），而不是这个超时。
 */
export const WARMUP_IDLE_TIMEOUT_MS = 1500

/**
 * 要预热的档位。
 *
 * 只预热**当前档位之外**的档位：当前档位已经在真实适配里填过一轮，不需要再算。
 *
 * @param currentTier 当前已提交档位。
 * @returns 待预热的档位（顺序与 `ZOOM_TIERS` 一致）。
 */
export function warmupTiers(currentTier: number): number[] {
  return ZOOM_TIERS.filter((tier) => tier !== currentTier)
}

/**
 * 把 `total` 个格子切成每片 `perSlice` 个的下标区间（左闭右开）。
 *
 * 保证不重不漏：预热必须覆盖全部格子，漏掉的格子会在用户真的切到那一档时退回实测 ——
 * 这正是预热想消掉的那一下。
 *
 * @param total 待预热的格子数。
 * @param perSlice 每片格子数；小于 1 或被省略时取 {@link WARMUP_CELLS_PER_SLICE}。
 * @returns 下标区间列表；`total <= 0` 时为空。
 */
export function warmupSlices(total: number, perSlice: number = WARMUP_CELLS_PER_SLICE): Array<[number, number]> {
  const size = Math.max(1, Math.trunc(perSlice))
  const slices: Array<[number, number]> = []

  for (let from = 0; from < total; from += size) {
    slices.push([from, Math.min(from + size, total)])
  }

  return slices
}

/** 一批预热启动时记下的前提。 */
export type WarmupScope = {
  /** 启动时读到的几何键。 */
  geometry: string
  /** 是否已被取消（交互 / 卸载 / 档位变化）。 */
  cancelled: boolean
}

/**
 * 这一批预热的前提是否已经失效。
 *
 * 失效就意味着**整体放弃**，不做「按新几何继续」的补救：换几何后网格的列宽与行高都变了，
 * 已经算完的那部分快照与新几何不再配套，留着只会让缓存里混进一批永远不该被读到的条目
 * （它们查不到，但会白占容量）。
 *
 * @param scope 启动时记下的前提。
 * @param currentGeometry 当前几何键。
 * @returns 是否应当放弃这一批预热。
 */
export function isWarmupStale(scope: WarmupScope, currentGeometry: string): boolean {
  return scope.cancelled || scope.geometry !== currentGeometry
}
