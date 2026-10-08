import { describe, expect, it, vi } from 'vitest'
import type { UpdateCandidate } from './channels'
import { runUpdateCheck } from './check'
import type { RunUpdateCheckArgs } from './check'
import type { FetchReleasesResult } from './releases-api'

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0)
const HOUR_MS = 60 * 60 * 1000

const RELEASE: UpdateCandidate = {
  version: '1.0.18-beta',
  prerelease: true,
  tag: 'android-beta-18',
  title: 'ClassTrack Android 1.0.18-beta',
  notes: '## 本次改动\n\n- 修掉某个问题',
  pageUrl: 'https://github.com/Love-wmh/ClassTrack/releases/tag/android-beta-18',
}

/** 用假依赖跑一轮检查，返回结果与两个记账动作的调用记录。 */
async function run(overrides: Partial<RunUpdateCheckArgs> = {}) {
  const markAttempted = vi.fn<(at: number) => void>()
  const markChecked = vi.fn<(at: number) => void>()
  // 覆盖项也要包成 spy：用例断言的是这里返回的这两个函数，而不是外部传进来的实现。
  const fetchCandidates = vi.fn<() => Promise<FetchReleasesResult>>(
    overrides.fetchCandidates ?? (async () => ({ ok: true, candidates: [RELEASE] }))
  )
  const loadVersion = vi.fn<() => Promise<string | null>>(overrides.loadVersion ?? (async () => '1.0.17-beta'))

  const defaults: RunUpdateCheckArgs = {
    manual: false,
    supported: true,
    autoCheckEnabled: true,
    interval: '6h',
    lastCheckAt: null,
    lastAttemptAt: null,
    inFlight: false,
    currentVersion: '1.0.17-beta',
    channel: 'all',
    skippedVersion: null,
    now: NOW,
    loadVersion,
    markAttempted,
    markChecked,
    fetchCandidates,
  }

  // 覆盖项优先，但版本读取与网络请求这两个 spy 必须最后钉住：用例断言的是它们。
  const args: RunUpdateCheckArgs = { ...defaults, ...overrides, fetchCandidates, loadVersion }

  return { outcome: await runUpdateCheck(args), markAttempted, markChecked, fetchCandidates, loadVersion }
}

describe('记账：成功才消耗间隔窗口', () => {
  it('拿到新版本 → 记成功', async () => {
    const { outcome, markAttempted, markChecked } = await run()

    expect(outcome).toEqual({ kind: 'found', candidate: RELEASE })
    expect(markAttempted).toHaveBeenCalledExactlyOnceWith(NOW)
    expect(markChecked).toHaveBeenCalledExactlyOnceWith(NOW)
  })

  it('远端答了但没有新版本 → 也算成功，照样记账（否则每次前台都会重打接口）', async () => {
    const { outcome, markChecked } = await run({ fetchCandidates: async () => ({ ok: true, candidates: [] }) })

    expect(outcome).toEqual({ kind: 'up-to-date' })
    expect(markChecked).toHaveBeenCalledExactlyOnceWith(NOW)
  })

  it('候选被通道过滤掉 → 仍算成功', async () => {
    const { outcome, markChecked } = await run({ channel: 'stable' })

    expect(outcome).toEqual({ kind: 'up-to-date' })
    expect(markChecked).toHaveBeenCalledExactlyOnceWith(NOW)
  })

  it('候选就是用户跳过的版本 → 自动检查不提示，但仍算成功', async () => {
    const { outcome, markChecked } = await run({ skippedVersion: RELEASE.version })

    expect(outcome).toEqual({ kind: 'up-to-date' })
    expect(markChecked).toHaveBeenCalledExactlyOnceWith(NOW)
  })

  it('三种失败原因都不写「上次成功」——只写「上次尝试」', async () => {
    const reasons = ['network', 'rate-limited', 'invalid'] as const

    for (const reason of reasons) {
      const { outcome, markAttempted, markChecked } = await run({ fetchCandidates: async () => ({ ok: false, reason }) })

      expect(outcome).toEqual({ kind: 'failed', reason })
      expect(markAttempted).toHaveBeenCalledExactlyOnceWith(NOW)
      expect(markChecked).not.toHaveBeenCalled()
    }
  })

  it('失败之后再回到前台：出了冷却就立刻联网（这正是 2026-09-28 上报的缺陷）', async () => {
    const { outcome, fetchCandidates, markChecked } = await run({
      // 冷启动那次失败刚过去两分钟，距上次成功还不到间隔。
      lastCheckAt: NOW - 5 * 60 * 1000,
      lastAttemptAt: NOW - 2 * 60 * 1000,
    })

    expect(fetchCandidates).toHaveBeenCalledOnce()
    expect(outcome.kind).toBe('found')
    expect(markChecked).toHaveBeenCalledExactlyOnceWith(NOW)
  })
})

describe('闸门：什么时候根本不该联网', () => {
  it('从未检查过 → 联网', async () => {
    const { fetchCandidates } = await run()

    expect(fetchCandidates).toHaveBeenCalledOnce()
  })

  it('距上次成功不足间隔 → 不联网、不记账', async () => {
    const { outcome, fetchCandidates, markAttempted, markChecked } = await run({
      lastCheckAt: NOW - HOUR_MS / 2,
      lastAttemptAt: NOW - HOUR_MS / 2,
    })

    expect(outcome).toEqual({ kind: 'skipped' })
    expect(fetchCandidates).not.toHaveBeenCalled()
    expect(markAttempted).not.toHaveBeenCalled()
    expect(markChecked).not.toHaveBeenCalled()
  })

  it('失败冷却期内 → 不联网（防断网时来回切前台打接口）', async () => {
    const { outcome, fetchCandidates } = await run({ lastCheckAt: null, lastAttemptAt: NOW - 1000 })

    expect(outcome).toEqual({ kind: 'skipped' })
    expect(fetchCandidates).not.toHaveBeenCalled()
  })

  it('已经在检查中 → 不重复发起（冷启动的双触发不会翻倍）', async () => {
    const { outcome, fetchCandidates } = await run({ inFlight: true })

    expect(outcome).toEqual({ kind: 'skipped' })
    expect(fetchCandidates).not.toHaveBeenCalled()
  })

  it('自动检查关闭 → 不自动联网', async () => {
    const { outcome, fetchCandidates } = await run({ autoCheckEnabled: false })

    expect(outcome).toEqual({ kind: 'skipped' })
    expect(fetchCandidates).not.toHaveBeenCalled()
  })

  it('非安卓平台 → 不联网', async () => {
    const { outcome, fetchCandidates } = await run({ supported: false })

    expect(outcome).toEqual({ kind: 'skipped' })
    expect(fetchCandidates).not.toHaveBeenCalled()
  })
})

describe('手动检查', () => {
  it('自动检查关闭也能手动检查', async () => {
    const { outcome, fetchCandidates } = await run({ manual: true, autoCheckEnabled: false })
    expect(fetchCandidates).toHaveBeenCalledOnce()
    expect(outcome.kind).toBe('found')
  })
  it('手动检查也不能绕过正在进行的检查', async () => {
    const { outcome, fetchCandidates } = await run({ manual: true, inFlight: true })
    expect(outcome.kind).toBe('skipped')
    expect(fetchCandidates).not.toHaveBeenCalled()
  })

  it('忽略间隔与冷却', async () => {
    const { outcome, fetchCandidates } = await run({
      manual: true,
      interval: '6h',
      lastCheckAt: NOW - 1000,
      lastAttemptAt: NOW - 1000,
    })

    expect(fetchCandidates).toHaveBeenCalledOnce()
    expect(outcome.kind).toBe('found')
  })

  it('被跳过的版本仍然展示（prd F3）', async () => {
    const { outcome } = await run({ manual: true, skippedVersion: RELEASE.version })

    expect(outcome).toEqual({ kind: 'found', candidate: RELEASE })
  })
})

describe('版本信息不可用', () => {
  it('store 里没有版本名时去读原生；读不到就静默禁用，且不记账、不联网', async () => {
    const { outcome, loadVersion, fetchCandidates, markAttempted, markChecked } = await run({
      currentVersion: null,
      loadVersion: async () => null,
    })

    expect(loadVersion).toHaveBeenCalledOnce()
    expect(outcome).toEqual({ kind: 'version-unavailable' })
    expect(fetchCandidates).not.toHaveBeenCalled()
    expect(markAttempted).not.toHaveBeenCalled()
    expect(markChecked).not.toHaveBeenCalled()
  })

  it('store 里没有版本名但原生读到了 → 正常检查', async () => {
    const { outcome, loadVersion } = await run({ currentVersion: null, loadVersion: async () => '1.0.16-beta' })

    expect(loadVersion).toHaveBeenCalledOnce()
    expect(outcome.kind).toBe('found')
  })

  it('store 里已有版本名 → 不再读原生', async () => {
    const { loadVersion } = await run()

    expect(loadVersion).not.toHaveBeenCalled()
  })
})
