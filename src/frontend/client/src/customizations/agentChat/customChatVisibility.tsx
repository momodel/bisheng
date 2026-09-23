// 定制聊天 chrome 区的集中可见性开关。
// 想恢复某块 UI 时把对应字段改为 true 即可，无需再解开 JSX 注释。
export const CUSTOM_CHAT_VISIBILITY = {
    // MainLayout 整块系统侧边栏（桌面端侧边栏 + 移动端应用抽屉）。
    showSidebar: false,
    // 回退按钮：SideNav 头部回退区与 AppRoot 的悬浮回退按钮。
    showGoBack: false,
    // 分享入口：SideNav 的分享应用按钮与 HeaderTitle 的分享按钮。
    showShareEntry: false,
    // 应用切换入口：SideNav 的切换器；关闭时整个下拉不渲染。
    showAppSwitcherTrigger: false,
    // 工作区入口：HeaderTitle 的 Linsight workspace 按钮。
    showWorkspaceButton: false,
};
