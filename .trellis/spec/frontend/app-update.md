# App Update Check

> Android 客户端的更新检测契约：GitHub Release 的版本解析与通道判定、通道默认值的**一次性播种与持久性**、
> 仅前台弹窗与固定 6 小时间隔，以及「现网最新版本 == 待验收版本」时怎么验收。

---

## Overview

安装过的 APK 需要自己告诉用户「有新版本」。这件事跨四层，每一层都有各自的失败方式：

```
android-release.yml（生成 tag 与版本名） → APK 里的 versionName（@capacitor/app 读回）
   → GitHub Releases API（远端数据） → 版本/通道判定（纯函数） → 仅前台模态框
```

相关代码：

| 位置 | 职责 |
| --- | --- |
| `.github/workflows/android-release.yml` | 版本名与 tag 的**唯一生成者**：正式版 `vX.Y.Z`（非 prerelease）、测试版 `android-beta-N`（`1.0.N-beta`） |
| `app/lib/app-update/version.ts` | 版本号解析与比较（三元组按数值比较；同三元组时正式版 > 测试版） |
| `app/lib/app-update/channels.ts` | release 原始数据 → `UpdateCandidate` 的唯一收窄点；通道筛选；通道播种 |
| `app/lib/app-update/releases-api.ts` | GitHub 读取（不抛错，失败收敛成 `reason`）+ 调试假数据注入 |
| `app/lib/app-update/schedule.ts` | 固定间隔与「这次触发该不该真的联网」的**唯一判决**（纯函数） |
| `app/lib/app-update/check.ts` | 检查内核：闸门 → 读版本 → 记账 → 取远端 → 判定。依赖全注入，所以「成功才记账」是单测钉住的 |
| `app/lib/app-update/settings.ts` | 持久化设置收窄 + 所有历史间隔统一为 6 小时（纯函数） |
| `app/lib/app-update/native-update.ts` | `@capacitor/app`（版本名 / 初始前台状态 / 前后台事件）适配层 |
| `app/store/updateStore.ts` | 设备相关设置（独立 localStorage key `class-track-update`，不进备份 JSON） |
| `app/components/app-update/` | 模态框（`UpdateAvailableDialog`）+ 更新说明渲染（`releaseNotes.tsx`）+ 自动检查挂载点（`useAppUpdate`） |
| `app/features/profile/AppUpdateSettings.tsx` | 个人中心的「应用更新」卡片 |

---

## Contracts

- **平台范围只有 Android 原生**（`isAndroidApp()`）。浏览器 / PWA 由 Service Worker 的 `PwaUpdatePrompt` 负责，
  那边不渲染设置卡片、不发起任何请求。非 Android 时 `useAppUpdate().candidate` 恒为 `null`。
- **版本名的形态是跨层契约**：`X.Y.Z` 是正式版包，含 `-` 后缀（`1.0.10-beta`、`1.0.0-local`）是测试版包。
  改 CI 的命名规则必须同步改 `version.ts`，否则「是不是新版本」会判错。
- **候选版本解析优先级：标题 → tag**。标题取 `ClassTrack Android (\S+)`；取不到就 tag（`v1.2.0` → `1.2.0`，
  `android-beta-7` → `1.0.7-beta`，与工作流生成规则一致）。两条都取不到就**整条丢掉**，不抛错。
- **请求使用 `wangminghuang/ClassTrack`；`html_url` 只接受新地址 `https://github.com/wangminghuang/ClassTrack/releases/`
  与兼容旧链接的 `https://github.com/Love-wmh/ClassTrack/releases/` 前缀**，否则该条直接被丢弃。
  远端数据不允许变成任意跳转地址。
- **`prerelease` 必须是真 boolean**：字符串 `"false"` 会让 `Boolean` 判定把它算成测试版，因此类型不符即丢弃。
- **通道语义**：`stable` 只看非 prerelease，`beta` 只看 prerelease，`all` 跨两者取版本号更高者。
  某条轨道一个包都没有时按「没有候选」处理（现网正式版轨道长期为空，这是常态而非异常）。
- **通道默认值只在首次读到版本名时播种一次**：
  - 存储里没有值 → 按安装包类型播种（测试版包 → `all`，正式版包 → `stable`）；
  - 存储里**已经有值 → 原样返回，永不改写**。所以「测试版包升级成正式版包」之后通道仍是 `all`
    （用户 2026-09-23 明确要求）。判据是「存储里有没有值」，不是「安装包类型变了没有」。
  - 卸载重装会清掉 localStorage 并重新播种，这是可接受的。
- **两个时间戳各管一件事**（2026-09-28 起，别再合成一个）：
  - `lastCheckAt` = 上一次**成功拿到结果**的时刻 → 间隔窗口，也是设置页展示的那个值；
  - `lastAttemptAt` = 上一次**尝试**的时刻（成功失败都写） → 只为失败后的**短冷却**（60 秒）服务。
  「上次尝试是失败的」由两个时间戳的先后关系推导（`lastAttemptAt > lastCheckAt` 或 `lastCheckAt === null`），
  不额外落布尔字段。
- **只有拿到结果才消耗间隔窗口**：请求失败（网络错误 / 403 / 429 / 5xx / 结构不符）**不更新** `lastCheckAt`，
  所以下一次回到前台会立刻重试（受 60 秒失败冷却约束）。**失败也记 `lastCheckAt` 会退回
  「冷启动那次没网 → 之后回到前台永远被节流拦住 → 只有手动检查能拿到更新」**——这正是 2026-09-28 上报的缺陷。
  「有没有新版本」「被通道或「跳过此版本」过滤掉」都算**成功**（远端确实答了）。
- **失败冷却**（常量，不暴露给用户）：上一次尝试失败且距它不足 60 秒 → 不发起新的检查。
  没有这道闸门，「失败不记账」会变成断网时来回切前台狂打接口，把匿名额度（60 次/小时）打光。
- **重入保护**：`inFlight` 为真时不放行；hook 里**只有真正开始这一轮检查的调用**才允许置位/清除
  `isChecking`，否则被拦下的调用会在 `finally` 里把正在跑的那一轮误标成结束。
- **时间戳在未来**（用户改过系统时间）→ 按「间隔已过完」处理，不让检查永久静默。
- **自动检查固定每 6 小时一次**（2026-10-08 用户口径），以成功检查时间为基准。首次前台立即检查；
  不足 6 小时回前台不再联网；持续留在前台也按到期时间检查。失败仍使用 60 秒冷却，手动检查忽略间隔和冷却。
- **存量设置必须迁移**：`normalizeUpdateSettings` 忽略旧 `interval` / `intervalPinned` / `notify`，统一使用 `6h`。
  通道、自动检查开关、两个记账时间与跳过版本保持。不能只改默认值，否则已有存储仍按旧间隔运行。
- **手动检查独立于自动开关**：关闭自动检查仍能点击「立即检查」，但仍受平台、前台与并发保护。
  `ignoreSkipped: true`，被跳过的版本仍可展示。
- **「跳过此版本」只抑制自动提示**：记录归一化版本号。
- **仅前台模态框，不发送系统通知、不查询或申请更新通知权限**。个人中心不再有通知开关、系统通知设置入口与间隔选择器。
- **前后台必须都监听**：`App.getState()` 读取初始状态，`appStateChange` 接收 `isActive` 的 true 和 false。
  生命周期事件优先于异步初始查询，不能让过期的查询结果覆盖新事件。
  `isAppActive` 为会话状态、不落盘；只有唯一的 Runner 管理生命周期和自动检查，设置页不重复调度。
- **前台到期定时器**：`nextCheckDelay` 与检查闸门共用规则；后台、自动关闭、检查进行中或版本不可用时不设置定时器。
  请求中退后台后收到候选保留到会话状态，Runner 只在前台渲染，回前台后可继续提示。
- **网络请求 15 秒超时**：包括读取响应体，超时归为网络失败，确保释放 `isChecking`；外部取消信号也需传递。
- **release 正文经 `marked.lexer` 的 token → React 元素渲染**（`app/components/app-update/releaseNotes.tsx`）：
  它是远端内容，而这个 WebView 的 localStorage 里是用户的全部课程数据。安全做法是「**不生成 HTML 字符串**」——
  React 对文本子节点自动转义，远端字符串进入 DOM 的唯一路径因此被消除。
  - **禁止 `dangerouslySetInnerHTML`**（全仓库 0 处使用）；也不得把远端字符串拼进 HTML；
  - 原始 HTML（`<script>`、`<img onerror=…>`）按**文本**渲染，不产生元素；
  - 图片**不渲染元素**（不让 WebView 去拉任意远端资源），只留替代文本；
  - 链接只有 `http(s)` 才生成锚点，其它协议（`javascript:` / `data:`）退化成纯文本；锚点**不加 `target`**
    （与「去下载」同一个 Capacitor `_blank` 坑），带 `rel="noreferrer"`；
  - 表格降级成「每行一段文本、单元格用 ` ｜ ` 连接」，不产生 `<table>`；
  - 未知 token（`marked` 升级）必须有兜底：能递归就递归、否则按文本渲染，**不得抛错**；
  - `list` token 的子项字段是 **`items`**，其余块级/行内 token 才是 `tokens` —— 只读一个会把整类列表渲染成空壳。
  2026-09-28 之前这里是「去掉 `**` + `whitespace-pre-wrap`」的纯文本展示（当时的 prd 决策 T5），
  安全目标相同，但用户看到的 `## 本次改动` / `- 条目` 全是字面量。
- **「去下载」用锚点导航**，不用 `window.open(url, '_blank')`：Capacitor 的 `Bridge.launchIntent` 会把非同源导航
  交给系统浏览器（`Intent.ACTION_VIEW`），而本仓库的 WebChromeClient 没有覆写 `onCreateWindow`，
  `_blank` 在新窗口被禁用时可能什么都不发生。

---

## 历史原生通知代码

历史 `AppUpdatePlugin.java` 与 local-notifications 依赖仍在原生工程中，本次更新流程不再调用它们。
更新检查不得重新引入通知调用或权限申请。

---

## Verification Recipe

`pnpm test` 覆盖全部纯函数判定（版本解析/比较、通道筛选、播种持久性、调度判决与记账、存量间隔迁移、URL 白名单、
响应结构非法时的静默失败、模态框与更新说明的静态渲染）。调度与记账的规则在 `schedule.test.ts` / `check.test.ts`，
它们靠**注入假依赖**（时钟、存储动作、网络）钉住，不需要设备。
真机链路必须用调试注入，原因是**现网最新版本常常就等于待验收的版本**，真机天然触发不了「有新版本」。

```bash
# 1) 带调试开关构建（正式包不设该变量，调试路径恒不生效）
VITE_UPDATE_DEBUG=1 pnpm cap:sync:android
./android/gradlew -p android :app:assembleDebug

# 2) 在设备上写假数据：localStorage key = class-track-update-debug，value = GitHub Releases API 的数组形态
#    数组项至少要有 tag_name / name / body / html_url / prerelease
```

真机检查清单：

- [ ] 注入新版本 → 首次前台弹模态框；没有系统通知或通知权限申请。
- [ ] 请求中退后台 → 后台不弹框；回到前台后提示已有候选。
- [ ] 不足 6 小时切前台不联网；到 6 小时回前台或持续前台时检查。
- [ ] 「稍后」关闭提示；下次到期检查仍可提示；「跳过此版本」抑制自动提示，但手动检查仍弹出。
- [ ] 关闭自动检查 → 不再自动联网；手动「立即检查」仍可用。
- [ ] 旧存储含 `notify: true` / `interval: '1d'` / `intervalPinned: true` → 不通知、固定 6 小时。
- [ ] 测试包默认通道「全部」，覆盖正式包后仍保持。
- [x] 浏览器 / PWA 不显示原生更新卡片。

---

## Common Mistakes

- 不要在组件或 hook 里重新解析 release 字段。收窄只发生在 `channels.ts` 的 `toUpdateCandidate`，
  否则同一份远端契约会出现第二个版本（网页一处、`all` 通道一处，改一处漏一处）。
- 不要把 `channel` 的默认值写成「每次启动都按安装包类型算」。那会让测试版用户升级到正式版后
  通道被重置成「仅正式版」，与用户口径相反 —— 播种的判据**只有**「存储里有没有值」。
- 不要在渲染期调用 `Date.now()`（本仓库 `react-hooks/purity` 是 error）。「上次检查成功」展示绝对时间戳
  （`format(new Date(lastCheckAt), 'yyyy-MM-dd HH:mm')`），不显示需要实时刷新的相对时间。
- **不要用 `markChecked` 记一次失败的检查**（2026-09-28 的缺陷就是这么来的）：它是「上一次成功拿到结果」，是间隔
  窗口的唯一依据；失败只调 `markAttempted`。反过来也不要为了防断网重试而把冷却写成「失败也消耗间隔窗口」。
- **不要把 `lastCheckAt` 当「上次尝试」用**（读这段代码时最容易看错的一处）：展示与间隔判定都用「成功」的那个；
  判断「上次是不是失败」请用两个时间戳的先后关系（`lastAttemptAt > lastCheckAt`），不要新增布尔字段。
- **不要给 release 正文重新引入 `dangerouslySetInnerHTML`**（哪怕先用 DOMPurify 净化）。本仓库没有净化依赖，
  而 token → React 元素这条路已经不需要它；表格 / 图片 / 原 HTML 的降级是有意取舍，不是没做完。
- 不要把纯函数或浏览器模拟检查当成 Android 真机验收；原生生命周期仍需单独验证。
- **仓库迁移必须同步 API 地址和发布页白名单**：2026-10-08 GitHub 已重定向旧 API，返回新 owner 的 `html_url`，
  旧白名单把 20 条真实发布全部过滤为空，导致手动检查误报「已是最新版本」。回归用例必须包含当前发布地址。
- 不要因为现网正式版轨道为空就以为 `stable` 分支坏了 —— 那正是「某轨道没有候选」的常态。
- **调试包的 `versionName` 不做处理就是个哑火功能**：`build.gradle` 在没给 `CLASSTRACK_VERSION_NAME` 时回落到
  `1.0`，而 `1.0` 不是 `X.Y.Z`，`parseAppVersion` 返回 `null` → **任何更新都判不出来**。真机验收要用可解析的版本名
  出包（`CLASSTRACK_VERSION_NAME=1.0.0 …`，与 README「本地出签名包」同一做法）；卡片里也把这种情况如实说出来。
