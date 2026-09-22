/* eslint-disable no-restricted-imports -- Scope the existing chat implementation without defining new atoms. */
import { useEffect } from 'react';
import { AliveScope } from 'react-activation';
import { Outlet } from 'react-router-dom';
import { RecoilRoot, useRecoilValue, useSetRecoilState } from 'recoil';
import { useAuthContext } from '~/hooks';
import store from '~/store';
import { RequireLogin } from '~/routes/RequireLogin';
import { disposeCustomChatSockets } from './useWebsocket';

function CustomChatSession() {
  const { user } = useAuthContext();
  const setUser = useSetRecoilState(store.user);

  useEffect(() => { setUser(user); }, [user, setUser]);
  useEffect(() => () => disposeCustomChatSockets(), []);

  return <Outlet />;
}

export function CustomChatBoundary() {
  const user = useRecoilValue(store.user);
  const language = useRecoilValue(store.lang);

  return (
    <RequireLogin><RecoilRoot initializeState={({ set }) => {
      set(store.user, user);
      set(store.lang, language);
    }}>
      <AliveScope>
        <CustomChatSession />
      </AliveScope>
    </RecoilRoot></RequireLogin>
  );
}
