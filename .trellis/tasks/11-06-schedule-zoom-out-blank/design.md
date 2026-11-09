# 设计：缩放完整内容并按边界钳位，移除整表模糊

## 1. 最小行为差距与改动边界

当前需要修正的不是课程数据或最终档位，而是**预览几何**：旧实现缩放固定视口，缩小自然产生空白；目标是在固定视口中缩放完整网格。模糊是另一处独立但局部的视觉策略，直接删除，不替换为另一种全屏滤镜。

预计产品代码只改三处：

- `zoomPreview.ts`：焦点换算加入完整内容宽、视口宽、起始滚动位置与边界钳位；删除模糊常量与函数。
- `hooks/useScheduleZoom.ts`：变换/过渡写入网格，外层 stage 只保留相位锚点；进入手势时多读一次完整网格宽，逐帧仍只写 transform；删除模糊收尾工作。
- `ScheduleTable.tsx`：网格显式使用 `origin-top-left`，使现有数学真正以左上角为原点；DOM 尺寸分配不变。

测试、规范与浏览器探针同步更新。不改课程格、缓存、预热、边缘切周实现或数据结构。

## 2. 外部做法与本地证据

- [Calculations for pinch to zoom](https://josiahulfers.com/calculations-for-pinch-to-zoom.html) 明确区分固定 window 与变化 content：焦点属于窗口坐标，变换 pivot 属于内容坐标，平移补偿必须在两套坐标间换算。
- [Creating a Zoom UI](https://www.steveruiz.me/posts/zoom-ui) 的浏览器实现把 camera 映射为内容上的 CSS transform，视口本身不随缩放缩小。
- [MDN: zoom](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/zoom) 区分会参与布局的 `zoom` 与不触发布局、但受 overflow 影响的 `transform: scale()`；本项目继续使用后者做临时预览，松手才落真实布局。
- 本地规划探针 `research/probe-content-transform.mjs` 在当前生产页面临时把变换移到完整 2x 网格，覆盖 3 个滚动位置 × 3 个焦点 × 0.75/0.5 两个比例，共 18 组。所有组在下一帧仍覆盖视口，`scrollLeft` 均保持初值；原始读数见 `research/probe-content-transform.json`。因此不需要截图层、双缓冲或实时重排。

## 3. 坐标系与变换宿主

### 固定窗口

`[data-schedule-scroll]` 仍是唯一滚动视口；`[data-schedule-zoom-stage]` 仍是固定尺寸的外层裁剪与相位观测节点。缩放窗口本身不得再写 `transform`。

### 缩放内容

`[data-schedule-grid]` 是完整内容，预览与落定动画的 `translateX + scaleX` 都写它。网格增加 `origin-top-left`，因为当前 `tx = center × (1-k)` 公式本来就以 `transform-origin: 0 0` 为前提；默认中心原点会额外引入一份位移。

进入手势时一次性冻结：

```text
startScrollLeft = scroll.scrollLeft
viewportWidth   = scroll.clientWidth
contentWidth    = grid.offsetWidth
scrollCenterX   = pointerCenterClientX - scrollRect.left
contentCenterX  = startScrollLeft + scrollCenterX
```

按钮/双击令 `scrollCenterX = viewportWidth / 2`，其余相同。逐帧函数只接收冻结值与新的 scale，不读 DOM。

## 4. 焦点不变量与覆盖钳位

未触边时，网格使用：

```text
tx = contentCenterX × (1 - scale)
xScreen = xContent × scale + tx - startScrollLeft
```

代入 `xContent = contentCenterX` 得 `xScreen = scrollCenterX`，所以焦点不动。

为了不让完整内容缩出视口，对 `tx` 增加覆盖边界：

```text
scaledWidth = contentWidth × scale
txMax       = startScrollLeft                         // 左缘不晚于视口左缘
txMin       = startScrollLeft + viewportWidth - scaledWidth // 右缘不早于视口右缘
tx          = clamp(rawTx, txMin, txMax)               // txMin ≤ txMax 时
```

- `scale` 正常由 `clampZoom` 保证目标绝对值不小于 1，所以最小档位下 `scaledWidth === viewportWidth`，`txMin === txMax`，完整内容恰好铺满。
- 如果异常输入令 `scaledWidth < viewportWidth`，物理上不可能同时覆盖；取 `(txMin + txMax) / 2` 居中，避免偏向一侧，最终仍由合法档位落定修正。
- 钳位优先于焦点：在左边缘从 2x 收到 1x 时，左缘固定为 0，焦点随内容移动；这是边界缩放的标准取舍，不能再用固定焦点制造半屏空白。

## 5. 落定序列

落定仍在同一任务完成，但为保证 `scrollLeft` 按**真实目标网格**钳位，顺序调整为：

1. `setCellLayoutTier(tier)`；
2. 写网格 `--schedule-zoom`；
3. 清网格 `transform` / `transition`，清 stage 相位；
4. 写 `scrollLeft = clamp 后的既有焦点补偿结果`；
5. 提交一次 `setZoom(tier)`，恢复测量队列。

同一帧内没有“先显示未变换、再补偿”的中间绘制。三档缓存与课程格套用逻辑不动。

## 6. 局部文字模糊与减少动效

- 删除原 `PREVIEW_BLUR_PX`、`PREVIEW_BLUR_OUT_MS`、`blurFilter()`、`scheduleBlurOut()` 及对应 timer/rAF 字段；stage / grid 不恢复整表滤镜。
- 用户复核无模糊版本后明确指出横向字形变化仍不自然，要求保留框内模糊。最终只给 `[data-course-content]` 在 `[data-schedule-zoom-preview]` 祖先下设置 `blur(0.8px)`；卡片、描边、网格、表头与出勤角标不受影响。
- 不做滤镜渐变：commit 移除相位属性的同一帧，文字直接恢复清晰。
- `prefers-reduced-motion: reduce` 仍令 settle 时长为 0、直接 commit；手势期局部模糊用于可读性，不额外播放动画。
- 落定动画仍为 180ms transform 缓出，不新增 opacity 闪变。

## 7. 滚动溢出与手势兼容

旧守卫把“预览期 scrollWidth 数值完全不变”当作实现约束。内容变换后，放大可能暂时扩大视觉溢出；本次改守实际用户行为：

- 双指开始仍触发既有横滑 reset，预览期间不启动边缘切周；
- 预览不写 `scrollLeft`，落定前清变换，结束后滚动范围必须恢复真实档位值；
- 缩小的 18 组本地探针已确认 `scrollLeft` 不被自动钳走；放大路径在实施后用 CDP 补验终态与紧接横滑。
- 若实测出现预览期滚动范围干扰真实手势，再增加固定布局盒/裁剪包装；不在未复现前引入额外 DOM。

## 8. 验证与回滚

- 纯函数：焦点不动、左/右触边、最小比例铺满、异常窄内容居中、格式化与 reduced motion。
- 浏览器：把规划探针改为驱动真实产品手势/按钮，逐阶段读网格相对视口的 left/right，不只检查最终 DOM。
- 性能：沿用归档 CDP 探针的帧与长任务口径，断言改读网格 transform，且三个阶段 filter 均为空。
- 回归：三档逐格、静止态、边缘切周与七项门禁。
- 回滚点集中在上述三份产品文件；缓存与数据结构无迁移。若内容宿主产生不可接受的滚动副作用，可整体回到上一提交，不需数据恢复。
