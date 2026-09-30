import type { ComponentProps } from 'react';
import { Button } from '@bisheng/ui';
import { useHref, useLocation } from 'react-router-dom';
import { CUSTOM_APP_IDS } from '~/customizations/config';
import { lessonPlanSearch, lessonPlanTarget } from '~/customizations/lessonPlan/lessonPlanUtils';
import { useLocalize } from '~/hooks';
import { AgentCard } from '~/pages/apps/components/AgentCard';

interface ExploreAgentCardProps extends ComponentProps<typeof AgentCard> {}

export function ExploreAgentCard(props: ExploreAgentCardProps) {
  const localize = useLocalize();
  const location = useLocation();
  const { agent } = props;
  const customChatUrl = useHref(
    `/custom-app/${encodeURIComponent(agent.id)}/${agent.flow_type}`,
  );

  const handleCustomChat = () => {
    let search = lessonPlanSearch(agent.id, location.search);
    if (agent.id === CUSTOM_APP_IDS.lessonPlan && !lessonPlanTarget(search)) {
      const params = new URLSearchParams(search);
      params.set('cache_id', Date.now().toString());
      search = `?${params.toString()}`;
    }
    window.open(`${customChatUrl}${search}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <AgentCard {...props} />
      {[5, 10].includes(Number(agent.flow_type)) && (
        <Button color="default" variant="outlined" onClick={handleCustomChat}>
          {localize('com_app.custom_chat_enter')}
        </Button>
      )}
    </div>
  );
}
