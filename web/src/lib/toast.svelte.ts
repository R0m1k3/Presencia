// Short messages at the bottom of the screen: success 3 s, error 6 s, undo 8 s.

export type Toast = {
  id: number;
  kind: 'ok' | 'error' | 'undo';
  text: string;
  action?: { label: string; run: () => void };
};

const DURATION = { ok: 3000, error: 6000, undo: 8000 };
let next = 1;

class Toasts {
  list = $state<Toast[]>([]);

  show(kind: Toast['kind'], text: string, action?: Toast['action']): number {
    const id = next++;
    // One undo offer at a time: a new action replaces the previous one.
    if (kind === 'undo') this.list = this.list.filter((t) => t.kind !== 'undo');
    this.list = [...this.list, { id, kind, text, action }];
    setTimeout(() => this.dismiss(id), DURATION[kind]);
    return id;
  }

  dismiss(id: number) {
    this.list = this.list.filter((t) => t.id !== id);
  }

  dismissUndo() {
    this.list = this.list.filter((t) => t.kind !== 'undo');
  }
}

export const toasts = new Toasts();
export const ok = (text: string) => toasts.show('ok', text);
export const error = (text: string) => toasts.show('error', text);
