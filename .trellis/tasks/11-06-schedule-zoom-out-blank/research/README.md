# 调研：课表缩放预览几何与模糊

## 结论

1. 同类捏合缩放把固定窗口与完整内容分成两个坐标系，变换作用于内容；焦点补偿用内容坐标计算。当前实现缩放视口本身，是缩小半屏空白的直接原因。
2. 到达内容边界或最小比例时，覆盖视口优先于绝对固定焦点；通过平移钳位避免空白。
3. 本项目继续采用“手势期合成 transform、松手一次真实重排”，不回到逐帧改宽度。
4. 不再用固定 `blur(3px)` 覆盖整个缩放过程。性能测试里“不多长任务”不等于视觉细腻，文字可读性与边缘清晰度由用户反馈优先。

## 外部资料

- [Calculations for pinch to zoom — Should Be Simple](https://josiahulfers.com/calculations-for-pinch-to-zoom.html)：固定 window / 变化 content 两套坐标、焦点与 pivot 的平移补偿推导。
- [Creating a Zoom UI — Steve Ruiz](https://www.steveruiz.me/posts/zoom-ui)：浏览器里用 screen/canvas 坐标映射和 CSS transform 实现缩放，变换针对 canvas 内容。
- [MDN — zoom CSS property](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/zoom)：`zoom` 影响布局；`transform: scale()` 不重算布局，但受 transform-origin 与 overflow 影响。
- [CSS Transforms Module Level 1](https://www.w3.org/TR/css-transforms-1/)：变换影响 client rect 与渲染；用于核对 `getBoundingClientRect()` 读的是变换后的覆盖范围。

## 本地动态探针

规划阶段未改产品源码。`probe-content-transform.mjs` 在当前生产页面完成放大到 2x 后，临时把以下变换写到完整网格：

```text
rawTx = (startScrollLeft + viewportCenterX) × (1 - scale)
tx    = clamp(rawTx, startScrollLeft + viewportWidth - contentWidth × scale, startScrollLeft)
```

矩阵：滚动位置 0 / 50% / 100% × 焦点 25% / 50% / 75% × scale 0.75 / 0.5，共 18 组。

结果（`probe-content-transform.json`）：

- 每组下一帧的内容右缘均不早于视口右缘，左缘均不晚于内容盒左缘；scale 0.5 时完整 2x 内容恰好变成 1x 视口宽。
- 每组 `scrollLeft` 在变换后与 50ms 后都保持初值，没有发生缩小导致自动钳位。
- 缩小场景的 `scrollWidth` 保持 758px；放大是否暂时扩大视觉溢出由实施后的产品路径探针补验，验收以真实滚动/切周行为与终态为准。

该探针只证明几何方案值得实施，不代替修改后真实状态机、三入口和真机验收。

## 实施后产品路径验收

所有结果均来自修改后的**生产构建**、合成 18 格课程夹具与本机 Chrome；不是只改 DOM 的规划探针。

### 缩小覆盖与三入口

```bash
bash .trellis/tasks/11-06-schedule-zoom-out-blank/research/run-zoom-coverage.sh
```

`verify-zoom-coverage.mjs` 驱动真实产品状态机，覆盖 − 按钮、双击、合成双指、非整数吸附和 reduce：

- **29 个中间态 + 29 个静止态全部通过**（`zoom-coverage.json`）；中间态逐一断言完整网格覆盖滚动内容盒、stage 不缩放、stage / grid 不模糊、课程文字内容使用局部 `blur(0.8px)`、原点为 `0px 0px`。
- 双指覆盖 3 个滚动位置 × 3 个焦点 × 0.75 / 0.5 两档比例；手势期真实布局宽与 React 档位不变。
- 2x→1x 的按住中间帧见 `zoom-out-preview.png`：内容铺满全宽，仅课程框内文字局部软化，框架不发虚。
- 落定后 transform / filter / transition 与相位全部清空，`scrollWidth` 恢复真实档位宽。

### 手势性能

```bash
bash .trellis/tasks/11-06-schedule-zoom-out-blank/research/run-zoom-perf.sh 1
```

`zoom-perf.json`：1x→2x 与 2x→1x 各两轮，手势期分别为 81–82 帧，**最大帧间隔均 16.8ms，零 ≥50ms 长任务**。最终生产构建的四轮松手后 600ms 窗口也都为零长任务。

读数也确认了变换宿主的差别：放大时视觉溢出可暂时变化，缩小时 `scrollWidth=758` 与 `scrollLeft` 保持稳定；两种方向的真实 `grid.offsetWidth` 和 React 档位在手势期都不变，落定后恢复正确滚动范围。

### 课程格与边缘切周

```bash
bash .trellis/tasks/11-06-schedule-zoom-out-blank/research/run-zoom-layout-verify.sh .trellis/tasks/11-06-schedule-zoom-out-blank/research/zoom-layout.json
PERF_ASSERT=1 bash .trellis/tasks/11-06-schedule-zoom-out-blank/research/run-week-switch-perf.sh 1 .trellis/tasks/11-06-schedule-zoom-out-blank/research/week-switch.json
```

- 360×794 / 412×731 / 1440×900 三视口逐格报告 `zoom-layout.json.*`，**violations 全 0**；手机覆盖 1 / 1.5 / 2，桌面覆盖既有双击 1 / 2。
- 六次真实 CDP 横滑均只切一周，终态 `idle`、transform / opacity 清空；最差帧间隔 **33.4ms**，零长任务（`week-switch.json`）。
- `verify-zoom-input.mjs` 另做真实触摸输入：单指纵向后 `scrollTop=232`（达到夹具最大值），课程卡点按成功打开对话框，之后无 transform / filter / 相位残留（`zoom-input.json`）。

## 门禁与未验证范围

全量结果为 50 个测试文件 / 476 项单测通过，typecheck、lint、format、build、WebView CSS 与 Android 资产守卫通过；Impeccable 机械检测无发现。仍不把桌面 Chrome 模拟触摸当成真机验收，最终手感需用户在 Android 设备复核。
