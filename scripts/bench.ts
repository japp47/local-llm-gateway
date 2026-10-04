const URL = 'http://127.0.0.1:3000/v1/chat/completions';
const KEY = process.env.BENCH_KEY ?? 'dev-key-123';
const MODEL = process.env.BENCH_MODEL ?? 'llama3.2:3b';
const concurrency = Number(process.argv[2] ?? 1);
const total = Number(process.argv[3] ?? 6);

type R = { status: number; ttftMs?: number; tokPerSec?: number; totalMs?: number };

async function one(): Promise<R> {
  const t0 = performance.now();
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      max_tokens: 128,
      messages: [{ role: 'user', content: 'Explain database indexing in about 100 words.' }],
    }),
  });
  if (!res.ok || !res.body) return { status: res.status };

  let ttftMs = 0;
  let events = 0;
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    if (!ttftMs) ttftMs = performance.now() - t0;
    events += (decoder.decode(chunk, { stream: true }).match(/data: \{/g) ?? []).length;
  }
  const totalMs = performance.now() - t0;
  return { status: 200, ttftMs, totalMs, tokPerSec: events / ((totalMs - ttftMs) / 1000) };
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : NaN;
};

const results: R[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (next++ < total) results.push(await one());
  }),
);

const ok = results.filter((r) => r.status === 200);
console.log({ concurrency, total, ok: ok.length, rejected: results.length - ok.length });
console.table({
  'TTFT ms p50': Math.round(pct(ok.map((r) => r.ttftMs!), 50)),
  'TTFT ms p95': Math.round(pct(ok.map((r) => r.ttftMs!), 95)),
  'tok/s p50': Number(pct(ok.map((r) => r.tokPerSec!), 50).toFixed(1)),
  'total ms p95': Math.round(pct(ok.map((r) => r.totalMs!), 95)),
});