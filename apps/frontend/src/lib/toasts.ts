export const TOAST_DURATION_MS = 6000;

export interface Toast {
  id: number;
  message: string;
}

type Listener = (toasts: Toast[]) => void;

interface Countdown {
  remainingMs: number;
  startedAt: number;
  timeout: ReturnType<typeof setTimeout> | null;
  holds: number;
}

export class ToastQueue {
  private toasts: Toast[] = [];
  private nextId = 1;
  private readonly countdowns = new Map<number, Countdown>();
  private readonly listeners = new Set<Listener>();

  show(message: string): void {
    const toast = { id: this.nextId++, message };
    this.toasts = [...this.toasts, toast];
    this.countdowns.set(toast.id, {
      remainingMs: TOAST_DURATION_MS,
      startedAt: 0,
      timeout: null,
      holds: 0,
    });
    this.startCountdown(toast.id);
    this.notify();
  }

  dismiss(id: number): void {
    const countdown = this.countdowns.get(id);
    if (countdown === undefined) return;

    this.stopCountdown(countdown);
    this.countdowns.delete(id);
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
    this.notify();
  }

  hold(id: number): void {
    const countdown = this.countdowns.get(id);
    if (countdown === undefined) return;

    countdown.holds += 1;
    this.stopCountdown(countdown);
  }

  release(id: number): void {
    const countdown = this.countdowns.get(id);
    if (countdown === undefined) return;

    countdown.holds -= 1;
    if (countdown.holds === 0) this.startCountdown(id);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.toasts);

    return () => this.listeners.delete(listener);
  }

  private startCountdown(id: number): void {
    const countdown = this.countdowns.get(id);
    if (countdown === undefined) throw new Error(`No toast with ID ${id}`);

    countdown.startedAt = Date.now();
    countdown.timeout = setTimeout(
      () => this.dismiss(id),
      countdown.remainingMs,
    );
  }

  private stopCountdown(countdown: Countdown): void {
    if (countdown.timeout === null) return;

    clearTimeout(countdown.timeout);
    countdown.timeout = null;
    countdown.remainingMs -= Date.now() - countdown.startedAt;
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.toasts);
  }
}

export const toasts = new ToastQueue();
