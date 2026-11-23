/**
 * Talks to the engine Web Worker. Each request gets a job number; replies with
 * another job number (from a cancelled run) are ignored.
 */
import type { FromWorker, ToWorker } from '@cleanify/session';

type Request = ToWorker extends infer T
  ? T extends { job: number }
    ? Omit<T, 'job'>
    : never
  : never;
type Reply = Exclude<FromWorker, { type: 'progress' }>;
type Pending = {
  resolve: (r: Reply) => void;
  reject: (e: Error) => void;
  onProgress?: ((phase: string, fraction: number) => void) | undefined;
};

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export class EngineClient {
  private worker: Worker;
  private job = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      const p = this.pending.get(msg.job);
      if (!p) return;
      if (msg.type === 'progress') {
        p.onProgress?.(msg.phase, msg.fraction);
        return;
      }
      this.pending.delete(msg.job);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    w.onerror = (e) => {
      const err = new Error(e.message || 'The engine stopped unexpectedly');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    return w;
  }

  request(
    msg: Request,
    onProgress?: (phase: string, fraction: number) => void,
    transfer: Transferable[] = [],
  ): Promise<Reply> {
    const job = ++this.job;
    return new Promise((resolve, reject) => {
      this.pending.set(job, { resolve, reject, onProgress });
      this.worker.postMessage({ ...msg, job } as ToWorker, transfer);
    });
  }

  /** Stops whatever is running: the worker is replaced and pending requests fail. */
  cancel(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new CancelledError());
    this.pending.clear();
    this.worker = this.spawn();
  }
}
