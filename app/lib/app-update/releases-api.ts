import { toUpdateCandidate } from './channels'
import type { UpdateCandidate } from './channels'

/**
 * GitHub Release 的读取。
 *
 * 两条纪律：
 * 1. **不抛错**。调用方在启动/回前台路径上，任何异常都会变成用户可见的崩溃或噪音；
 *    这里把失败收敛成 `reason`，让上层「静默跳过、按间隔重试」。
 * 2. **一次请求拿两条轨道**。列表按创建时间倒序，正式版与测试版都在里面，
 *    按通道分两次请求只会白花一半的限流额度。
 *
 * 仓库是公开的，因此不带 token（prd 边界）：匿名限流 60 次/小时，前台每 6 小时检查一次。
 */

export const CLASSTRACK_RELEASES_URL = 'https://api.github.com/repos/wangminghuang/ClassTrack/releases?per_page=20'

/** 假数据的 localStorage 键（仅在 `VITE_UPDATE_DEBUG=1` 构建里会被读取）。 */
export const UPDATE_DEBUG_STORAGE_KEY = 'class-track-update-debug'

export type FetchReleasesResult = { ok: true; candidates: UpdateCandidate[] } | { ok: false; reason: FetchReleasesFailure }

/**
 * 失败原因。三者都不打扰用户，区分它们只是为了日志与日后的诊断。
 *
 * - `network`：请求抛错、或服务端 5xx（对方不可用，重试即可）
 * - `rate-limited`：403 / 429（匿名限流，等窗口过去）
 * - `invalid`：其他非 2xx、JSON 解析失败、顶层不是数组（契约不符）
 */
export type FetchReleasesFailure = 'network' | 'rate-limited' | 'invalid'

/** 只依赖 `getItem` 的存储形状，便于测试注入假实现（与 `widget-guide.ts` 同一约定）。 */
export type DebugStorage = Pick<Storage, 'getItem'>

export type FetchReleasesOptions = {
  signal?: AbortSignal
  /** 假数据来源；省略时用 `window.localStorage`，显式传 `null` 表示「没有存储」。 */
  storage?: DebugStorage | null
  /** 仅测试用：替换 `fetch` 实现。 */
  fetchImpl?: typeof fetch
}

/**
 * 取实际使用的存储。
 *
 * `undefined`（没传）表示「用 `window.localStorage`」，显式传 `null` 表示「这台环境没有存储」——
 * 两者必须区分，否则测试覆盖不到无存储分支。
 */
function resolveStorage(storage?: DebugStorage | null): DebugStorage | null {
  if (storage !== undefined) return storage

  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // 隐私模式 / 禁用存储时读 window.localStorage 本身就会抛。
    return null
  }
}

/** 调试注入是否开启。正式包里没有设这个变量，所以整段调试路径恒不生效。 */
function isUpdateDebugEnabled(): boolean {
  // 字面量访问：Vite 在构建时静态替换这个表达式，正式包里恒为 undefined。
  return import.meta.env.VITE_UPDATE_DEBUG === '1'
}

/**
 * 读调试假数据。
 *
 * @returns 收窄后的候选列表；开关未开、没有存储、没有该键、JSON 非法或顶层不是数组时返回 `null`
 *          （返回 `null` 表示「这份假数据不可用」，调用方会静默回落到真实请求）。
 */
function readDebugCandidates(storage?: DebugStorage | null): UpdateCandidate[] | null {
  const target = resolveStorage(storage)
  if (!target) return null

  try {
    const raw = target.getItem(UPDATE_DEBUG_STORAGE_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null

    return parsed.map(toUpdateCandidate).filter((candidate): candidate is UpdateCandidate => candidate !== null)
  } catch {
    return null
  }
}

/**
 * 拉取 release 候选列表。
 *
 * @param options 取消信号、调试用的存储实现与 `fetch` 实现。
 * @returns 成功时给出去重前的候选列表（脏条目已被丢掉，可能是空数组）；失败时给出原因。
 */
export async function fetchReleaseCandidates(options: FetchReleasesOptions = {}): Promise<FetchReleasesResult> {
  const { signal, storage, fetchImpl } = options

  if (isUpdateDebugEnabled()) {
    const injected = readDebugCandidates(storage)
    if (injected) return { ok: true, candidates: injected }
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  // 断网或连接悬挂不能永久锁住「检查中」；超时仍按网络失败处理。
  const timeout = setTimeout(abort, 15_000)
  try {
    const doFetch = fetchImpl ?? globalThis.fetch

    let response: Response
    try {
      response = await doFetch(CLASSTRACK_RELEASES_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json' },
      })
    } catch {
      return { ok: false, reason: 'network' }
    }

    if (response.status === 403 || response.status === 429) return { ok: false, reason: 'rate-limited' }
    if (!response.ok) return { ok: false, reason: response.status >= 500 ? 'network' : 'invalid' }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { ok: false, reason: controller.signal.aborted ? 'network' : 'invalid' }
    }

    if (!Array.isArray(payload)) return { ok: false, reason: 'invalid' }

    return {
      ok: true,
      candidates: payload.map(toUpdateCandidate).filter((candidate): candidate is UpdateCandidate => candidate !== null),
    }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
