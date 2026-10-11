import { SseParser } from '../sse.js';
import type { StreamHandlers, StreamMeta, StreamResult } from './types.js';

type JsonObject = Record<string, unknown>;

export async function consumeStream(
  response: Response,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<StreamResult> {
  if (!response.body) {
    throw new Error('Gateway returned an empty event stream.');
  }
  const result: StreamResult = { text: '', status: 'complete', aborted: false, incomplete: true };
  const parser = new SseParser();
  const decoder = new TextDecoder();
  try {
    for await (const chunk of response.body) {
      for (const event of parser.push(decoder.decode(chunk, { stream: true }))) {
        applyEvent(result, event.event, event.data, handlers);
      }
    }
  } catch (error) {
    const aborted = typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError';
    if (!aborted && !signal?.aborted) throw error;
    result.aborted = true;
    result.status = 'partial';
    result.incomplete = false;
  }
  return result;
}

function applyEvent(result: StreamResult, event: string, raw: string, handlers: StreamHandlers) {
  if (!['start', 'delta', 'meta', 'error', 'done'].includes(event)) return;
  const data = parseEventData(raw, event);
  switch (event) {
    case 'start': {
      const start = {
        requestId: requiredString(data, 'requestId', event),
        conversationId: requiredString(data, 'conversationId', event),
        userMessageId: requiredString(data, 'userMessageId', event),
        model: requiredString(data, 'model', event),
      };
      result.userMessageId = start.userMessageId;
      handlers.onStart?.(start);
      break;
    }
    case 'delta': {
      const text = requiredString(data, 'text', event);
      result.text += text;
      handlers.onDelta?.(text);
      break;
    }
    case 'meta':
      result.meta = parseStreamMeta(data);
      break;
    case 'error':
      result.error = {
        code: requiredString(data, 'code', event),
        message: requiredString(data, 'message', event),
      };
      break;
    case 'done': {
      if (data.status !== 'complete' && data.status !== 'partial' && data.status !== 'error') {
        throw new Error('Missing or invalid "status" in "done" stream event.');
      }
      if (data.assistantMessageId !== null && typeof data.assistantMessageId !== 'string') {
        throw new Error('Invalid "assistantMessageId" in "done" stream event.');
      }
      result.status = data.status;
      result.assistantMessageId = data.assistantMessageId;
      result.incomplete = false;
      break;
    }
  }
}

function parseEventData(raw: string, event: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in "${event}" stream event.`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid payload in "${event}" stream event.`);
  }
  return value as JsonObject;
}

function requiredString(data: JsonObject, field: string, event: string): string {
  const value = data[field];
  if (typeof value !== 'string') {
    throw new Error(`Missing or invalid "${field}" in "${event}" stream event.`);
  }
  return value;
}

function requiredNumber(data: JsonObject, field: string, event: string): number {
  const value = data[field];
  if (typeof value !== 'number') {
    throw new Error(`Missing or invalid "${field}" in "${event}" stream event.`);
  }
  return value;
}

function parseStreamMeta(data: JsonObject): StreamMeta {
  if (data.usageSource !== 'provider' && data.usageSource !== 'estimated') {
    throw new Error('Missing or invalid "usageSource" in "meta" stream event.');
  }
  if (data.ttftMs !== null && typeof data.ttftMs !== 'number') {
    throw new Error('Invalid "ttftMs" in "meta" stream event.');
  }
  return {
    provider: requiredString(data, 'provider', 'meta'),
    model: requiredString(data, 'model', 'meta'),
    promptTokens: requiredNumber(data, 'promptTokens', 'meta'),
    completionTokens: requiredNumber(data, 'completionTokens', 'meta'),
    usageSource: data.usageSource,
    queueWaitMs: requiredNumber(data, 'queueWaitMs', 'meta'),
    ttftMs: data.ttftMs,
    generationMs: requiredNumber(data, 'generationMs', 'meta'),
    totalMs: requiredNumber(data, 'totalMs', 'meta'),
    contextUsed: requiredNumber(data, 'contextUsed', 'meta'),
    contextBudget: requiredNumber(data, 'contextBudget', 'meta'),
    droppedMessages: requiredNumber(data, 'droppedMessages', 'meta'),
  };
}
