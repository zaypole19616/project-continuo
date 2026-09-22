import * as React from 'react';
import { Dialog as Primitive } from 'radix-ui';
import { cn } from '#/lib/utils';

function Dialog(props: React.ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root data-slot="dialog" {...props} />;
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <Primitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-border bg-popover p-9 text-popover-foreground shadow-xl outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-150',
          className,
        )}
        {...props}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof Primitive.Title>) {
  return <Primitive.Title data-slot="dialog-title" className={cn('text-xl font-bold tracking-tight', className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof Primitive.Description>) {
  return <Primitive.Description data-slot="dialog-description" className={cn('text-[15px] leading-relaxed text-muted-foreground', className)} {...props} />;
}

export { Dialog, DialogContent, DialogTitle, DialogDescription };
