import { IFlagService, type Scope } from '@moonshot-ai/agent-core-v2';
import { z } from 'zod';

import { ContinuoError, ContinuoTaskManager } from '../continuo/taskManager';
import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { parseActionSuffix } from './action-suffix';
import { ErrorCode } from '../protocol/error-codes';

const workspaceParamSchema = z.object({ workspace_id: z.string().min(1) });
const entryParamSchema = z.object({ workspace_id: z.string().min(1), entry_id: z.string().min(1) });
const openBodySchema = z.object({ client_request_id: z.string().min(1).optional() });
const createTaskBodySchema = z.object({ text: z.string().min(1).max(8000), client_request_id: z.string().min(1).optional() });
const contextPatchBodySchema = z.object({
  text: z.string().min(1).max(600).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  expected_revision: z.number().int().nonnegative(),
});
const docSchema = z.record(z.string(), z.unknown());
const workLogSchema = z.object({ markdown: z.string() });

interface ContinuoRouteHost {
  get(path: string, options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined, handler: (req: { id: string; params: unknown; query?: unknown }, reply: { send(payload: unknown): unknown }) => Promise<void> | void): unknown;
  post(path: string, options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined, handler: (req: { id: string; params: unknown; body: unknown }, reply: { send(payload: unknown): unknown }) => Promise<void> | void): unknown;
}

const CONTINUO_ERRORS = {
  [ErrorCode.VALIDATION_FAILED]: {},
  [ErrorCode.WORKSPACE_NOT_FOUND]: {},
  [ErrorCode.TASK_NOT_FOUND]: {},
};

export function registerContinuoRoutes(app: ContinuoRouteHost, core: Scope): void {
  const manager = new ContinuoTaskManager(core);
  const flagGuard = (requestId: string, reply: { send(payload: unknown): unknown }): boolean => {
    if (core.accessor.get(IFlagService).enabled('continuo')) return true;
    reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, 'Continuo is disabled; start the server with KIMI_CODE_EXPERIMENTAL_CONTINUO=1', requestId));
    return false;
  };
  const sendError = (reply: { send(payload: unknown): unknown }, requestId: string, error: unknown): void => {
    if (error instanceof ContinuoError) {
      const code = error.code === 'workspace_not_found' ? ErrorCode.WORKSPACE_NOT_FOUND : error.code === 'task_not_found' ? ErrorCode.TASK_NOT_FOUND : ErrorCode.VALIDATION_FAILED;
      reply.send(errEnvelope(code, error.message, requestId));
      return;
    }
    reply.send(errEnvelope(ErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error), requestId));
  };

  const openRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo::open',
      params: workspaceParamSchema,
      body: openBodySchema,
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Open a workspace in Continuo: create its state on first open and start the first-open understanding task',
      tags: ['continuo'],
      operationId: 'continuoOpen',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      try {
        reply.send(okEnvelope(await manager.open(req.params.workspace_id, req.body.client_request_id), req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(openRoute.path, openRoute.options, openRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const getRoute = defineRoute(
    {
      method: 'GET',
      path: '/workspaces/{workspace_id}/continuo',
      params: workspaceParamSchema,
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Current Continuo state for a workspace: understanding, context entries, tasks, activity',
      tags: ['continuo'],
      operationId: 'continuoGet',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      const doc = await manager.snapshot(req.params.workspace_id);
      if (doc === undefined) {
        reply.send(errEnvelope(ErrorCode.WORKSPACE_NOT_FOUND, `workspace ${req.params.workspace_id} has not been opened in Continuo`, req.id));
        return;
      }
      reply.send(okEnvelope(doc, req.id));
    },
  );
  app.get(getRoute.path, getRoute.options, getRoute.handler as Parameters<ContinuoRouteHost['get']>[2]);

  const createTaskRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/tasks',
      params: workspaceParamSchema,
      body: createTaskBodySchema,
      success: { data: z.object({ task: docSchema, doc: docSchema }) },
      errors: CONTINUO_ERRORS,
      description: 'Create a user task: a dedicated session bound to the workspace, with the effective context injected',
      tags: ['continuo'],
      operationId: 'continuoCreateTask',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      try {
        const result = await manager.createUserTask(req.params.workspace_id, req.body.text, req.body.client_request_id);
        reply.send(okEnvelope({ task: result.task, doc: result.doc }, req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(createTaskRoute.path, createTaskRoute.options, createTaskRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const taskActionRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/tasks/{tail}',
      params: z.object({ workspace_id: z.string().min(1), tail: z.string().min(1) }),
      body: z.object({ text: z.string().min(1).max(8000).optional() }).optional(),
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Task actions: {task_id}:pause stops a running task (the user pause wins over automatic continuation); {task_id}:resume continues a paused, interrupted, failed or needs_review task in its original session; {task_id}:reply sends the user reply into the task session; {task_id}:complete marks a task that is waiting for the user as done',
      tags: ['continuo'],
      operationId: 'continuoTaskAction',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      const parsed = parseActionSuffix({ tail: req.params.tail, allowedActions: ['pause', 'resume', 'reply', 'complete'] as const, resourceLabel: 'task' });
      if (parsed.kind !== 'action') {
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, parsed.kind === 'invalid' ? parsed.reason : 'expected {task_id}:pause, :resume, :reply or :complete', req.id));
        return;
      }
      const text = req.body?.text;
      if (parsed.action === 'reply' && text === undefined) {
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, 'reply requires text', req.id));
        return;
      }
      try {
        const doc = parsed.action === 'pause'
          ? await manager.pause(req.params.workspace_id, parsed.id)
          : parsed.action === 'resume'
            ? await manager.resume(req.params.workspace_id, parsed.id)
            : parsed.action === 'complete'
              ? await manager.complete(req.params.workspace_id, parsed.id)
              : await manager.reply(req.params.workspace_id, parsed.id, text!);
        reply.send(okEnvelope(doc, req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(taskActionRoute.path, taskActionRoute.options, taskActionRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const contextRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/context/{entry_id}',
      params: entryParamSchema,
      body: contextPatchBodySchema,
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Correct or deactivate a context entry; an edit supersedes the old entry instead of overwriting it',
      tags: ['continuo'],
      operationId: 'continuoPatchContext',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      try {
        const doc = await manager.updateContextEntry(req.params.workspace_id, req.params.entry_id, {
          text: req.body.text,
          status: req.body.status,
          expectedRevision: req.body.expected_revision,
        });
        reply.send(okEnvelope(doc, req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(contextRoute.path, contextRoute.options, contextRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const workLogRoute = defineRoute(
    {
      method: 'GET',
      path: '/workspaces/{workspace_id}/continuo/work-log',
      params: workspaceParamSchema,
      success: { data: workLogSchema },
      errors: CONTINUO_ERRORS,
      description: 'Human-readable work log rendered from the same state the board shows',
      tags: ['continuo'],
      operationId: 'continuoWorkLog',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      try {
        reply.send(okEnvelope({ markdown: await manager.workLog(req.params.workspace_id) }, req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.get(workLogRoute.path, workLogRoute.options, workLogRoute.handler as Parameters<ContinuoRouteHost['get']>[2]);
}
