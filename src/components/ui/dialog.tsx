"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "./button";

/**
 * Accessible modal built on the native <dialog>: focus trap, Esc to close, backdrop and inert background come
 * from the browser. Controlled via `open`.
 */
export function Dialog({
  open, onClose, title, description, children,
}: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby="dialog-title"
      className="w-[min(32rem,calc(100vw-2rem))] rounded-lg border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-black/50"
    >
      {open ? (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 id="dialog-title" className="text-lg font-semibold">{title}</h2>
              {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="h-4 w-4" aria-hidden /></Button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
