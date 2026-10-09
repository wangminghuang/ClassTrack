import { compareVersionStrings, isNewerVersion, isPrereleaseBuild, normalizeAppVersion } from './version'

/**
 * 更新通道与「release 原始数据 → 候选版本」的收窄。
 *
 * 远端 release 列表属于**不可信输入**：这里做唯一的解码与校验点，
 * 上游（`releases-api.ts`）只负责取数据，下游（hook / 组件）只消费 `UpdateCandidate`。
 * 别处再解析一次字段就等于给同一份契约开了第二个版本。
 */

export type UpdateChannel = 'stable' | 'beta' | 'all'

export const UPDATE_CHANNELS: readonly UpdateChannel[] = ['stable', 'beta', 'all']

export const UPDATE_CHANNEL_LABELS: Record<UpdateChannel, string> = {
  stable: '仅正式版',
  beta: '仅测试版',
  all: '全部',
}

export const UPDATE_CHANNEL_HINTS: Record<UpdateChannel, string> = {
  stable: '只接收正式版；测试版即使更新也不会提示。',
  beta: '只接收测试版；正式版即使更新也不会提示。',
  all: '正式版与测试版都接收，谁更新就提示谁。',
}

/** 「去下载」唯一允许打开的地址前缀（prd T6）。 */
export const RELEASE_URL_PREFIX = 'https://github.com/wangminghuang/ClassTrack/releases/'

/** release 标题里携带版本号，如 `ClassTrack Android 1.0.10-beta`。 */
const TITLE_VERSION_PATTERN = /ClassTrack\s+Android\s+(\S+)/

/** 测试版 tag 的生成规则（`android-beta-<序号>` → 版本名 `1.0.<序号>-beta`）。 */
const BETA_TAG_PATTERN = /^android-beta-(\d+)$/

export type UpdateCandidate = {
  /** 归一化后的版本号，如 `1.2.0` / `1.0.10-beta`。 */
  version: string
  /** 该 release 是否标记为预发布（测试版轨道）。 */
  prerelease: boolean
  tag: string
  title: string
  /** release 正文；按纯文本渲染（prd T5），不要在别处当 HTML 用。 */
  notes: string
  /** 已校验过的 release 页面地址；拿不到合法地址时为空串。 */
  pageUrl: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 「去下载」的地址白名单校验：必须是本仓库的 release 页面（prd T6）。 */
export function isAllowedReleaseUrl(url: string): boolean {
  // 旧发布链接仍会重定向到同一仓库；兼容已有记录，不能放宽到任意 GitHub 仓库。
  return [RELEASE_URL_PREFIX, 'https://github.com/Love-wmh/ClassTrack/releases/'].some((prefix) => url.startsWith(prefix))
}

/**
 * 从 tag 反推版本名。
 *
 * @returns 归一化后的版本号；tag 形态不认识时返回 `null`。
 */
function versionFromTag(tag: string): string | null {
  const beta = BETA_TAG_PATTERN.exec(tag)
  if (beta) return normalizeAppVersion(`1.0.${beta[1]}-beta`)

  return normalizeAppVersion(tag)
}

/**
 * 取 release 的版本名：**标题优先，tag 兜底**。
 *
 * 标题来自工作流的 `--title "ClassTrack Android ${VERSION}"`，tag 是 `v<版本号>` 或 `android-beta-<序号>`。
 * 两条路都取不到（或取到的不是合法版本号）时返回 `null`，该 release 会被整体丢掉。
 */
function resolveCandidateVersion(title: string, tag: string): string | null {
  const fromTitle = TITLE_VERSION_PATTERN.exec(title)?.[1]
  if (fromTitle) {
    const normalized = normalizeAppVersion(fromTitle)
    if (normalized) return normalized
  }

  const fromTag = versionFromTag(tag)
  if (fromTag) return fromTag

  return null
}

/**
 * 把一条 release 原始数据收窄成候选版本。
 *
 * @param raw GitHub Releases API 返回的单个数组项（类型未知）。
 * @returns 合法候选；字段缺失/类型不符/版本号或下载地址不合法时返回 `null`（不抛错）。
 */
export function toUpdateCandidate(raw: unknown): UpdateCandidate | null {
  if (!isRecord(raw)) return null

  // `prerelease` 决定通道归属，必须是真 boolean：字符串 "false" 会静默变成「测试版」。
  if (typeof raw.prerelease !== 'boolean') return null

  const tag = readString(raw.tag_name)
  const title = readString(raw.name)
  const pageUrl = readString(raw.html_url)
  if (!isAllowedReleaseUrl(pageUrl)) return null

  const version = resolveCandidateVersion(title, tag)
  if (!version) return null

  return {
    version,
    prerelease: raw.prerelease,
    tag,
    title,
    notes: readString(raw.body),
    pageUrl,
  }
}

/**
 * 按通道挑出最新的候选版本。
 *
 * `all` 是**跨通道比较**版本号而不是「先正式后测试」：测试版包的序号会一直涨，
 * 只有比较版本号才能保证「1.0.11-beta」和「1.2.0」之间挑出真正更新的那个。
 *
 * @returns 该通道下版本最高的候选；候选为空或该轨道没有包时返回 `null`。
 */
export function selectCandidate(candidates: UpdateCandidate[], channel: UpdateChannel): UpdateCandidate | null {
  const pool = candidates.filter((candidate) => {
    if (channel === 'all') return true
    return channel === 'beta' ? candidate.prerelease : !candidate.prerelease
  })

  let best: UpdateCandidate | null = null
  for (const candidate of pool) {
    if (!best || compareVersionStrings(candidate.version, best.version) > 0) {
      best = candidate
    }
  }

  return best
}

export type ResolveUpdateArgs = {
  candidates: UpdateCandidate[]
  channel: UpdateChannel
  /** 当前安装的版本名。 */
  currentVersion: string
  /** 用户点过「跳过此版本」的版本号。 */
  skippedVersion: string | null
  /** 手动「立即检查」时传 `true`：跳过版本仍然展示（prd F3）。 */
  ignoreSkipped?: boolean
}

/**
 * 综合通道、当前版本与「已跳过」记录，决定这次要不要提示、提示哪一个。
 *
 * @returns 需要提示的候选；不需要提示时返回 `null`。
 */
export function resolveUpdate({
  candidates,
  channel,
  currentVersion,
  skippedVersion,
  ignoreSkipped = false,
}: ResolveUpdateArgs): UpdateCandidate | null {
  const candidate = selectCandidate(candidates, channel)
  if (!candidate) return null
  if (!isNewerVersion(candidate.version, currentVersion)) return null
  if (!ignoreSkipped && skippedVersion !== null && candidate.version === skippedVersion) return null

  return candidate
}

/**
 * 首次播种用的默认通道。
 *
 * 测试版包默认「全部」：测试版用户既要拿到新测试版，也不该错过更新的正式版。
 */
export function defaultChannelFor(versionName: string): UpdateChannel {
  return isPrereleaseBuild(versionName) ? 'all' : 'stable'
}

/**
 * 通道播种 —— **只做一次，之后永久保持**。
 *
 * 存储里已经有值就必须原样返回：测试版包升级到正式版之后，安装包类型变了，
 * 但用户的通道选择不能被重置（用户 2026-09-23 明确要求）。所以判据是「存储里有没有值」，
 * 而不是「安装包类型变了没有」。卸载重装会清掉 localStorage 并重新播种，这是可接受的。
 *
 * @param stored 存储里读到的通道；`null` 表示还没播种过。
 * @param versionName 当前安装包的版本名，仅在播种时使用。
 */
export function seedChannel(stored: UpdateChannel | null, versionName: string): UpdateChannel {
  return stored ?? defaultChannelFor(versionName)
}

/** 把任意外部值收窄成通道；不认识的值返回 `null`（调用方据此当成「未播种」）。 */
export function normalizeChannel(value: unknown): UpdateChannel | null {
  return UPDATE_CHANNELS.includes(value as UpdateChannel) ? (value as UpdateChannel) : null
}
