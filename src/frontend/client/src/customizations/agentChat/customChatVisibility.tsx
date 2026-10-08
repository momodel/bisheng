// Only phone-sized viewports use the mobile shell; larger windows stay desktop.
export const CUSTOM_CHAT_LAYOUT = {
    mobileMaxWidth: 767,
};

// Centralized visibility switches for custom chat chrome.
// Set a switch to true to restore its UI without changing JSX.
export const CUSTOM_CHAT_VISIBILITY = {
    // MainLayout system sidebar, including the mobile app drawer.
    showSidebar: false,
    // SideNav header and AppRoot floating back actions.
    showGoBack: false,
    // SideNav app sharing and HeaderTitle conversation sharing.
    showShareEntry: false,
    // SideNav app switcher; disabling it removes the entire dropdown.
    showAppSwitcherTrigger: false,
    // HeaderTitle Linsight workspace action.
    showWorkspaceButton: false,
    // Assistant message footer actions; keep only copying visible by default.
    showMessageCopy: true,
    showMessageReferences: false,
    showMessageTimestamp: true,
    showMessageExport: false,
    showMessageSpeech: false,
    showMessageFeedback: false,
};
