import { mkdir, open, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

const dataDir = workerData?.dataDir || '.local-data';
const runtimeFile = join(dataDir, 'agent-runtime.json');
const lifecycleJournalFile = join(dataDir, 'agent-runtime.lifecycle.jsonl');

parentPort?.on('message', async (message = {}) => {
  const sequence = Number(message.sequence || 0);
  try {
    if (message.operation === 'append-lifecycle') {
      const body = `${JSON.stringify(message.entry)}\n`;
      await mkdir(dirname(lifecycleJournalFile), { recursive: true });
      const handle = await open(lifecycleJournalFile, 'a');
      try {
        await handle.write(body);
        await handle.sync();
      } finally {
        await handle.close();
      }
      parentPort?.postMessage({ type: 'written', operation: message.operation, sequence, bytes: Buffer.byteLength(body) });
      return;
    }

    const body = `${JSON.stringify(message.document, null, 2)}\n`;
    await mkdir(dirname(runtimeFile), { recursive: true });
    const temporaryFile = `${runtimeFile}.tmp-${process.pid}-${sequence}-${Date.now()}`;
    await writeFile(temporaryFile, body);
    await rename(temporaryFile, runtimeFile);
    // Every lifecycle entry queued before this checkpoint is represented by
    // the checkpoint document. Clearing the journal only after the atomic
    // rename keeps restart recovery safe across either side of the rename.
    await writeFile(lifecycleJournalFile, '');
    parentPort?.postMessage({ type: 'written', operation: 'checkpoint', sequence, bytes: Buffer.byteLength(body) });
  } catch (error) {
    parentPort?.postMessage({
      type: 'error',
      sequence,
      error: String(error?.stack || error?.message || error),
    });
  }
});
