import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoot } from './layout/AppRoot';
import { HeaderTitle } from './components/HeaderTitle';
import { CUSTOM_CHAT_LAYOUT, CUSTOM_CHAT_VISIBILITY } from './customChatVisibility';

const mockMobileHeader = {
  title: 'Mobile conversation',
  conversationId: 'conversation',
  flowId: 'app',
  flowType: 5,
  readOnly: false,
  hideShare: false,
};
const mockCreateNewChat = jest.fn();
const mockSwitchConversation = jest.fn();

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ isAuthenticated: true }),
  useLocalize: () => (key: string) => key,
  useNewConvo: () => ({ newConversation: jest.fn() }),
}));
jest.mock('~/hooks/useMediaQuery', () => ({
  __esModule: true,
  default: (query: string) => globalThis.innerWidth <= Number(query.match(/\d+/)?.[0]),
}));
jest.mock('recoil', () => ({
  useRecoilState: () => [true, jest.fn()],
  useRecoilValue: (atom: string) => atom === 'mobile-header' ? mockMobileHeader : false,
  useSetRecoilState: () => jest.fn(),
}));
jest.mock('react-activation', () => ({ useUnactivate: jest.fn() }));
jest.mock('~/components/Banners', () => ({ Banner: () => null }));
jest.mock('./SideNav', () => ({ SideNav: () => <div data-testid="conversation-sidebar" /> }));
jest.mock('./components/MobileNav', () => ({
  MobileNav: (props: ComponentProps<typeof import('./components/MobileNav').MobileNav>) => {
    const { MobileNav } = jest.requireActual<typeof import('./components/MobileNav')>('./components/MobileNav');
    return <div data-testid="mobile-navigation"><MobileNav {...props} /></div>;
  },
}));
jest.mock('./components/MobileAppHistoryDropdown', () => ({
  MobileAppHistoryDropdown: ({ open }: { open: boolean }) => open ? <div data-testid="mobile-history" /> : null,
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: jest.fn() }) }));
jest.mock('~/components/Nav/MobileChatHistoryDropdown', () => ({ MobileChatHistoryDropdown: () => null }));
jest.mock('~/components/Nav/NavToggle', () => ({
  __esModule: true,
  default: () => <div data-testid="desktop-sidebar-toggle" />,
}));
jest.mock('./appChatOrigin', () => ({
  normalizeAppChatReturn: () => undefined,
  copyAppChatOrigin: jest.fn(),
  copyAppChatReturnTo: jest.fn(),
}));
jest.mock('./store/appSidebarAtoms', () => ({
  appConversationsState: 'conversations',
  sidebarVisibleState: 'sidebar-visible',
}));
jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    chatMobileNavHiddenState: 'mobile-nav-hidden',
    chatMobileHeaderState: 'mobile-header',
    conversationByIndex: () => 'conversation',
  },
}));
jest.mock('~/utils', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  generateUUID: () => 'new-conversation',
}));
jest.mock('bisheng-icons', () => ({
  Outlined: { Down: () => null, Plus: () => null, SidebarMenu: () => null },
}));
jest.mock('~/components/Share/ShareChat', () => ({
  __esModule: true,
  default: () => <div data-testid="share-entry" />,
}));
jest.mock('~/hooks/queries/data-provider', () => ({ useGetBsConfig: () => ({ data: {} }) }));
jest.mock('./hooks/useAppSidebar', () => ({
  useAppSidebar: () => ({
    groups: [{ label: 'Today', conversations: [{ id: 'previous', title: 'Previous conversation' }] }],
    currentApp: { name: 'Courseware app', can_share: true },
    createNewChat: mockCreateNewChat,
    switchConversation: mockSwitchConversation,
  }),
}));
jest.mock('./store/atoms', () => ({ currentChatState: 'current-chat' }));
jest.mock('~/components/Avator', () => ({ __esModule: true, default: () => null }));
jest.mock('~/components/ui/Tooltip2', () => ({}));
jest.mock('~/components/Nav/MobileSidebarHeaderTabs', () => ({
  MobileSidebarHeaderTabs: () => <div data-testid="mobile-system-tabs" />,
}));
jest.mock('~/layouts/UserPopMenu', () => ({
  UserPopMenu: () => <div data-testid="mobile-user-menu" />,
}));
jest.mock('./components/AppSidebarConvoItem', () => ({
  AppSidebarConvoItem: ({ conv, onClick }: { conv: { title: string }; onClick: () => void }) => <button onClick={onClick}>{conv.title}</button>,
}));
jest.mock('./components/AppSwitcherDropdown', () => ({ AppSwitcherDropdown: () => null }));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/custom-app/conversation/app/5']}>
      <AppRoot />
      <HeaderTitle conversation={{ title: 'Courseware conversation' }} />
    </MemoryRouter>,
  );
}

describe('custom chat responsive shell', () => {
  const originalWidth = window.innerWidth;

  afterEach(() => {
    window.innerWidth = originalWidth;
    localStorage.removeItem('customChatNavVisible');
  });

  it('uses the phone-only breakpoint by default', () => {
    expect(CUSTOM_CHAT_LAYOUT.mobileMaxWidth).toBe(767);
  });

  it.each([1440, 1024, 1023, 1000, 768])(
    'keeps desktop navigation and header at %ipx',
    (width) => {
      window.innerWidth = width;
      renderLayout();

      expect(screen.getByTestId('conversation-sidebar').parentElement).toHaveClass('w-[240px]');
      expect(screen.getByTestId('desktop-sidebar-toggle')).toBeInTheDocument();
      expect(screen.queryByTestId('mobile-navigation')).not.toBeInTheDocument();
      expect(screen.queryByTestId('mobile-history')).not.toBeInTheDocument();
      expect(screen.queryByTestId('share-entry')).not.toBeInTheDocument();
      expect(screen.getByText('Courseware conversation').closest('.h-\\[56px\\]')).toBeInTheDocument();
    },
  );

  it.each([767, 576, 375])('restores phone navigation at %ipx without hidden actions', (width) => {
    window.innerWidth = width;
    renderLayout();

    expect(screen.queryByTestId('conversation-sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('desktop-sidebar-toggle')).not.toBeInTheDocument();
    expect(screen.queryByText('Courseware conversation')).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-navigation')).toBeInTheDocument();
    expect(screen.getByText('Mobile conversation')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-header-new-chat-button')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-header-left-action')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-header-app-back')).not.toBeInTheDocument();
    expect(screen.queryByTestId('share-entry')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Mobile conversation'));
    expect(screen.getByTestId('mobile-history')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mobile-header-new-chat-button'));
    expect(screen.queryByTestId('mobile-history')).not.toBeInTheDocument();
  });

  it('does not switch navigation when an open desktop window is resized', () => {
    window.innerWidth = 1440;
    const view = renderLayout();
    window.innerWidth = 1000;
    view.rerender(
      <MemoryRouter initialEntries={['/custom-app/conversation/app/5']}>
        <AppRoot />
        <HeaderTitle conversation={{ title: 'Courseware conversation' }} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('conversation-sidebar').parentElement).toHaveClass('w-[240px]');
    expect(screen.queryByTestId('mobile-navigation')).not.toBeInTheDocument();
    expect(screen.getByText('Courseware conversation')).toBeInTheDocument();
  });

  it('switches at 767px and closes mobile history when returning to desktop', () => {
    window.innerWidth = 768;
    const view = renderLayout();
    const layout = () => <MemoryRouter initialEntries={['/custom-app/conversation/app/5']}>
      <AppRoot />
      <HeaderTitle conversation={{ title: 'Courseware conversation' }} />
    </MemoryRouter>;

    window.innerWidth = 767;
    view.rerender(layout());
    expect(screen.queryByTestId('conversation-sidebar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Mobile conversation'));
    expect(screen.getByTestId('mobile-history')).toBeInTheDocument();

    window.innerWidth = 768;
    view.rerender(layout());
    expect(screen.getByTestId('conversation-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-navigation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-history')).not.toBeInTheDocument();

    window.innerWidth = 767;
    view.rerender(layout());
    expect(screen.queryByTestId('mobile-history')).not.toBeInTheDocument();
  });

  it.each([1440, 1000, 768])('keeps sidebar spacing without mobile chrome at %ipx', (width) => {
    window.innerWidth = width;
    const { SideNav } = jest.requireActual<typeof import('./SideNav')>('./SideNav');
    const view = render(<MemoryRouter><SideNav /></MemoryRouter>);

    expect(view.container.firstElementChild).toHaveClass('px-3', 'pt-3', 'gap-4');
    expect(screen.getByText('Courseware app')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-system-tabs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-user-menu')).not.toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain('touch-mobile:');
  });

  it('allows phone history switching and new chats without app sharing', () => {
    const { MobileAppHistoryDropdown } = jest.requireActual<typeof import('./components/MobileAppHistoryDropdown')>('./components/MobileAppHistoryDropdown');
    const handleClose = jest.fn();
    render(<MemoryRouter><MobileAppHistoryDropdown open onClose={handleClose} /></MemoryRouter>);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('com_app_share_app')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Previous conversation'));
    expect(mockSwitchConversation).toHaveBeenCalledWith({ id: 'previous', title: 'Previous conversation' });
    expect(handleClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('com_knowledge_start_new_chat'));
    expect(mockCreateNewChat).toHaveBeenCalledTimes(1);
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it('honors mobile action visibility when entries are enabled', () => {
    const { MobileNav } = jest.requireActual<typeof import('./components/MobileNav')>('./components/MobileNav');
    const original = { ...CUSTOM_CHAT_VISIBILITY };
    const handleBack = jest.fn();
    try {
      Object.assign(CUSTOM_CHAT_VISIBILITY, { showSidebar: true, showGoBack: true, showShareEntry: true });
      render(<MemoryRouter><MobileNav navVisible={false} setNavVisible={jest.fn()} appSurfaceBackAction={handleBack} /></MemoryRouter>);
      expect(screen.getByTestId('mobile-header-left-action')).toBeInTheDocument();
      expect(screen.getByTestId('share-entry')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('mobile-header-app-back'));
      expect(handleBack).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(CUSTOM_CHAT_VISIBILITY, original);
    }
  });
});
