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
 * - `geometryKey` = 容器宽高 × 列模板 × 断点 —— 课程格的盒子尺寸是它的纯函数；
 * - `contentKey`  = 课程号 + 课名 / 教室 / 教师 / 单双周 / 备注 + 节次跨度 —— 适配结果是它的纯函数；
 * - `tierKey`     = 档位。
 *
 * 三个键任一不同就是另一个条目：内容一改 `contentKey` 就变、几何一改 `geometryKey` 就变，
 * 旧条目永远不会被读到，于是「改了东西却忘了清缓存」这类漏法在结构上不可能发生。
 *
 * 反过来说，**换几何时也不需要清表** —— 老条目只是查不到而已。这一点是量出来的必需品：
 * 手机上 2x 档出现水平滚动条会让容器内容盒矮 15px，几何键在 1x 与 1.5x/2x 之间来回翻转，
 * 若「键变即清表」，每次换档都会先把刚算好的另一档成果扔掉，缓存等于不存在（见 `geometry` 的说明）。
 * 内存回收只由条目上限的 LRU 淘汰兜底。
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
 * 规模 = 几何套数 × 可见课程格数 × 档位数 = 1 × 18 × 3 = 54。取 128 留一倍余量。
 * 几何键对档位不敏感（见 `geometryKeyOf`），三档因此共用同一套几何；余量留给「同一时刻只可能
 * 存在一种」的那些变化（旋屏、折叠列开关、断点），以及预热宿主万一与真实盒子对不上时那套查不到的条目。
 * 超出后按**插入序**淘汰最早写入的一条（重复写入同一键会把它移到最新）。
 */
export const CACHE_MAX_ENTRIES = 128

/** 缓存槽位：三个键合起来定义一个条目。 */
export type CacheSlot = {
  contentKey: string
  tier: number
}

/** 套用目标：一个带内容签名的「把快照写下去」回调。 */
export type SnapshotTarget = {
  /** 内容签名，与 `CellFitSnapshot` 的缓存键同源。 */
  contentKey: string
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
  /**
   * 未命中的目标**下标**（按传入顺序），调用方需要对它们走实测适配。
   *
   * 用下标而不是内容签名，是因为内容相同的两个格子可以有完全不同的盒子
   * （跨周视图里同一门课可以同时出现两次），签名不足以指认具体是哪一个。
   */
  missing: number[]
}

/**
 * 当前几何键。
 *
 * 它**不会**让旧条目失效：几何键是每一条条目键的一部分，换几何只是让旧条目查不到而已。
 *
 * 这条性质是量出来的必需品，不是洁癖。初版实现「键一变就清表」，而当时的几何键里带着滚动容器的
 * 内容盒高度 —— 手机上 2x 档出现水平滚动条会把它吃掉 15px（548 → 533），几何键随之在档位间来回
 * 翻转，于是每次换档都先把刚算好的另一档成果扔掉：实测四轮捏合里有三轮仍在实测
 * （`overflows()` 占 CPU 自身耗时 368ms，全场第 2）。
 *
 * 之后几何键改成「滚动容器内容宽 × **网格自身高度** × 列模板 × 断点」（见 `geometryKeyOf`），
 * 网格高度在档位之间是不变的（它已经被「12 行地板」钳住），几何键因此不再随档位翻转；
 * 「不清表」保留下来作为第二条保险：预热的离屏克隆万一日后与真实盒子对不上，那批条目也只是
 * 查不到、等 LRU 淘汰，而不会把真实路径算好的条目一起冲掉。
 */
let geometry = ''

/** 条目表；`Map` 的插入序即淘汰序。 */
const entries = new Map<string, CellFitSnapshot>()

/** 键分隔符：NUL（内容签名与几何键里都不可能出现的字符）。 */
const KEY_SEPARATOR = String.fromCharCode(0)

function slotKey(slot: CacheSlot): string {
  // 几何键在最前面：它同样只是键的一部分，因此换几何不需要任何「失效」动作。
  return [geometry, slot.contentKey, slot.tier].join(KEY_SEPARATOR)
}

/** 内容签名的组成部分；缺省字段在内部归一到空串。 */
export type CourseContentParts = {
  /** 课程号。 */
  id: string
  /** 课名。 */
  name: string
  /** 教室。 */
  classroom?: string | undefined
  /** 教师。 */
  teacher?: string | undefined
  /** 单双周标签（`全周` / `单周` / `双周` / `非本周`）。 */
  parity?: string | undefined
  /**
   * 节次跨度（`startSection-endSection`）。
   *
   * 它不属于「文字」，却同样决定适配结果：同一门课从 1~2 节改成 1~4 节，文字一个字符都没变，
   * 盒子却高了一倍 —— 少了这一项，改完节次的课会读到按旧高度算出来的排布（文字被裁）。
   */
  span?: string | undefined
  /** 备注。 */
  note?: string | undefined
}

/**
 * 组装一个课程格的内容签名。
 *
 * 逐字段用 `|` 拼接：任何一个字段变了签名就变，旧条目因此**永远不会被读到** —— 不需要
 * 「内容变更时记得清缓存」这类容易漏的失效逻辑（见模块头部的正确性论证）。
 *
 * 缺省字段在内部归一到空串，避免 `undefined` 与 `''` 在两个调用点算出两种签名
 * （同一门课先没填教室、后来又填上，必须是两条不同的条目）。
 *
 * @param parts 内容字段。
 * @returns 内容签名。
 */
export function courseContentKey(parts: CourseContentParts): string {
  return [parts.id, parts.name, parts.classroom ?? '', parts.teacher ?? '', parts.parity ?? '', parts.note ?? '', parts.span ?? ''].join(
    '|'
  )
}

/**
/**
 * 由滚容器内容宽、网格自身高度、列模板与断点拼出几何键。
 *
 * 取这四项，因为它们共同、且仅仅决定课程格的盒子尺寸：
 *
 * - 网格宽 = 滚容器内容宽 × 档位（档位是独立的键维度，所以这里只留容器内容宽）；
 * - 网格高 = max(容器内容盒高, 12 行自然高)，即**网格自身高度**；
 * - 列模板决定「哪些列被折叠窄条」，断点决定节次列是 2rem 还是 4rem。
 *
 * 三项东西**刻意不进键**：
 *
 * - **档位**：它是独立的键维度（`CacheSlot.tier`），进几何键等于把同一维数两遍；
 * - **课程格宽度**：它是「容器内容宽 × 档位」的函数，进键会让几何键随档位翻转；
 * - **课程格高度**：它是「网格高 + 列模板 + 断点」的纯函数，重复进键只会把键切得更碎。
 *
 * **宽度取容器、高度取网格**这一对组合不是随意配的：它让几何键在档位之间**不变**。
 * 早先两样都取容器的内容盒，于是手机上 2x 档一出现水平滚动条、容器内容盒就矮 15px（548 → 533），
 * 几何键随档位来回翻转，缓存条目被切碎（详见 `geometry` 的实测记录）。改成网格自身高度后：
 * 网格高被 12 行地板钳在 780px，三档同一个键；而网格**宽**该随档位变，那部分由档位键负责。
 *
 * 列模板要进键，是因为「折叠空列」不是布尔量：同样是折叠了 3 列，周一三五有课与周二四六有课
 * 算出的列宽完全不同，而这时的容器盒子一模一样。传**内联 style 里那个模板字符串**，不要传
 * `getComputedStyle` 的结果 —— 后者已经把档位算进像素值，会让几何键重新变得随档位翻转。
 *
 * 放在缓存模块里而不是各个调用点，是为了让「几何键由哪几项构成」只有一处定义：将来要加一项
 * （比如行高模式）时不可能只改一半调用点，而漏改的那一半会静默地读到尺寸不对的旧快照。
 *
 * @param grid 网格盒子：宽取**滚容器内容宽**、高取**网格自身高度**（离线克隆预热时必须让克隆的这一对数值与真实网格相同）。
 * @param columns 列模板；关闭「折叠空列」开关时传 `'even'`（那种情形的列模板由 class 给定、与数据无关）。
 * @param isMobile 是否命中手机断点（节次列 2rem/4rem 的差别）。
 * @returns 几何键。
 */
export function geometryKeyOf(grid: { width: number; height: number }, columns: string, isMobile: boolean): string {
  return [grid.width, grid.height, columns, isMobile ? 'mobile' : 'desktop'].join('|')
}

/**
 * 声明当前几何。
 *
 * 它**不清表**：几何键已经是每条条目键的一部分，换几何只会让旧条目查不到（详见文件头的论证）。
 * 因此每次渲染调一次也不会误伤任何缓存。
 *
 * @param next 几何键，用 {@link geometryKeyOf} 生成。
 */
export function setCacheGeometry(next: string): void {
  geometry = next
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
  const missing: number[] = []

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]
    const snapshot = lookupFitSnapshot({ contentKey: target.contentKey, tier })

    if (!snapshot) {
      missing.push(index)
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
