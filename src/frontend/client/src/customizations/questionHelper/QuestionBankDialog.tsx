import { useEffect, useId, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@bisheng/ui';
import { createQuestionBank, getQuestionBanks, importQuestions, type QuestionBank } from '~/api/questionHelper';
import { NotificationSeverity } from '~/common';
import { Checkbox } from '~/components/ui/Checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/Dialog';
import { useAuthContext, useLocalize } from '~/hooks';
import { useToastContext } from '~/Providers';

interface QuestionBankDialogProps {
  content: string;
  onClose: () => void;
  onImported: (content: string) => void;
}

export function QuestionBankDialog({ content, onClose, onImported }: QuestionBankDialogProps) {
  const t = useLocalize();
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<QuestionBank[]>([]);
  const busyRef = useRef(false);
  const searchId = useId();
  const nameId = useId();
  const banksKey = ['question-helper', user?.id, 'banks'];

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const banks = useInfiniteQuery({
    queryKey: [...banksKey, query],
    queryFn: ({ pageParam = 1 }) => getQuestionBanks(pageParam, query),
    getNextPageParam: page => page.nextPage,
    retry: false,
  });
  const create = useMutation({ mutationFn: createQuestionBank });
  const importing = useMutation({
    mutationFn: (ids: string[]) => importQuestions(content, ids),
  });
  const busy = create.isLoading || importing.isLoading;
  const availableBanks = [...new Map((banks.data?.pages.flatMap(page => page.banks) ?? [])
    .map(bank => [bank.id, bank])).values()];

  const handleCreate = async () => {
    if (busyRef.current || !name.trim()) return;
    busyRef.current = true;
    try {
      const bank = await create.mutateAsync(name.trim());
      setSelected(previous => previous.some(item => item.id === bank.id) ? previous : [...previous, bank]);
      setName('');
      void queryClient.invalidateQueries({ queryKey: banksKey });
      showToast({ message: t('questionHelper.bankCreated'), severity: NotificationSeverity.SUCCESS });
    } catch {
      showToast({ message: t('questionHelper.createFailed'), severity: NotificationSeverity.ERROR });
    } finally {
      busyRef.current = false;
    }
  };

  const handleImport = async () => {
    if (busyRef.current || !selected.length) return;
    busyRef.current = true;
    try {
      await importing.mutateAsync(selected.map(bank => bank.id));
      onImported(content);
      showToast({ message: t('questionHelper.imported'), severity: NotificationSeverity.SUCCESS });
    } catch {
      showToast({ message: t('questionHelper.importFailed'), severity: NotificationSeverity.ERROR });
    } finally {
      busyRef.current = false;
    }
  };

  const handleToggle = (bank: QuestionBank, checked: boolean) => {
    setSelected(previous => checked
      ? previous.some(item => item.id === bank.id) ? previous : [...previous, bank]
      : previous.filter(item => item.id !== bank.id));
  };

  return <Dialog open onOpenChange={open => { if (!open && !busyRef.current) onClose(); }}>
    <DialogContent close={!busy} className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg">
      <DialogHeader>
        <DialogTitle>{t('questionHelper.addToBank')}</DialogTitle>
        <DialogDescription>{t('questionHelper.selectBanks')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-body-sm">
        <label htmlFor={searchId} className="text-text-2">{t('questionHelper.searchBanks')}</label>
        <Input id={searchId} value={search} onChange={event => setSearch(event.target.value)} disabled={busy} />
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border-base p-2" aria-busy={banks.isFetching}>
          {banks.isLoading && <p className="p-2 text-text-3" role="status">{t('questionHelper.loadingBanks')}</p>}
          {availableBanks.map(bank => <label key={bank.id} className="flex cursor-pointer items-center gap-2 rounded-md p-2 hover:bg-fill-1">
            <Checkbox checked={selected.some(item => item.id === bank.id)} disabled={busy}
              onCheckedChange={checked => handleToggle(bank, checked === true)} />
            <span className="min-w-0 break-words text-text-1">{bank.name}</span>
          </label>)}
          {!banks.isLoading && !banks.isError && !availableBanks.length && <p className="p-2 text-text-3">{t('questionHelper.noBanks')}</p>}
          {banks.isError && <div className="space-y-2 p-2" role="alert">
            <p className="text-danger">{t('questionHelper.loadFailed')}</p>
            <Button variant="outlined" size="small" loading={banks.isFetching} disabled={busy}
              onClick={() => void banks.refetch()}>{t('questionHelper.retry')}</Button>
          </div>}
          {banks.hasNextPage && !banks.isError && <Button variant="text" size="small"
            loading={banks.isFetchingNextPage} disabled={busy || banks.isFetching}
            onClick={() => void banks.fetchNextPage()}>{t('questionHelper.loadMore')}</Button>}
        </div>
        {selected.length > 0 && <div className="space-y-2">
          <p className="text-text-2">{t('questionHelper.selectedCount', { count: selected.length })}</p>
          <div className="flex flex-wrap gap-2">
            {selected.map(bank => <Button key={bank.id} variant="filled" color="default" size="small" disabled={busy}
              aria-label={t('questionHelper.removeBank', { name: bank.name })}
              onClick={() => handleToggle(bank, false)}>{bank.name} ×</Button>)}
          </div>
        </div>}
        <div className="space-y-2 border-t border-border-base pt-3">
          <label htmlFor={nameId} className="text-text-2">{t('questionHelper.newBankName')}</label>
          <div className="flex items-center gap-2">
            <Input id={nameId} className="min-w-0 flex-1" value={name}
              onChange={event => setName(event.target.value)} disabled={busy} />
            <Button variant="outlined" size="medium" loading={create.isLoading} disabled={busy || !name.trim()}
              onClick={handleCreate}>{t('questionHelper.createBank')}</Button>
          </div>
        </div>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outlined" size="medium" disabled={busy} onClick={onClose}>{t('questionHelper.cancel')}</Button>
        <Button size="medium" loading={importing.isLoading} disabled={busy || !selected.length}
          onClick={handleImport}>{t('questionHelper.confirmImport')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
