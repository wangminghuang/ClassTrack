# 证据：`html, body` 的 `height: 100%` 兜底被构建删除

采集时间：2026-09-29 · 环境：本机 Chrome（`agent-browser`）+ 视口 412×915 / 1440×900，dpr 2，
种子数据复用归档夹具 `.trellis/tasks/archive/2026-09/09-20-mobile-schedule-week-grid/research/seed-schedule-fixture.js`
（`currentWeek = 3`、`maxWeek = 16`、18 个课程格）。

## 1. 源码与产物的差异（根因）

`app/app.css`：

```css
html,
body {
  @apply bg-background text-foreground antialiased;
  height: 100%;
  height: 100dvh;
  overflow: hidden;
}
```

`build/client/assets/root-BSQn1Kme.css`（`pnpm build` 产物）：

```css
html,body{background-color:var(--background);color:var(--foreground);-webkit-font-smoothing:antialiased;
-moz-osx-font-smoothing:grayscale;height:100dvh;overflow:hidden}
```

**`height: 100%` 没了。** 整份产物里 `dvh` 只出现这一次，`html/body` 的高度只有这一个来源。

## 2. 兜底被删的版本分界线（lightningcss 1.32.0，即仓库实际用的那一份）

`research/lightningcss-fallback-matrix.mjs` 输出：

```
A 现状 height:100% + height:100dvh     默认（项目实际）        兜底保留=false  html,body{height:100dvh;overflow:hidden}
A 现状 height:100% + height:100dvh     chrome 111            兜底保留=false  html,body{height:100dvh;overflow:hidden}
A 现状 height:100% + height:100dvh     chrome 107            兜底保留=true   html,body{height:100%;height:100dvh;overflow:hidden}
B height:100% + @supports(height:100dvh) 默认                兜底保留=true   html,body{height:100%;overflow:hidden}
                                                              @supports (height:100dvh){html,body{height:100dvh}}
B height:100% + @supports(height:100dvh) chrome 111          兜底保留=true   （同上，@supports 未被展开/删除）
C height:100vh + height:100dvh         默认                  兜底保留=false  html,body{height:100dvh;overflow:hidden}
D height:100dvh + height:100%（颠倒）    默认                  兜底保留=true   html,body{height:100%;overflow:hidden}   ← dvh 被丢掉
E 拆到 html / body 两个选择器            默认                  兜底保留=true   html{height:100%}body{height:100dvh}
G height:100dvh + min-height:100%     默认                  兜底保留=true   html,body{height:100dvh;min-height:100%}

--- 兜底被删的版本分界线 ---
chrome 96 -> 保留兜底: true
chrome 108 -> 保留兜底: false
```

结论：

- **分界线 = Chrome 108**（Safari 分界线 15.4），与 `dvh` 单位的支持起点一致。
  lightningcss 认为目标支持 `dvh`，于是把前一条 `height: 100%` 当冗余删掉。
- **写法 B 是唯一既能保住兜底、又不丢 `dvh` 语义的写法**：`@supports` 块没有被展开，两条声明都活着。
- 写法 C（`100vh` 兜底）也会被删；写法 D 会**丢掉 dvh**（现代引擎也退回 `100%`，PWA 动态视口语义没了）；
  写法 E 语义变了（html 与 body 高度来源不一致）；写法 G 的 `min-height:100%` 在 `auto` 父级上等于 `auto`，不解决问题。

## 3. 「不支持 dvh」的等价复现（现状 = 坏）

`research/cdp-dvh-simulation.mjs` 在页面里注入 `html, body { height: auto !important }`
（= 旧引擎忽略 `height:100dvh` 后 html/body 的计算值），再用 CDP `Input.dispatchTouchEvent`
派发单指纵向拖动（650 → 350，14 步）：

| 指标 | 正常（支持 dvh） | 模拟旧 WebView |
|---|---|---|
| `getComputedStyle(html).height` | `915px` | `963px` |
| `getComputedStyle(body).height` | `915px` | `963px` |
| `body.scrollHeight` | `915` | `963`（被 `body{overflow:hidden}` 裁掉） |
| `[data-schedule-scroll]` clientHeight | `732` | `780`（= 内容高度） |
| `[data-schedule-scroll]` scrollHeight | `780` | `780` |
| **`maxScrollTop`** | **48** | **0** |
| 拖动后 `scrollTop` | `48` | **`0`（纹丝不动）** |

即：课表容器长到与内容等高、自身没得滚，超出视口的部分被 `body` 裁掉，**既滚不到也看不到**
—— 与用户描述的「课表无法上下滑动」一致。

## 4. 纵向滚动本身在支持 dvh 的引擎上是好的（对照组）

`research/cdp-vertical-scroll-matrix.mjs`（412/360 × 915/800/740/700/660/600/540 共 14 组）：

```
412x915 clientH=732 scrollH=780 max=48  drag 655->355 => scrollTop 0->48  OK(max)
412x800 clientH=617 scrollH=780 max=163 drag 568->268 => scrollTop 0->163 OK(max)
412x700 clientH=517 scrollH=780 max=263 drag 493->193 => scrollTop 0->263 OK(max)
412x540 clientH=357 scrollH=780 max=423 drag 373->124 => scrollTop 0->303 PARTIAL
（360 宽同形）
```

另测：纯纵向 / 斜向 / 横向起手后转纵向、切周之后、连续三次横滑之后、2x 缩放之后、双指之后，
纵向滚动全部正常、无残留 `transform`。**支持 dvh 的引擎上（含桌面 Chrome）复现不出本缺陷**，
与「安卓 16 完全正常」一致。

## 5. 现状基线（AC-5 要逐项对齐的数字）

| 项 | 412×915 | 1440×900 |
|---|---|---|
| `[data-schedule-scroll]` clientW / clientH | 379 / 732 | 1142 / 798 |
| `[data-schedule-scroll]` scrollW / scrollH | 379 / 780 | 1142 / 798 |
| `[data-schedule-grid]` gridTemplateColumns | `32px 49.5625px ×7`（实测逐字符见下） | `64px 154px ×7` |
| `[data-schedule-grid]` gridTemplateRows | `36px 62px ×12` | `36px 63.5px ×12` |
| 首个课程格 clientWidth / clientHeight | 47 / 121 | 151 / 124 |
| 首个 `[data-course-name]` fontSize / lineHeight | 10.1108px / 11.6274px | 15px / 17.25px |
| `[data-course-cell]` 数量 | 18 | 18 |
| `[data-schedule-zoom-control]` 是否在 DOM | 是 | 否（桌面不渲染） |

## 6. 复现/验收配方

```bash
export XDG_RUNTIME_DIR=/tmp/ab-runtime
cd <repo root>
node .trellis/tasks/09-29-fix-schedule-scroll-legacy-webview/research/make-seed.mjs   # 产出 /tmp/ct-seed-write.js
(nohup pnpm dev --port 5173 > /tmp/ct-dev.log 2>&1 &)
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:5173/ && break; sleep 1; done

agent-browser --session ct --init-script /tmp/ct-seed-write.js set viewport 412 915
agent-browser --session ct --init-script /tmp/ct-seed-write.js open http://localhost:5173/
sleep 2
WS=$(agent-browser --session ct get cdp-url)
node .trellis/tasks/09-29-fix-schedule-scroll-legacy-webview/research/cdp-dvh-simulation.mjs "$WS"
node .trellis/tasks/09-29-fix-schedule-scroll-legacy-webview/research/lightningcss-fallback-matrix.mjs
```

**环境坑（本沙盒）**

- `XDG_RUNTIME_DIR` 默认只读，必须 `export XDG_RUNTIME_DIR=/tmp/ab-runtime`，且不能与 `pnpm dev &`
  写在同一条 `&&` 链里（整条链会被 `&` 放进子 shell）。
- `agent-browser get cdp-url` 给的是 **browser** 端点，`Runtime.evaluate` 只存在于 **page** target；
  脚本里要先 `fetch http://<host>/json/list` 取 `type === 'page'` 的 `webSocketDebuggerUrl`。
- 灌种子必须用 `--init-script`：直接 `eval` 写 localStorage 会与 App 自身的 persist 写回竞态，
  且夹具里的中文 + 双引号经 `"\$(cat …)"` 会被 shell 吃掉转义（所以有了 `make-seed.mjs`）。
