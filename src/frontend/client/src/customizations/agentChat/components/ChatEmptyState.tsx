// Frontend fork of pages/appChat/components/ChatEmptyState.tsx. Edit this copy for custom chat.
import { StateView } from "@bisheng/ui";
import { useLocalize } from "~/hooks";
import { ArticleQAIllustration } from "~/components/illustrations";
interface ChatEmptyStateProps {
    onNewChat: () => void;
}
export function ChatEmptyState({ onNewChat }: ChatEmptyStateProps) {
    const localize = useLocalize();
    return (<StateView size="panel" image={<ArticleQAIllustration grey/>} title={<>
          {localize('com_app_chat_empty_line1')}
          <button type="button" onClick={onNewChat} className="inline border-none bg-transparent p-0 font-medium text-primary hover:underline">
            {localize('com_app_chat_empty_cta')}
          </button>
        </>}/>);
}
