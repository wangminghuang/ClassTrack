import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router'

import type { Route } from './+types/root'
import { Toaster } from '~/components/ui/sonner'
import CourseImportShellEntry from '~/components/import-flow/CourseImportShellEntry'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/nord.css'
import MarkdownEditorDialog from '~/components/dialog/MarkdownEditorDialog'
import PwaUpdatePrompt from '~/components/pwa/PwaUpdatePrompt'
import { isNativeApp } from '~/lib/native-platform'
import WidgetSnapshotSync from '~/components/native-widget/WidgetSnapshotSync'
import WidgetGuideDialog from '~/components/native-widget/WidgetGuideDialog'
import ProfileGuideDialog from '~/components/native-widget/ProfileGuideDialog'
import UpdateCheckRunner from '~/components/app-update/UpdateCheckRunner'
import ScheduleScrollDiagnosticsPanel from '~/features/diagnostics/ScheduleScrollDiagnosticsPanel'
import './app.css'
import React from 'react'

// React Router v7 自动使用的特殊函数
function isNativeShellRequest() {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('native-shell') === '1'
}

export function Layout({ children }: { children: React.ReactNode }) {
  const nativeShell = isNativeShellRequest()

  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#1c1c1e" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="ClassTrack" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <title>ClassTrack</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        {!nativeShell && <Toaster position="top-center" />}
        {!nativeShell && <MarkdownEditorDialog />}
        {!nativeShell && !isNativeApp() && <PwaUpdatePrompt />}
        {!nativeShell && <WidgetSnapshotSync />}
        {/* 导入成功后的一次性加桌引导：与 WidgetSnapshotSync 同属小工具联动，挂同一处（组件自己判平台）。 */}
        {!nativeShell && <WidgetGuideDialog />}
        {/* 加桌引导关闭后的第二段引导（去个人中心）：显示时机由 store 与加桌面板开合共同决定。 */}
        {!nativeShell && <ProfileGuideDialog />}
        {/*
          更新检测：同一份实例既驱动「冷启动 / 回前台」的自动检查，又渲染「发现新版本」模态框，
          所以只能挂一处。非 Android 时它内部直接不渲染 —— PWA 的更新提示仍由 PwaUpdatePrompt 负责。
        */}
        {!nativeShell && <UpdateCheckRunner />}
        {/* 课表滚动诊断浮层（诊断包专用）：默认关闭（`diagnosticFlags.ts`），诊断分支随包开启。见任务 10-10-schedule-scroll-device-rootcause。 */}
        {!nativeShell && <ScheduleScrollDiagnosticsPanel />}
        {!nativeShell && <ScrollRestoration />}
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return isNativeShellRequest() ? <CourseImportShellEntry /> : <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'Oops!'
  let details = 'An unexpected error occurred.'
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'Error'
    details = error.status === 404 ? 'The requested page could not be found.' : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
