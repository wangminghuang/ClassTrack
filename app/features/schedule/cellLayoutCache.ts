/**
 * 档位排布的预计算缓存。
 *
 * 要解决的问题：`cellLayout.ts` 的 `fitCourseCells()` 每个阶段都是「先写 DOM、再读 `scrollHeight`」，
 * 一次适配最多产生 **9N 次强制布局**（研究读数：`overflows()` 占 CPU 采样 67.3%）。
 * 关卡落在「档位切换」上时，这一次适配会让落定帧多出上百毫秒的停顿。
 * 于是把**已经算出来过**的结果按（几何 × 内容 × 档位）存下来，切换档位时纯写套用、零测量。
 *
 * **正确性交给键，而不是交给失效逻辑**：
 *
 * - `geometryKey` = 容器宽高 × 断点 × 列折叠开关 —— 课程格的盒子尺寸是它的纯函数；
 * - `contentKey`  = 课程号 + 课名 / 教室 / 教师 / 单双周 / 备注 —— 适配结果是它的纯函数；
 * - `tierKey`     = 档位。
 *
 * 三个键任一不同就是另一个条目。因此「内容改了却忘了清缓存」这类漏法在结构上不可能发生：
 * 内容一改 `contentKey` 就变，旧条目永远不会被读到，只剩内存回收问题
 * （由 `geometryKey` 变更整表丢弃 + 条目上限兜底）。
 *
 * 本模块不碰 DOM，可在 vitest 的 node 环境里直接单测。
 */

/**
 * 一个课程格在某个档位下的适配结果。
 *
 * 这三个字段就是 `fitCourseCells()` 会写到 DOM 上的**全部**东西
 * （`hideOptional` / `setScale` / `setWidth`），因此「套用」与「读回」都是既有写法的直接正/逆操作，
 * 不存在第二套适配规则。
 */
export type CellFitSnapshot = {
  /** 按可选行顺序被整行隐藏的行数（`0` = 都不隐藏）。可选行顺序见 `cellLayout.ts` 的作业定义。 */
  hidden: number
  /** 兜底系数；`1` 表示未走兜底、DOM 上不留 `--cc-scale`。 */
  scale: number
  /** 文字块宽度（px）；`0` 表示退回整宽。 */
  width: number
}

/**
 * 条目上限。
 *
 * 实际规模是「可见课程格数 × 档位数」：手机 1x 下一屏 18 格 × 3 档 = 54，留一倍余量。
 * 超出后按**插入序**淘汰最早写入的一条（重复写入同一键会把它移到最新）。
 */
export const CACHE_MAX_ENTRIES = 128

/** 缓存槽位：三个键合起来定义一个条目。 */
export type CacheSlot = {
  contentKey: string
  tier: number
}

/** 套用目标：一个带内容签名的「把快照写下去」回调。 */
export type SnapshotTarget = CacheSlot & {
  /**
   * 套用一次快照。
   *
   * 契约：**只允许写 DOM，不允许读**（读会强制布局，等于把省下的开销原样加回来）。
   * 实际实现见 `cellLayout.ts` 的 `applyCellSnapshot()`。
   */
  apply: (snapshot: CellFitSnapshot) => void
}

/** 一次档位套用的结果。 */
export type TierApplyPlan = {
  /** 命中缓存并已套用的格子数。 */
  applied: number
  /** 未命中、必须走实测适配的内容签名；调用方在恢复测量后把它们统一入队。 */
  missing: string[]
}

/** 当前几何键；`setCacheGeometry()` 变更时整表丢弃。 */
let geometry = ''

/** 条目表；`Map` 的插入序即淘汰序。 */
const entries = new Map<string, CellFitSnapshot>()

function slotKey(slot: CacheSlot): string {
  // 用 NUL 分隔，避免内容签名里出现同类分隔符时两个不同的槽位撞成同一个键。
  return `${slot.contentKey}\u0000${slot.tier}`
}

/**
 * 声明当前几何。
 *
 * 只有键真的变化时才清表，因此每次渲染调一次也不会误伤缓存。
 *
 * @param next 形如 `${容器宽}|${容器高}|${是否手机}|${是否折叠空列}`。
 */
export function setCacheGeometry(next: string): void {
  if (next === geometry) return

  geometry = next
  entries.clear()
}

/** 当前几何键（供预热与自检读取）。 */
export function getCacheGeometry(): string {
  return geometry
}

/**
 * 记录一次真实适配的结果。
 *
 * @param slot 内容签名与档位。
 * @param snapshot 适配结果。
 */
export function recordFitSnapshot(slot: CacheSlot, snapshot: CellFitSnapshot): void {
  const key = slotKey(slot)
  // 先删后插：重复写入同一键时把它移到最新，淘汰序因此是「最久未写入」。
  entries.delete(key)
  entries.set(key, snapshot)

  while (entries.size > CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next()
    if (oldest.done) break

    entries.delete(oldest.value)
  }
}

/**
 * 查一次预计算结果。
 *
 * @param slot 内容签名与档位。
 * @returns 命中即返回快照；未命中返回 `undefined`（调用方必须走实测适配，不得猜）。
 */
export function lookupFitSnapshot(slot: CacheSlot): CellFitSnapshot | undefined {
  return entries.get(slotKey(slot))
}

/**
 * 把一个档位的预计算结果批量套用下去。
 *
 * 这是「零测量切换档位」的入口：命中的格子只走 `target.apply()`（纯写），未命中的格子在调用方
 * 恢复测量后统一入队实测。**本函数自身不读任何 DOM**，所以它不可能造成强制布局。
 *
 * @param targets 本次要落定的全部格子（顺序无关）。
 * @param tier 目标档位。
 * @returns 命中数与未命中名单。
 */
export function resolveTierApply(targets: readonly SnapshotTarget[], tier: number): TierApplyPlan {
  let applied = 0
  const missing: string[] = []

  for (const target of targets) {
    const snapshot = lookupFitSnapshot({ contentKey: target.contentKey, tier })
    if (!snapshot) {
      missing.push(target.contentKey)
      continue
    }

    target.apply(snapshot)
    applied += 1
  }

  return { applied, missing }
}

/** 清空条目但保留几何键；供测试与「强制重算」使用。 */
export function clearFitSnapshots(): void {
  entries.clear()
}

/** 当前条目数（供测试与自检读取）。 */
export function fitSnapshotCount(): number {
  return entries.size
}
