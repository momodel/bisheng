import type { RouteObject } from 'react-router-dom';

// Data-router lazy loading resolves before rendering the KeepAlive tree.
// A Suspense boundary outside AliveScope can repeatedly unmount its listeners.
export const customAgentChatRoutes: RouteObject[] = [{
  path: 'custom-app',
  lazy: async () => ({ Component: (await import('./CustomChatBoundary')).CustomChatBoundary }),
  children: [{
    lazy: async () => ({ Component: (await import('./layout/MainLayout')).MainLayout }),
    children: [{
      lazy: async () => ({ Component: (await import('./layout/AppRoot')).AppRoot }),
      children: [
        { path: ':fid/:type', lazy: async () => ({ Component: (await import('./AppChatEntry')).AppChatEntry }) },
        { path: ':conversationId/:fid/:type', lazy: async () => ({ Component: (await import('./index')).AppChat }) },
      ],
    }],
  }],
}];
