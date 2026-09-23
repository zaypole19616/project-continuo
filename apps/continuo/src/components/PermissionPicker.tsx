import { ChevronDown, ShieldCheck } from 'lucide-react';
import type { PermissionMode } from '#/lib/api';
import { DropdownMenu, DropdownMenuCheck, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '#/components/ui/dropdown-menu';

const MODES: ReadonlyArray<{ mode: PermissionMode; label: string; hint: string }> = [
  { mode: 'manual', label: '始终询问', hint: '仅自动读取，其余操作逐一向你确认' },
  { mode: 'yolo', label: '必要时询问', hint: '自动完成常规修改和命令；高危操作、提问和计划仍会问你' },
  { mode: 'auto', label: '完全自动', hint: '完全不打断，所有操作和判断自动完成' },
];

export function PermissionPicker({ mode, disabled, onChange }: { mode: PermissionMode; disabled: boolean; onChange: (mode: PermissionMode) => void }) {
  const current = MODES.find((item) => item.mode === mode) ?? MODES[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="model-chip perm-chip" disabled={disabled} title={current.hint}><ShieldCheck size={12} />{current.label}<ChevronDown size={11} /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="perm-menu">
        {MODES.map((item) => (
          <DropdownMenuItem key={item.mode} onSelect={() => { if (item.mode !== mode) onChange(item.mode); }}>
            <div className="min-w-0 flex-1">
              <div className="perm-label">{item.label}</div>
              <div className="perm-hint">{item.hint}</div>
            </div>
            <DropdownMenuCheck shown={item.mode === mode} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
