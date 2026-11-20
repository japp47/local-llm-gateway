// The list of every public endpoint. `api/openapi.ts` builds the document from it, and the
// contract tests check that it matches the routes Fastify actually registers.
import type { z } from 'zod';
import * as S from './schemas.js';

export interface ResponseSpec {
  description: string;
  /** JSON body schema. Absent for empty (204) or non-JSON responses. */
  schema?: z.ZodType;
  /** Defaults to application/json when `schema` is set. */
  contentType?: string;
}

export interface Endpoint {
  method: 'get' | 'post' | 'patch' | 'delete';
  /** OpenAPI path template, e.g. /v1/conversations/{id} */
  path: string;
  summary: string;
  description?: string;
  tag: string;
  auth: boolean;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  responses: Record<number, ResponseSpec>;
  deprecated?: boolean;
  /** Streams Server-Sent Events: event name -> schema of its `data`. */
  sse?: Record<string, z.ZodType>;
}

const err = (description: string): ResponseSpec => ({ description, schema: S.ErrorBody });

/** Errors any authenticated endpoint can return. */
const AUTH_ERRORS = {
  401: err('Missing, unknown or revoked API key (`invalid_api_key`)'),
  429: err('Too many requests for this key (`rate_limited`)'),
};
const NOT_FOUND = { 404: err('No such conversation for this key (`conversation_not_found`)') };
const INVALID = { 400: err('Invalid request (`invalid_request`, with `details`)') };
const MODEL_ERRORS = {
  400: err('Invalid request, or a model that is not allowed or not downloaded (`model_not_allowed`, `model_not_installed`, `model_cannot_chat`)'),
  503: err('Ollama is not running, or no chat model is available (`ollama_unavailable`, `no_model_installed`, `no_model_fits`)'),
};

export const ENDPOINTS: Endpoint[] = [
  // ---- public ----
  {
    method: 'get', path: '/healthz', tag: 'health', auth: false,
    summary: 'Is the gateway up, and in which mode',
    responses: { 200: { description: 'Up', schema: S.Health } },
  },
  {
    method: 'get', path: '/readyz', tag: 'health', auth: false,
    summary: 'Can it serve requests (database and Ollama reachable)',
    responses: { 200: { description: 'Ready', schema: S.Readiness }, 503: { description: 'Not ready', schema: S.Readiness } },
  },
  {
    method: 'get', path: '/metrics', tag: 'health', auth: false,
    summary: 'Prometheus metrics',
    responses: { 200: { description: 'Prometheus text format', contentType: 'text/plain' } },
  },
  {
    method: 'get', path: '/openapi.json', tag: 'health', auth: false,
    summary: 'This document',
    responses: { 200: { description: 'OpenAPI 3.1 document', contentType: 'application/json' } },
  },

  // ---- account and models ----
  {
    method: 'get', path: '/v1/me', tag: 'account', auth: true,
    summary: 'The user this API key belongs to',
    responses: { 200: { description: 'The user', schema: S.Me }, ...AUTH_ERRORS },
  },
  {
    method: 'get', path: '/v1/models', tag: 'models', auth: true,
    summary: 'Models this gateway allows',
    description: 'In single-user mode: the chat models Ollama has installed, with the one picked to fit this machine marked as default.',
    responses: { 200: { description: 'Models', schema: S.ModelList }, ...AUTH_ERRORS, 503: MODEL_ERRORS[503] },
  },
  {
    method: 'get', path: '/v1/model', tag: 'models', auth: true,
    summary: 'The default model',
    responses: { 200: { description: 'Default model', schema: S.ModelInfo }, ...AUTH_ERRORS, 503: MODEL_ERRORS[503] },
  },
  {
    method: 'get', path: '/v1/stats', tag: 'account', auth: true,
    summary: "Latency, throughput and token usage from this user's generations",
    query: S.StatsQuery,
    responses: { 200: { description: 'Usage', schema: S.Stats }, ...INVALID, ...AUTH_ERRORS },
  },
  {
    method: 'get', path: '/v1/doctor', tag: 'operations', auth: true,
    summary: "The gateway's own health checks (used by `llm doctor`)",
    responses: { 200: { description: 'Checks', schema: S.DoctorReport }, ...AUTH_ERRORS },
  },
  {
    method: 'post', path: '/v1/backup', tag: 'operations', auth: true,
    summary: 'Write a checked backup of all conversations (single-user mode)',
    description: 'Written into the data folder under `backups/`. The client cannot choose the path.',
    responses: {
      201: { description: 'Backup written', schema: S.BackupSummary },
      ...AUTH_ERRORS,
      409: err('Server mode: use Postgres tools (`backup_failed`, with a pg_dump hint)'),
      500: err('The backup could not be written or verified (`backup_failed`)'),
    },
  },

  // ---- conversations ----
  {
    method: 'post', path: '/v1/conversations', tag: 'conversations', auth: true,
    summary: 'Start a conversation',
    body: S.CreateConversationBody,
    responses: { 201: { description: 'Created', schema: S.Conversation }, ...MODEL_ERRORS, ...AUTH_ERRORS },
  },
  {
    method: 'get', path: '/v1/conversations', tag: 'conversations', auth: true,
    summary: 'List conversations, newest first',
    query: S.ListConversationsQuery,
    responses: { 200: { description: 'One page', schema: S.ConversationPage }, ...INVALID, ...AUTH_ERRORS },
  },
  {
    method: 'get', path: '/v1/conversations/{id}', tag: 'conversations', auth: true,
    summary: 'A conversation with a page of its messages',
    params: S.IdParams, query: S.TranscriptQuery,
    responses: { 200: { description: 'Conversation and messages', schema: S.ConversationWithMessages }, ...INVALID, ...NOT_FOUND, ...AUTH_ERRORS },
  },
  {
    method: 'patch', path: '/v1/conversations/{id}', tag: 'conversations', auth: true,
    summary: 'Rename a conversation',
    params: S.IdParams, body: S.RenameConversationBody,
    responses: { 200: { description: 'Renamed', schema: S.Conversation }, ...INVALID, ...NOT_FOUND, ...AUTH_ERRORS },
  },
  {
    method: 'delete', path: '/v1/conversations/{id}', tag: 'conversations', auth: true,
    summary: 'Delete a conversation and its messages',
    params: S.IdParams,
    responses: { 204: { description: 'Deleted' }, ...INVALID, ...NOT_FOUND, ...AUTH_ERRORS },
  },
  {
    method: 'post', path: '/v1/conversations/{id}/forks', tag: 'conversations', auth: true,
    summary: 'Branch a conversation from one of its messages',
    params: S.IdParams, body: S.ForkBody,
    responses: {
      201: { description: 'The new branch', schema: S.ForkedConversation },
      ...MODEL_ERRORS,
      404: err('No such conversation, or the message is not in it (`conversation_not_found`, `message_not_found`)'),
      ...AUTH_ERRORS,
    },
  },
  {
    method: 'post', path: '/v1/conversations/{id}/messages', tag: 'conversations', auth: true,
    summary: 'Send a message and stream the answer',
    description:
      'Server-Sent Events: `start`, then `delta`*, then `meta`, then `done`; or `error` (then `meta` and `done`) if the answer breaks after it started. ' +
      'Problems found before the answer starts (Ollama not running, model missing, conversation busy, queue full) are plain JSON errors, and nothing is saved.',
    params: S.IdParams, body: S.SendMessageBody,
    sse: S.SSE_EVENTS,
    responses: {
      200: { description: 'The answer, as Server-Sent Events (see `x-sse-events`)', contentType: 'text/event-stream' },
      ...MODEL_ERRORS,
      ...NOT_FOUND,
      409: err('An answer is already being written in this conversation (`conversation_busy`)'),
      413: err('The message does not fit the model\'s context (`context_too_large`)'),
      502: err('Ollama failed before answering (`provider_error`, `model_stopped`)'),
      504: err('Cancelled or timed out while waiting (`cancelled`)'),
      ...AUTH_ERRORS,
      503: err('Ollama not running, model too large for free memory, or the queue is full (`ollama_unavailable`, `model_too_large`, `server_busy` with Retry-After)'),
    },
  },
  {
    method: 'post', path: '/v1/chat/completions', tag: 'legacy', auth: true, deprecated: true,
    summary: 'OpenAI-compatible passthrough to Ollama (stateless)',
    description: 'Kept for older clients. Nothing is saved. Prefer conversations.',
    body: S.LegacyChatBody,
    responses: {
      200: { description: 'Completion, or an event stream when `stream` is true', schema: S.LegacyChatResponse },
      ...INVALID,
      ...AUTH_ERRORS,
      502: err('Ollama failed (`upstream_error`, `upstream_failure`)'),
      503: err('The queue is full (`server_busy`)'),
    },
  },
];
