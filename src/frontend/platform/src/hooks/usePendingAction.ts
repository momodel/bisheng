import { useRef, useState } from 'react';

export function usePendingAction() {
    const inFlight = useRef(false);
    const [pending, setPending] = useState(false);

    async function runAction<T>(action: () => Promise<T>): Promise<T | undefined> {
        if (inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        try {
            return await action();
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    }

    return { pending, runAction };
}
