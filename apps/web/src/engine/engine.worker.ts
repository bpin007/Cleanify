/// <reference lib="webworker" />
/**
 * The engine Web Worker: all decoding, analysis and applying happens here, off the
 * main thread (PROJECT.md section 8). Nothing leaves the browser.
 */
import type { FromWorker, ToWorker } from './protocol';
import { EngineSession } from './session';

declare const self: DedicatedWorkerGlobalScope;

const session = new EngineSession();
const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  const progress = (phase: string, fraction: number) =>
    post({ type: 'progress', job: msg.job, phase, fraction });
  try {
    switch (msg.type) {
      case 'analyze':
        post({
          type: 'analyzed',
          job: msg.job,
          data: await session.analyze(msg.input, msg.settings, progress),
        });
        break;
      case 'reanalyze':
        post({
          type: 'analyzed',
          job: msg.job,
          data: await session.reanalyze(msg.encoding, msg.settings, progress),
        });
        break;
      case 'decide':
        post({ type: 'decided', job: msg.job, data: session.decide(msg.decisions) });
        break;
      case 'output':
        post({ type: 'output', job: msg.job, text: session.outputText() });
        break;
      case 'serialize': {
        const r = session.serialize(msg.encoding, msg.bomCount);
        if (r.ok) post({ type: 'serialized', job: msg.job, bytes: r.bytes }, [r.bytes.buffer]);
        else post({ type: 'unencodable', job: msg.job, encoding: msg.encoding, chars: r.chars });
        break;
      }
    }
  } catch (e) {
    post({ type: 'error', job: msg.job, message: e instanceof Error ? e.message : String(e) });
  }
};
