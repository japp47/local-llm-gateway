import client from 'prom-client';
import type { Semaphore } from '../lib/semaphore.js';

export function createMetrics(limiter: Semaphore) {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const ttft = new client.Histogram({
    name: 'llm_ttft_seconds',
    help: 'Time to first generated token',
    labelNames: ['model'],
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
  });

  const duration = new client.Histogram({
    name: 'llm_request_duration_seconds',
    help: 'Time spent holding a generation slot',
    labelNames: ['model', 'status'],
    buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
    registers: [registry],
  });

  const tokens = new client.Counter({
    name: 'llm_tokens_total',
    help: 'Tokens processed',
    labelNames: ['model', 'kind'],
    registers: [registry],
  });

  const rejected = new client.Counter({
    name: 'llm_rejected_total',
    help: 'Requests rejected by the gateway',
    labelNames: ['reason'],
    registers: [registry],
  });

  new client.Gauge({
    name: 'llm_queue_depth',
    help: 'Requests waiting for a slot',
    registers: [registry],
    collect() { this.set(limiter.queued); },
  });

  new client.Gauge({
    name: 'llm_in_flight',
    help: 'Requests currently generating',
    registers: [registry],
    collect() { this.set(limiter.inFlight); },
  });

  return { registry, ttft, duration, tokens, rejected };
}

export type Metrics = ReturnType<typeof createMetrics>;