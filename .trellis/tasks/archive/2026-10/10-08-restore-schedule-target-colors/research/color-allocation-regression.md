# 课程共用颜色：回退证据

## 原因

`51f08a8` 在恢复目标色板时，把 `buildCourseColorMap` 从 `718812f` 已有的课程号去重排序、顺序分配改成了更早的课程号哈希取模。哈希保证同一课程颜色稳定，但不保证不同课程不同色；因此两门课也可能重色。

## 历史对照

- `718812f^:app/features/schedule/utils.ts` 使用 `courseHash(courseId) % courseColors.length`；当时的目标色板已有 8 色，历史哈希同样存在碰撞。
- `718812f:app/features/schedule/courseColor.ts` 已改成对整学期 `courseId` 去重排序，再按 `index % 8` 分配，8 门以内没有颜色碰撞。
- `51f08a8` 恢复目标 8 色、白字和同序淡化色，同时误将顺序分配换成哈希。此次按用户“回退就好”的要求，直接恢复 `718812f` 的分配函数体与缺失映射的档位 0 兜底。

## 复现与验证

直接将当前 TypeScript 模块转译后调用 `buildCourseColorMap` 和 `resolveCourseTheme`，只需课程号 `1001` / `1009`：

| 版本 | `1001` | `1009` |
| --- | --- | --- |
| 修复前 `51f08a8` | 档位 0，`#87e5d4` | 档位 0，`#87e5d4` |
| 回退后 | 档位 0，`#87e5d4` | 档位 1，`#7bb7ef` |

不同课程号已足以复现，因此无需导入错误或组件样式覆盖就能触发此问题。未获取用户真实课表，本结论基于实际分配模块和最小输入。

将碰撞输入保存在 `app/features/schedule/courseColor.test.ts`，复现命令：

```bash
pnpm exec vitest run app/features/schedule/courseColor.test.ts
```

- 修改产品代码前：5 项失败，首项报告 `expected 'bg-[#87e5d4]' not to be 'bg-[#87e5d4]'`。
- 恢复历史分配后：5 项通过，覆盖两门课碰撞、八门不同课程、重复与乱序、超过八门循环复用、非本周对应淡化色、空映射兜底。
- 差分检查：从 git 读取 `718812f` 的真实模块，对 0 / 2 / 8 / 9 / 40 门课程及反向排列逐一比较 `Map`；当前映射均与该版本一致。

## 保持的边界

- 目标主色板与对应淡化色、白字、描边均未变动。
- 沿用整学期映射，未在每周重建；同一数据集刷新后和跨周同色。
- 仍为历史 8 色方案，超过 8 门循环复用；增删课程可能改变排序档位。
- 预防规则与回归挂钩已写入 `.trellis/spec/frontend/mobile-schedule-layout.md` 的“课程颜色分配”。
