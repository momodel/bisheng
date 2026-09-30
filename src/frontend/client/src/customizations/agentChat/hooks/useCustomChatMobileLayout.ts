import useMediaQuery from '~/hooks/useMediaQuery';
import { CUSTOM_CHAT_LAYOUT } from '../customChatVisibility';

export function useCustomChatMobileLayout(): boolean {
  return useMediaQuery(`(max-width: ${CUSTOM_CHAT_LAYOUT.mobileMaxWidth}px)`);
}
