import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '#/components/ui/dialog';
import { Button } from '#/components/ui/button';
import { Textarea } from '#/components/ui/textarea';

export function AbandonDialog({ title, open, onCancel, onConfirm }: { title: string; open: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="flex flex-col gap-3">
        <DialogTitle>放弃「{title}」</DialogTitle>
        <DialogDescription>方案文件和已经做过的内容都会保留，只是它不再作为可选的方案。</DialogDescription>
        <Textarea autoFocus rows={3} placeholder="为什么放弃（可以不写）" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button variant="default" onClick={() => onConfirm(reason)}>放弃</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
