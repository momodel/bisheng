// Frontend fork of layouts/appModuleNavPaths.ts. Edit this copy for custom chat.
export const lastSectionPaths: Record<string, string> = {};
export function appsSectionLinkTarget(): string {
    const p = lastSectionPaths.apps;
    if (!p)
        return '/apps';
    if (p.startsWith('/apps/explore') || p.startsWith('/custom-app/'))
        return '/apps';
    return p;
}
