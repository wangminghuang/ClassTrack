# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | To fill |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |
| [Native Course Import](./native-course-import.md) | Capacitor/WebView bridge, payload validation, and fallback contract | Implemented |
| [Android Home-Screen Widget](./android-home-widget.md) | Widget snapshot bridge, five-tier refresh ladder, and the guarantee/staleness contract | Implemented |
| [Mobile Schedule Layout](./mobile-schedule-layout.md) | 手机端课表契约：整周 7 天自适应铺满、1x~2x 只改列宽的信息分级、节次时间推导规则与自动化测试挂钩 | Implemented |
| [App Update Check](./app-update.md) | 更新检测契约：Release 版本解析与 URL 白名单、通道判定与**一次性播种的持久性**、**调度记账（成功才消耗间隔窗口 + 失败冷却 + 存量间隔迁移）**、release 正文的 token → React 元素渲染与降级表、仅前台弹窗与固定 6 小时间隔、调试注入验收法 | Implemented |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**语言**：所有文档一律用**中文**书写。
