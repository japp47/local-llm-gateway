import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { AppError } from '../lib/errors.js';
import { sseFrame, writeChunk } from '../lib/sse.js';
import type { Conversation } from '../repositories/conversations.js';
import type { Message } from '../repositories/messages.js';

const Params = z.object({ id: z.uuid() });
const CreateBody = z.object({
  title: z.string().min(1).max(200).optional(),
  model: z.string().optional(),
  systemPrompt: z.string().max(8_000).optional(),
});
const RenameBody = z.object({ title: z.string().min(1).max(200) });
const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.date().optional(),
});
const SendBody = z.object({
  content: z.string().min(1).max(16_000),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const toConversation = (c: Conversation) => ({
  id: c.id,
  title: c.title,
  defaultModel: c.defaultModel,
  systemPrompt: c.systemPrompt,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const toMessage = (m: Message) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  status: m.status,
  model: m.model,
  createdAt: m.createdAt,
});

export const conversationRoutes: FastifyPluginAsync<{ deps: Deps }> = async (app, { deps }) => {
  const { config, repos } = deps;
  const userId = (req: { auth: { userId: string } | null }) => req.auth!.userId;

  app.post('/conversations', async (req, reply) => {
    const body = CreateBody.parse(req.body ?? {});
    const model = body.model ?? config.DEFAULT_MODEL;
    if (!config.allowedModels.has(model)) {
      throw new AppError(400, 'model_not_allowed', `model not allowed: ${model}`);
    }
    const conv = await repos.conversations.create({
      userId: userId(req),
      defaultModel: model,
      title: body.title,
      systemPrompt: body.systemPrompt,
    });
    return reply.code(201).send(toConversation(conv));
  });

  app.get('/conversations', async (req) => {
    const q = ListQuery.parse(req.query);
    const rows = await repos.conversations.list(userId(req), q.limit, q.before);
    const last = rows[rows.length - 1];
    return {
      data: rows.map(toConversation),
      nextBefore: rows.length === q.limit && last ? last.updatedAt : null,
    };
  });

  app.get('/conversations/:id', async (req) => {
    const { id } = Params.parse(req.params);
    const conv = await repos.conversations.get(userId(req), id);
    if (!conv) throw new AppError(404, 'conversation_not_found', 'conversation not found');
    const msgs = await repos.messages.listAll(conv.id);
    return { ...toConversation(conv), messages: msgs.map(toMessage) };
  });

  app.patch('/conversations/:id', async (req) => {
    const { id } = Params.parse(req.params);
    const { title } = RenameBody.parse(req.body);
    const conv = await repos.conversations.rename(userId(req), id, title);
    if (!conv) throw new AppError(404, 'conversation_not_found', 'conversation not found');
    return toConversation(conv);
  });

  app.delete('/conversations/:id', async (req, reply) => {
    const { id } = Params.parse(req.params);
    if (!(await repos.conversations.remove(userId(req), id))) {
      throw new AppError(404, 'conversation_not_found', 'conversation not found');
    }
    return reply.code(204).send();
  });

  app.post('/conversations/:id/messages', async (req, reply) => {
    const { id } = Params.parse(req.params);
    const body = SendBody.parse(req.body);

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), config.REQUEST_TIMEOUT_MS);
    const res = reply.raw;
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });

    let began = false;
    try {
      await deps.conversations.sendMessage(
        {
          userId: userId(req),
          conversationId: id,
          content: body.content,
          model: body.model,
          temperature: body.temperature,
          requestId: req.id,
          signal: ac.signal,
          log: req.log,
        },
        {
          begin: async (info) => {
            began = true;
            reply.hijack(); // from here on we own the socket; Fastify error handling no longer applies
            res.writeHead(200, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
              'x-accel-buffering': 'no',
              'x-request-id': req.id,
            });
            await writeChunk(res, sseFrame('start', info));
          },
          event: (e) => writeChunk(res, sseFrame(e.type, e)),
        },
      );
      res.end();
      return reply;
    } catch (err) {
      if (!began) throw err; // still a normal HTTP response: Fastify's error handler renders JSON
      req.log.error({ err }, 'conversation stream failed');
      await writeChunk(
        res,
        sseFrame('error', { type: 'error', code: 'internal_error', message: 'internal error' }),
      );
      res.end();
      return reply;
    } finally {
      clearTimeout(timeout);
    }
  });
};