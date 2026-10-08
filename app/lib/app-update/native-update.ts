import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'

/** 原生更新适配层：版本与前后台状态。失败通过返回值表达，不抛错。 */
export type AppVersionInfo = {
  /** 安装包的 versionName，如 `1.0.10-beta`；它就是「当前版本」的真相来源。 */
  version: string
  /** versionCode，仅用于诊断展示。 */
  build: string
}

/**
 * 读取当前安装包的版本信息。
 *
 * @returns 版本名非空时返回信息；插件不可用或读失败返回 `null`（调用方据此静默禁用整个功能）。
 */
export async function readAppVersionInfo(): Promise<AppVersionInfo | null> {
  try {
    const info = await App.getInfo()
    const version = typeof info.version === 'string' ? info.version.trim() : ''
    if (!version) return null

    return { version, build: typeof info.build === 'string' ? info.build : '' }
  } catch {
    return null
  }
}

/** @returns 原生前台状态；插件不可用时返回 null，调用方保持后台状态。 */
export async function readAppIsActive(): Promise<boolean | null> {
  try {
    return (await App.getState()).isActive
  } catch {
    return null
  }
}

/**
 * 同时监听前台和后台，避免请求在后台完成时弹出提示。
 * @param handler 消费原生生命周期事件。
 * @returns 监听句柄；插件不可用时返回 null。
 */
export async function addAppStateListener(handler: (active: boolean) => void): Promise<PluginListenerHandle | null> {
  try {
    return await App.addListener('appStateChange', (state) => handler(state.isActive))
  } catch {
    return null
  }
}
