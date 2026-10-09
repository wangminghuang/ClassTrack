import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLASSTRACK_RELEASES_URL, UPDATE_DEBUG_STORAGE_KEY, fetchReleaseCandidates } from './releases-api'
import type { DebugStorage } from './releases-api'

/** 造一条形状与 GitHub API 一致的原始 release。 */
function rawRelease(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'android-beta-10',
    name: 'ClassTrack Android 1.0.10-beta',
    body: 'ClassTrack Android **1.0.10-beta**',
    html_url: 'https://github.com/Love-wmh/ClassTrack/releases/tag/android-beta-10',
    prerelease: true,
    ...overrides,
  }
}

/** 只依赖 getItem 的假存储。 */
function storageWith(value: string | null): DebugStorage {
  return { getItem: vi.fn(() => value) }
}

/**
 * 假的 fetch：**每次调用都新建 Response**。
 *
 * `Response` 的 body 只能消费一次，复用同一个实例会让第二次 `json()` 抛错 —— 那是测试的假故障，
 * 不是被测代码的问题。
 */
function fetchJson(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
}

function fetchStatus(status: number) {
  return vi.fn(async () => new Response('', { status })) as unknown as typeof fetch
}

function fetchThrowing() {
  return vi.fn(async () => {
    throw new Error('boom')
  }) as unknown as typeof fetch
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('GitHub Release 读取', () => {
  it('悬挂的请求 15 秒超时，不永久锁住检查状态', async () => {
    vi.useFakeTimers()
    const fetchImpl: typeof fetch = async (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    const checking = fetchReleaseCandidates({ fetchImpl })
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(checking).resolves.toEqual({ ok: false, reason: 'network' })
  })

  it('响应头到了但响应体悬挂时也能超时，并清理定时器', async () => {
    vi.useFakeTimers()
    const fetchImpl: typeof fetch = async (_url, options) =>
      new Response(
        new ReadableStream({
          start(controller) {
            options?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true })
          },
        }),
        { status: 200 }
      )
    const checking = fetchReleaseCandidates({ fetchImpl })
    await vi.advanceTimersByTimeAsync(15_000)
    await expect(checking).resolves.toEqual({ ok: false, reason: 'network' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('调用方主动取消时传递信号，并清理超时', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetchImpl: typeof fetch = async (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    const checking = fetchReleaseCandidates({ fetchImpl, signal: controller.signal })
    controller.abort()
    await expect(checking).resolves.toEqual({ ok: false, reason: 'network' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('仓库迁移后的真实发布链接仍可解析，不能被过滤成空列表', async () => {
    const result = await fetchReleaseCandidates({
      fetchImpl: fetchJson([
        rawRelease({
          tag_name: 'android-beta-27',
          name: 'ClassTrack Android 1.0.27-beta',
          html_url: 'https://github.com/wangminghuang/ClassTrack/releases/tag/android-beta-27',
        }),
      ]),
    })
    expect(result).toEqual({ ok: true, candidates: [expect.objectContaining({ version: '1.0.27-beta' })] })
  })

  it('成功时返回收窄后的候选列表', async () => {
    const fetchImpl = fetchJson([rawRelease()])

    const result = await fetchReleaseCandidates({ fetchImpl })

    expect(result).toEqual({ ok: true, candidates: [expect.objectContaining({ version: '1.0.10-beta', prerelease: true })] })
    expect(fetchImpl).toHaveBeenCalledWith(
      CLASSTRACK_RELEASES_URL,
      expect.objectContaining({ headers: { Accept: 'application/vnd.github+json' } })
    )
  })

  it('脏条目被丢掉，剩下的仍然可用', async () => {
    const fetchImpl = fetchJson([rawRelease(), { nonsense: true }, rawRelease({ html_url: 'https://evil.example.com/x' })])

    const result = await fetchReleaseCandidates({ fetchImpl })

    expect(result.ok).toBe(true)
    expect(result.ok && result.candidates).toHaveLength(1)
  })

  it('响应合法但一条候选都不剩时仍是成功（空数组）', async () => {
    await expect(fetchReleaseCandidates({ fetchImpl: fetchJson([]) })).resolves.toEqual({ ok: true, candidates: [] })
  })

  it('限流（403 / 429）归类为 rate-limited', async () => {
    await expect(fetchReleaseCandidates({ fetchImpl: fetchStatus(403) })).resolves.toEqual({ ok: false, reason: 'rate-limited' })
    await expect(fetchReleaseCandidates({ fetchImpl: fetchStatus(429) })).resolves.toEqual({ ok: false, reason: 'rate-limited' })
  })

  it('5xx 归类为 network（对方不可用，下次重试）', async () => {
    await expect(fetchReleaseCandidates({ fetchImpl: fetchStatus(503) })).resolves.toEqual({ ok: false, reason: 'network' })
  })

  it('其他非 2xx 归类为 invalid', async () => {
    await expect(fetchReleaseCandidates({ fetchImpl: fetchStatus(404) })).resolves.toEqual({ ok: false, reason: 'invalid' })
  })

  it('请求抛异常时不外抛，返回 network', async () => {
    await expect(fetchReleaseCandidates({ fetchImpl: fetchThrowing() })).resolves.toEqual({ ok: false, reason: 'network' })
  })

  it('JSON 解析失败或顶层不是数组时返回 invalid', async () => {
    const brokenJson = vi.fn(async () => new Response('{not json', { status: 200 })) as unknown as typeof fetch

    await expect(fetchReleaseCandidates({ fetchImpl: brokenJson })).resolves.toEqual({ ok: false, reason: 'invalid' })
    await expect(fetchReleaseCandidates({ fetchImpl: fetchJson({ message: 'x' }) })).resolves.toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('调试假数据注入（prd T9）', () => {
  it('开关未设时不读存储、照常发请求', async () => {
    const storage = storageWith(JSON.stringify([rawRelease()]))
    const fetchImpl = fetchJson([])

    const result = await fetchReleaseCandidates({ storage, fetchImpl })

    expect(storage.getItem).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(result).toEqual({ ok: true, candidates: [] })
  })

  it('开关打开时用假数据替代响应，且完全不发请求', async () => {
    vi.stubEnv('VITE_UPDATE_DEBUG', '1')
    const storage = storageWith(JSON.stringify([rawRelease({ name: 'ClassTrack Android 9.9.9', prerelease: false })]))
    const fetchImpl = vi.fn() as unknown as typeof fetch

    const result = await fetchReleaseCandidates({ storage, fetchImpl })

    expect(storage.getItem).toHaveBeenCalledWith(UPDATE_DEBUG_STORAGE_KEY)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, candidates: [expect.objectContaining({ version: '9.9.9', prerelease: false })] })
  })

  it('假数据不可用时静默回落到真实请求', async () => {
    vi.stubEnv('VITE_UPDATE_DEBUG', '1')
    const fetchImpl = fetchJson([rawRelease()])

    for (const brokenValue of ['{not json', '{"notAnArray":true}', 'null']) {
      const result = await fetchReleaseCandidates({ storage: storageWith(brokenValue), fetchImpl })
      expect(result.ok).toBe(true)
    }

    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('开关打开但没有存储时也回落到真实请求', async () => {
    vi.stubEnv('VITE_UPDATE_DEBUG', '1')
    const fetchImpl = fetchJson([])

    await fetchReleaseCandidates({ storage: null, fetchImpl })

    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
