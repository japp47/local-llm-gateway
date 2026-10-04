import client from 'prom-client';
import { limiter } from '../lib/limiter.js';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const ttft = new client.Histogram({
  name: 'llm_ttft_seconds',
  help: 'Time to first streamed chunk',
  labelNames: ['model'],
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const duration = new client.Histogram({
  name: 'llm_request_duration_seconds',
  help: 'Total time in the generation slot',
  labelNames: ['model', 'status'],
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [registry],
});

export const tokens = new client.Counter({
  name: 'llm_tokens_total',
  help: 'Tokens processed',
  labelNames: ['model', 'kind'],
  registers: [registry],
});

export const rejected = new client.Counter({
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