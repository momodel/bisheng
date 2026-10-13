import CardComponent from '@/components/bs-comp/cardComponent';
import { AppType } from '@/types/app';
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/bs-icons/user', () => ({ UserIcon: () => null }));

const props = {
    id: 'app-1', type: AppType.FLOW, title: 'App', description: '', data: { id: 'app-1' },
    edit: true, canSwitch: true, checked: false, onClick: vi.fn(),
};

describe('application publication feedback', () => {
    it('disables the switch immediately and sends one request until it finishes', async () => {
        let complete!: (success: boolean) => void;
        const onCheckedChange = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; }));
        render(<CardComponent {...props} onCheckedChange={onCheckedChange} />);
        const control = screen.getByRole('switch');
        fireEvent.click(control);
        expect(control).toBeDisabled();
        expect(control).toHaveAttribute('aria-busy', 'true');
        fireEvent.click(control);
        expect(onCheckedChange).toHaveBeenCalledTimes(1);
        await act(async () => complete(true));
        expect(control).toBeEnabled();
        expect(control).toBeChecked();
    });

    it('keeps the previous status on failure and allows retry', async () => {
        const onCheckedChange = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        render(<CardComponent {...props} onCheckedChange={onCheckedChange} />);
        const control = screen.getByRole('switch');
        fireEvent.click(control);
        await waitFor(() => expect(control).toBeEnabled());
        expect(control).not.toBeChecked();
        fireEvent.click(control);
        await waitFor(() => expect(control).toBeChecked());
        expect(onCheckedChange).toHaveBeenCalledTimes(2);
    });

    it('updates the displayed status when the server list refreshes', () => {
        const onCheckedChange = vi.fn();
        const { rerender } = render(<CardComponent {...props} onCheckedChange={onCheckedChange} />);
        expect(screen.getByRole('switch')).not.toBeChecked();
        rerender(<CardComponent {...props} checked onCheckedChange={onCheckedChange} />);
        expect(screen.getByRole('switch')).toBeChecked();
        expect(onCheckedChange).not.toHaveBeenCalled();
    });
});
