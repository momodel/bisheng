// Frontend fork of pages/appChat/appChatOrigin.ts. Edit this copy for custom chat.
export type AppChatOrigin = 'home' | 'center' | 'explore';
export type AppChatReturnTo = '/apps' | '/apps/explore' | '/c/new';
export function appChatOriginStorageKey(conversationId: string): string {
    return `custom-app-chat-origin:${conversationId}`;
}
export function appChatReturnStorageKey(conversationId: string): string {
    return `custom-app-chat-return:${conversationId}`;
}
export function normalizeAppChatReturn(path?: string | null): AppChatReturnTo | null {
    if (!path)
        return null;
    const normalizedPath = path.trim().replace(/\/+$/, '');
    if (normalizedPath === '/apps' || normalizedPath === '/workspace/apps')
        return '/apps';
    if (normalizedPath === '/apps/explore' || normalizedPath === '/workspace/apps/explore')
        return '/apps/explore';
    if (normalizedPath === '/c/new' || normalizedPath === '/workspace/c/new')
        return '/c/new';
    return null;
}
export function isAllowedAppChatReturn(path?: string | null): path is AppChatReturnTo {
    return normalizeAppChatReturn(path) !== null;
}
export function writeAppChatOrigin(conversationId: string, origin: AppChatOrigin): void {
    if (!conversationId)
        return;
    try {
        sessionStorage.setItem(appChatOriginStorageKey(conversationId), origin);
    }
    catch {
    }
}
export function readAppChatOrigin(conversationId: string): AppChatOrigin | null {
    if (!conversationId)
        return null;
    try {
        const v = sessionStorage.getItem(appChatOriginStorageKey(conversationId));
        if (v === 'home' || v === 'center' || v === 'explore')
            return v;
    }
    catch {
    }
    return null;
}
export function copyAppChatOrigin(fromConversationId: string, toConversationId: string): void {
    if (!fromConversationId || !toConversationId || fromConversationId === toConversationId)
        return;
    const existing = readAppChatOrigin(toConversationId);
    if (existing)
        return;
    const from = readAppChatOrigin(fromConversationId);
    if (from)
        writeAppChatOrigin(toConversationId, from);
}
export function writeAppChatReturnTo(conversationId: string, returnTo: AppChatReturnTo): void {
    if (!conversationId)
        return;
    const normalized = normalizeAppChatReturn(returnTo);
    if (!normalized)
        return;
    try {
        sessionStorage.setItem(appChatReturnStorageKey(conversationId), normalized);
    }
    catch {
    }
}
export function readAppChatReturnTo(conversationId: string): AppChatReturnTo | null {
    if (!conversationId)
        return null;
    try {
        const v = sessionStorage.getItem(appChatReturnStorageKey(conversationId));
        return normalizeAppChatReturn(v);
    }
    catch {
    }
    return null;
}
export function copyAppChatReturnTo(fromConversationId: string, toConversationId: string): void {
    if (!fromConversationId || !toConversationId || fromConversationId === toConversationId)
        return;
    if (readAppChatReturnTo(toConversationId))
        return;
    const from = readAppChatReturnTo(fromConversationId);
    if (from)
        writeAppChatReturnTo(toConversationId, from);
}
export function resolveAppChatExitNavigateTarget(conversationId: string | undefined, location: {
    state?: unknown;
    search: string;
}): AppChatReturnTo | '/apps' {
    if (conversationId) {
        const stored = readAppChatReturnTo(conversationId);
        if (stored)
            return stored;
    }
    const fromState = normalizeAppChatReturn((location.state as {
        appSurfaceReturn?: string;
    } | null | undefined)?.appSurfaceReturn);
    if (fromState)
        return fromState;
    const fromQuery = normalizeAppChatReturn(new URLSearchParams(location.search || '').get('returnTo'));
    if (fromQuery)
        return fromQuery;
    return '/apps';
}
export function deriveAppChatOriginFromEntry(search: string, state: unknown): AppChatOrigin | null {
    const sp = new URLSearchParams(search || '');
    const returnTo = normalizeAppChatReturn(sp.get('returnTo'));
    const from = sp.get('from');
    const entry = sp.get('entry');
    if (returnTo === '/apps')
        return 'center';
    if (returnTo === '/apps/explore')
        return 'explore';
    if (returnTo === '/c/new')
        return 'home';
    if (from === 'center')
        return 'center';
    if (from === 'explore')
        return 'explore';
    if (from === 'home-recommended' && entry === 'home')
        return 'home';
    const sr = (state as {
        appSurfaceReturn?: string;
    } | null | undefined)?.appSurfaceReturn;
    const normalizedSurfaceReturn = normalizeAppChatReturn(sr);
    if (normalizedSurfaceReturn === '/apps')
        return 'center';
    if (normalizedSurfaceReturn === '/apps/explore')
        return 'explore';
    if (normalizedSurfaceReturn === '/c/new')
        return 'home';
    return null;
}
