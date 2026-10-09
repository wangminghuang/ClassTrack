import { resolveUpdate, seedChannel } from './channels'
import type { UpdateCandidate, UpdateChannel } from './channels'
import type { FetchReleasesFailure, FetchReleasesResult } from './releases-api'
import { shouldCheckNow } from './schedule'
import type { CheckInterval } from './schedule'

/**
 * 更新检查的**内核**：闸门 → 读版本 → 记账 → 取远端 → 判定。
 *
 * 为什么单独成模块（而不是留在 `useAppUpdate` 里）：这个流程里最容易写错、也最难被发现的一条
 * 是「什么时候算拿到结果、什么时候该记账」—— 记错一次就会让前台自动检查静默失效
 * （2026-09-28 上报的正是这个）。把存储读写、网络、时钟、版本读取全部做成参数注入，
 * 这条规则就能被真单测钉住，而不是靠读代码确认。
 *
 * **记账契约（本模块最重要的一条）**：
 * - `markAttempted(now)` —— 只要真的发了请求就记（成功失败都记），只为失败后的短冷却服务；
 * - `markChecked(now)` —— **只有请求成功**（HTTP 2xx、JSON 可解析、顶层是数组）才记，
 *   它是间隔窗口的唯一依据。**失败绝不能记**：失败也消耗窗口，就会退回
 *   「冷启动那次没网 → 之后回到前台永远被节流拦住 → 只有手动检查能拿到更新」。
 *   「有没有新版本」「是否被通道或跳过版本过滤掉」都算成功（远端确实答了）。
 *
 * 本模块不 import store、不 import React，也不自己调 `fetch` —— 依赖全部从参数进来。
 */

export type CheckOutcome =
  /** 闸门拦住（总开关关 / 平台不支持 / 间隔未到 / 失败冷却中 / 已在检查）或版本信息不可用。 */
  | { kind: 'skipped' }
  /** 读不到安装版本名（原生插件不可用）：整个功能静默禁用。 */
  | { kind: 'version-unavailable' }
  | { kind: 'failed'; reason: FetchReleasesFailure }
  | { kind: 'up-to-date' }
  | { kind: 'found'; candidate: UpdateCandidate }

export type RunUpdateCheckArgs = {
  /** 手动「立即检查」：忽略间隔与失败冷却，且被跳过的版本仍然展示。 */
  manual: boolean
  /** 平台是否支持（仅安卓原生）。 */
  supported: boolean
  /** 自动检查开关；关闭后手动检查仍可用。 */
  autoCheckEnabled: boolean
  interval: CheckInterval
  /** 上一次**成功**拿到结果的时间戳。 */
  lastCheckAt: number | null
  /** 上一次**尝试**的时间戳。 */
  lastAttemptAt: number | null
  /** 是否已有一次检查在进行中（重入保护）。 */
  inFlight: boolean
  /** store 里已知的安装版本名；`null` 时用 `loadVersion` 去读。 */
  currentVersion: string | null
  /** 已持久化的更新通道；`null` 表示还没播种。 */
  channel: UpdateChannel | null
  /** 用户点过「跳过此版本」的版本号。 */
  skippedVersion: string | null
  /** 本次检查的时刻（由调用方给，便于测试与「同一轮用同一个时间」）。 */
  now: number
  loadVersion: () => Promise<string | null>
  markAttempted: (at: number) => void
  markChecked: (at: number) => void
  fetchCandidates: () => Promise<FetchReleasesResult>
}

/**
 * 走完一轮更新检查。
 *
 * @returns 本轮结果；调用方据此做 UI 副作用（toast / 模态框候选）。
 */
export async function runUpdateCheck({
  manual,
  supported,
  autoCheckEnabled,
  interval,
  lastCheckAt,
  lastAttemptAt,
  inFlight,
  currentVersion,
  channel,
  skippedVersion,
  now,
  loadVersion,
  markAttempted,
  markChecked,
  fetchCandidates,
}: RunUpdateCheckArgs): Promise<CheckOutcome> {
  if (!supported || (!manual && !autoCheckEnabled)) return { kind: 'skipped' }
  if (!shouldCheckNow({ interval, lastCheckAt, lastAttemptAt, now, inFlight, manual })) return { kind: 'skipped' }

  // 读版本走的是原生桥（本地调用、不耗限流额度），所以放在记账之前：
  // 读不到时整个功能都会静默禁用，没必要为它占掉一次失败冷却。
  const version = currentVersion ?? (await loadVersion())
  if (!version) return { kind: 'version-unavailable' }

  markAttempted(now)

  const result = await fetchCandidates()
  if (!result.ok) return { kind: 'failed', reason: result.reason }

  // 走到这里才算「拿到结果」：消耗间隔窗口。
  markChecked(now)

  const found = resolveUpdate({
    candidates: result.candidates,
    channel: seedChannel(channel, version),
    currentVersion: version,
    skippedVersion,
    ignoreSkipped: manual,
  })

  return found ? { kind: 'found', candidate: found } : { kind: 'up-to-date' }
}
