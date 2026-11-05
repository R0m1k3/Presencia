// Confirmation dialogs that name the action (no window.confirm).

type Ask = { title: string; text: string; ok: string; danger: boolean; resolve: (yes: boolean) => void };

class Confirm {
  current = $state<Ask | null>(null);
}

export const confirmState = new Confirm();

export function confirm(title: string, text: string, ok: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.current?.resolve(false);
    confirmState.current = { title, text, ok, danger, resolve };
  });
}
