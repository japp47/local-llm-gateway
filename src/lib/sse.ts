import type { ServerResponse } from 'node:http';

/** Write with backpressure; resolves early if the client goes away. */
export async function writeChunk(res: ServerResponse, chunk: string | Uint8Array): Promise<void> {
  if (res.destroyed || res.writableEnded) return;
  if (res.write(chunk)) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.once('drain', done);
    res.once('close', done);
  });
}

export const sseFrame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;