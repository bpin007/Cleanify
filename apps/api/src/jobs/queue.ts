/**
 * Background jobs (PROJECT.md section 14). Production uses Agenda, which stores jobs in
 * MongoDB, so a job interrupted by a restart runs again; every handler is idempotent.
 * Tests use the in-process queue with the same handlers.
 */
import { MongoBackend } from '@agendajs/mongo-backend';
import { Agenda } from 'agenda';
import type mongoose from 'mongoose';

export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

export interface JobQueue {
  define(name: string, handler: JobHandler): void;
  enqueue(name: string, data: Record<string, unknown>): Promise<void>;
  /** Runs `name` every `interval` (e.g. "10 minutes") while the API is up. */
  every(interval: string, name: string): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class AgendaQueue implements JobQueue {
  private readonly agenda: Agenda;

  constructor(connection: mongoose.Connection, log: (msg: string, e: unknown) => void) {
    // The driver mongoose ships is passed in, so there is one MongoDB connection.
    const backend = new MongoBackend({
      mongo: connection.db as never,
      collection: 'agendaJobs',
    } as ConstructorParameters<typeof MongoBackend>[0]);
    this.agenda = new Agenda({ backend, processEvery: '2 seconds' });
    this.agenda.on('fail', (err: Error, job: { attrs: { name: string } }) =>
      log(`[jobs] ${job.attrs.name} failed`, err),
    );
  }

  define(name: string, handler: JobHandler) {
    this.agenda.define(
      name,
      async (job) => handler((job.attrs.data ?? {}) as Record<string, unknown>),
      {
        concurrency: 2,
        // A job that hasn't reported back in 10 minutes is assumed dead and runs again.
        lockLifetime: 10 * 60 * 1000,
      },
    );
  }

  async enqueue(name: string, data: Record<string, unknown>) {
    await this.agenda.now(name, data);
  }

  async every(interval: string, name: string) {
    await this.agenda.every(interval, name);
  }

  async start() {
    await this.agenda.start();
  }

  async stop() {
    await this.agenda.stop();
  }
}

/** Runs jobs in this process, right away (tests and anything that needs no persistence). */
export class InlineQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly running = new Set<Promise<void>>();
  readonly errors: unknown[] = [];

  define(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  async enqueue(name: string, data: Record<string, unknown>) {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`No handler for job ${name}`);
    const p: Promise<void> = (async () => {
      await new Promise((r) => setImmediate(r));
      await handler(data);
    })()
      .catch((e: unknown) => {
        this.errors.push(e);
      })
      .finally(() => this.running.delete(p));
    this.running.add(p);
  }

  /** Runs a defined job now and waits for it (tests). */
  async run(name: string, data: Record<string, unknown> = {}) {
    await this.handlers.get(name)!(data);
  }

  /** Waits until every queued job has finished (tests). */
  async idle() {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }

  async every() {}
  async start() {}
  async stop() {
    await this.idle();
  }
}
