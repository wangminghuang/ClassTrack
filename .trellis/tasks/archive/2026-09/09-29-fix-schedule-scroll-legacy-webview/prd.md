# 修复低版本 WebView 上课表无法上下滑动（html/body 的 height 兜底被构建删除）

## 现象（用户报告，2026-09-29）

- Android 12 等低版本设备上：应用内课表区域**无法上下滑动**。
- Android 16 设备上：**完全正常**。
- **关掉「左右边缘滑动切换周」后仍然滑不动** → 已排除边缘阻尼手势（用户实测）。

## 已确认的缺陷（构建产物层面，与具体设备无关）

1. `app/app.css` 的 `html, body` 高度写的是两行兜底：`height: 100%;` + `height: 100dvh;`。
2. **构建产物里只剩 `height: 100dvh`**（`build/client/assets/root-*.css`）：Tailwind v4 → lightningcss
   按当前浏览器目标把 `height: 100%` 当成「被覆盖的冗余声明」删掉了。
   实测：`targets: undefined` / `chrome 108` / `chrome 111` / `safari 16.4` 四种目标下都输出
   `html,body{height:100dvh;overflow:hidden}`；只有显式指定 `chrome 96` 才保留 `height:100%`。
3. `dvh` 需要 Chromium 108+。在不支持的 WebView 上，`html/body` 因此**一条 height 声明都没有** →
   计算值 `auto` → 应用外壳整条 `height:100%` 链（`.app-viewport` → `SidebarInset` → 页面根 →
   `ScheduleTable` → `[data-schedule-scroll]`）全部退化成内容高度。
4. 后果（桌面 Chrome 注入 `html,body{height:auto!important}` 精确模拟「不认识 dvh」的引擎 + CDP 真实触摸事件，
   视口 412×915 实测）：
   - 课表滚动容器 `clientHeight` 732 → **780**（= 内容高度），`scrollHeight` 780，
     **`maxScrollTop` 48 → 0 → 完全无法上下滑动**；
   - `html/body` 高度 915 → 963（超出视口），被 `body { overflow: hidden }` 裁掉 →
     底部内容既**滚不到**也**看不到**。
5. 同一类问题还有：
   - `.h-svh{height:100svh}` / `.min-h-svh{min-height:100svh}`（构建产物里同样没有 `100vh` 兜底）；
   - 三处对话框 `max-h-[calc(100dvh-2rem)]` / `h-[calc(100dvh-2rem)]`（`ImportDialog`、
     `MarkdownEditorDialog`、`ScheduleCourseDialog`）——在不支持 `dvh` 的引擎上整条声明失效。

## 待确认（阻塞根因认定）

- 用户决策（2026-09-29）：**拿不到那台 Android 12 设备的 WebView 版本，按 Chromium ≤ 107 推进**。
- 判定口径因此是「机制 + 等价复现」：`dvh` 缺失会让 `html/body` 失去高度锚点（已在浏览器里精确复现），
  修复后用同一手段验证；设备侧实测作为交付后的验收项（AC-6）。
- 若设备实测显示修复后仍滑不动，说明还有第二个原因，需回到实测重新定位
  （`[data-schedule-scroll]` 的 `clientHeight/scrollHeight`、`document.body.scrollHeight`、
  纵向拖动时 `scrollTop` 是否变化、`getComputedStyle(document.documentElement).height`）。

## Requirements

- **R1** `html, body` 的高度锚点在不支持 `dvh` 的引擎上必须仍然成立：兜底必须**活到构建产物里**
  （不能只写在源码里就被压缩器当冗余删掉），且在支持 `dvh` 的引擎上仍取 `dvh`（不改 PWA 动态视口语义）。
- **R2** **保持现有 CSS/JS 目标基线（Chrome 111+）不变**：不为了旧设备下调整体目标；
  但要把它连同「哪些特性没有兜底」记录成 spec 里的契约，并加可执行检查，防止构建工具再静默删兜底。
- **R3** 课表区域在内容超出容器时必须能上下滑动；**不允许**出现「内容被裁掉且滚不到」的状态。
- **R4** 修复不得改变现有视觉与尺寸分配。

## Acceptance Criteria

- [ ] **AC-1** 构建产物（`build/client/assets/*.css`）里对 `html, body` 同时存在：一条旧引擎可识别的
      高度兜底（`height: 100%`）与一条 `dvh` 升级（经 `@supports (height: 100dvh)` 包裹），且产物中 `dvh`
      仍对支持它的引擎生效。
- [ ] **AC-2** 在「不支持 `dvh`」的等价条件下（从产物样式中移除 `dvh` 规则 = 旧引擎行为），
      课表 `[data-schedule-scroll]` 的 `maxScrollTop > 0`，且 CDP 真实触摸的纵向拖动使 `scrollTop`
      增大到 `maxScrollTop`。
- [ ] **AC-3** 同等条件下 `getComputedStyle(document.body).height` 不再超出 `window.innerHeight`
      （内容不再被 `body{overflow:hidden}` 裁掉），且滚到底时第 12 节完全进入视口。
- [ ] **AC-4** 支持基线写进 spec，并有一条可执行检查（脚本/单测，接进 `pnpm test` 或复用既有
      `android:check-assets` 同款机制）断言「产物里兜底仍在」，防止再次被构建工具静默删除。
- [ ] **AC-5** 412×915 与 1440×900 的布局基线逐项与 `research/dvh-fallback-evidence.md` §5 一致
      （容器尺寸、行列模板、字号、课程格尺寸、课程格数量、缩放控件是否渲染）。
- [ ] **AC-6** 真机验收：在报告问题的 Android 12 设备上确认课表可上下滑动；顺带补上
      `09-29-schedule-edge-swipe-device-verify` 的 AC-18 中「纵向滚动零回归」一条。

## 预防性加固（2026-09-29 追加，用户决策：范围 = C2 + D）

**动机**：AC-6 真机未做，且本次修复只在「设备 WebView 是 Chromium ≤ 107」时才覆盖用户的缺陷。用户要求
「若实测仍滑不动（存在第二个原因），不要再返工一轮」—— 因此补两条：**消掉最可能的结构性第二原因** +
**把未知原因压成可快速定位的诊断**。

### Requirements（追加）

- **R5** 应用外壳的高度锚点**不得单点依赖** `html/body`：在不支持 `dvh` 的引擎上 `.app-viewport` 必须自带
  视口高度锚点，使 `html/body` 那层因任何原因失效时外壳仍成立；对支持 `dvh` 的引擎必须**零影响**。
- **R6** 「课表滑不动」必须能快速定位层级：提供一条**不改产品代码**的设备端诊断手段，输出高度锚点链、
  滚动量、祖先链 `touch-action` / `overscroll` / 内联 `transform`，并用「程序化滚动 vs 触摸滚动」对照，
  直接分辨故障落在「锚点/布局层」「触摸事件层」还是「本来就不需要滚动」。

### Acceptance Criteria（追加）

- [ ] **AC-7** C2：正常引擎上 412×915 与 1440×900 的布局基线逐项不变；把 `html/body` 的 `height` 全部拿掉
      （= 修复前状态）时 `[data-schedule-scroll]` 的 `maxScrollTop > 0` 且纵向拖动后 `scrollTop === maxScrollTop`；
      且**构建产物里 `@supports not (height: 100dvh)` 块仍存在**（没被构建器优化掉）—— 由产物守卫断言。
- [ ] **AC-8** D：诊断器械能跑通，并对三种状态给出正确判定：① 正常（有滚动量且可程序化滚动）；
      ② 锚点失效（内容被裁但无滚动量 → 指向锚点/布局层）；③ 无需滚动（内容不超出容器且没有内容被裁）。

### 实测依据（候选逐个量过，见 `research/preventive-hardening-probe.mjs` 与验证记录）

| 候选 | 结论 | 证据 |
| --- | --- | --- |
| **C2** 外壳自带锚点（`@supports not (height: 100dvh)` 里取 `100vh`） | ✅ 采用 | 场景 5：锚点拿掉后 `maxScrollTop` 0 → 48、拖动 0 → 48，课程格 49×121 → 47×121、字号 10.5474px → 10.1108px 全部回基线；场景 2：正常引擎逐项不变 |
| **A** 网格 `min-height`（=`48.75rem`） | ❌ 不做 | 基线中性（只多出不可见的网格盒高 732 → 780），但场景 4 实测**救不了**锚点丢失类（仍 `maxScrollTop = 0`） |
| **B** 手势位移挪到裁剪层 | ⏸ 推迟 | 用户已实测排除它是本次原因；动的是刚上线且未真机验证的手势层，真机验收后单独评估 |
| **E** 降低行最小值让 12 节不必滚动 | ❌ 不做 | 会改视觉基线（违反 R4），且 09-24 的尺度体系需重测 |
| `touch-action` 祖先链 | ✅ 排除 | 实测祖先链逐层 `auto`，只有滚动容器是 `pan-x pan-y`；`touch-none` 只出现在 `ui/scroll-area.tsx` |

## Non-goals

- **不在本次修**：`.h-svh` / `.min-h-svh`（sidebar 包装）与三处 `[calc(100dvh-2rem)]` 对话框
  —— 同类问题已记录在案（见 `research/dvh-fallback-evidence.md` §1/§5），本次只修 `html/body` 这条致命项。
- 不主动把整体 CSS/JS 目标降到更老的引擎；Chromium <111 上其它特性（`oklch`、`color-mix`、
  容器查询单位 `cqw/cqh`）的降级不在本次范围。
- 不修改课表交互与手势行为本身。
- **不做 A**（网格 `min-height`）：实测救不了任何失败场景，不加没有实证的声明。
- **推迟 B**（手势位移挪到裁剪层）：真机验收通过后再单独评估，避免同一轮里改动两个变量。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
