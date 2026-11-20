// Builds the OpenAPI 3.1 document from `endpoints.ts` and `schemas.ts`. OpenAPI 3.1 uses
// JSON Schema 2020-12, which is what zod 4 emits, so no converter library is needed.
import { z } from 'zod';
import { ENDPOINTS, type Endpoint } from './endpoints.js';
import { components } from './schemas.js';

const REF = (id: string) => `#/components/schemas/${id}`;

type Json = Record<string, unknown>;

/** zod's JSON Schema, minus the per-schema keywords that don't belong inside a document. */
function clean(schema: Json): Json {
  const { $schema: _s, $id: _i, ...rest } = schema;
  return rest;
}

/** A schema as JSON Schema: a $ref when it is a named component, inline otherwise. */
function schemaFor(schema: z.ZodType, io: 'input' | 'output'): Json {
  const meta = components.get(schema);
  if (meta) return { $ref: REF(meta.id) };
  return clean(z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Json);
}

function parameters(where: 'path' | 'query', obj: z.ZodObject | undefined): Json[] {
  if (!obj) return [];
  const json = z.toJSONSchema(obj, { io: 'input', unrepresentable: 'any' }) as { properties?: Json; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, schema]) => {
    const { description, ...rest } = schema as Json;
    return {
      name,
      in: where,
      required: where === 'path' || (json.required ?? []).includes(name),
      ...(description ? { description } : {}),
      schema: rest,
    };
  });
}

function operation(e: Endpoint): Json {
  const responses: Json = {};
  for (const [status, r] of Object.entries(e.responses)) {
    const content =
      r.schema !== undefined
        ? { [r.contentType ?? 'application/json']: { schema: schemaFor(r.schema, 'output') } }
        : r.contentType
          ? { [r.contentType]: {} }
          : undefined;
    responses[status] = { description: r.description, ...(content ? { content } : {}) };
  }
  return {
    operationId: `${e.method}${e.path.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : ''))}`,
    summary: e.summary,
    ...(e.description ? { description: e.description } : {}),
    tags: [e.tag],
    ...(e.deprecated ? { deprecated: true } : {}),
    ...(e.auth ? {} : { security: [] }),
    ...(e.params || e.query ? { parameters: [...parameters('path', e.params), ...parameters('query', e.query)] } : {}),
    ...(e.body ? { requestBody: { required: true, content: { 'application/json': { schema: schemaFor(e.body, 'input') } } } } : {}),
    responses,
    ...(e.sse ? { 'x-sse-events': Object.fromEntries(Object.entries(e.sse).map(([name, s]) => [name, schemaFor(s, 'output')])) } : {}),
  };
}

export function buildOpenApi(version = '1.0.0'): Json {
  const paths: Record<string, Json> = {};
  for (const e of ENDPOINTS) (paths[e.path] ??= {})[e.method] = operation(e);

  const { schemas } = z.toJSONSchema(components, { uri: REF, unrepresentable: 'any' }) as { schemas: Record<string, Json> };
  return {
    openapi: '3.1.0',
    info: {
      title: 'local-llm-gateway',
      version,
      description:
        'A local-first gateway in front of Ollama. Every error is `{ error: { code, message, hint?, request_id } }`: ' +
        '`code` is stable for programs, `message` and `hint` are written for people.',
    },
    servers: [{ url: 'http://localhost:3000' }],
    security: [{ apiKey: [] }],
    tags: [
      { name: 'conversations' },
      { name: 'models' },
      { name: 'account' },
      { name: 'operations' },
      { name: 'health' },
      { name: 'legacy' },
    ],
    paths,
    components: {
      securitySchemes: {
        apiKey: { type: 'http', scheme: 'bearer', description: 'An API key: `Authorization: Bearer llmgw_...`' },
      },
      schemas: Object.fromEntries(Object.entries(schemas).map(([id, s]) => [id, clean(s)])),
    },
  };
}
