/**
 * 诊断器械的编译期开关（来源任务 `10-10-schedule-scroll-device-rootcause`）。
 *
 * 为什么还要一个「默认开」的开关：原生应用里**用户改不了 URL**，光靠 `?diag=schedule-scroll`
 * 参数他根本打不开浮层。因此诊断把器械分两步交给用户：
 * 1. 在**诊断分支**上把这里改成 `true`，出的包一打开课表就带浮层（用户零操作）；
 * 2. master 上恒为 `false`，配合 URL 参数只作为本地自查入口 ⇒ 生产包不含诊断 UI。
 *
 * 这也回答了「开关默认关闭」与「用户能打开」这对矛盾：隔离靠**分支**，不靠用户操作。
 */
export const DIAGNOSTICS_ENABLED_BY_DEFAULT = true
