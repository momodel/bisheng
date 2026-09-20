import type { ComponentProps } from 'react';
import { Button } from '@bisheng/ui';
import { useNavigate } from 'react-router-dom';
import { useLocalize } from '~/hooks';
import { AgentCard } from '~/pages/apps/components/AgentCard';

interface ExploreAgentCardProps extends ComponentProps<typeof AgentCard> {}

export function ExploreAgentCard(props: ExploreAgentCardProps) {
  const navigate = useNavigate();
  const localize = useLocalize();
  const { agent } = props;

  const handleCustomChat = () => {
    navigate(`/custom-app/${encodeURIComponent(agent.id)}/${agent.flow_type}?from=explore&returnTo=%2Fapps%2Fexplore`, {
      state: { appSurfaceReturn: '/apps/explore' },
    });
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
