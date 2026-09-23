import { IFlagService, type Scope } from '@moonshot-ai/agent-core-v2';
import { z } from 'zod';

import { ContinuoError, ContinuoTaskManager } from '../continuo/taskManager';
import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { parseActionSuffix } from './action-suffix';
import { chooseFolder } from '../continuo/chooseFolder';
import { listFiles, readTextFile } from '../continuo/files';
import { ErrorCode } from '../protocol/error-codes';

const workspaceParamSchema = z.object({ workspace_id: z.string().min(1) });
const openBodySchema = z.object({ client_request_id: z.string().min(1).optional() });
const createTaskBodySchema = z.object({ text: z.string().min(1).max(8000), client_request_id: z.string().min(1).optional() });
const docSchema = z.record(z.string(), z.unknown());
const todoTimingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('daily'), time: z.string().min(3).max(5) }),
  z.object({ kind: z.literal('weekly'), day: z.number().int().min(0).max(6), time: z.string().min(3).max(5) }),
]);
const TODO_TICK_MS = 30_000;

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
  const todoTimer = setInterval(() => {
    if (core.accessor.get(IFlagService).enabled('continuo')) void manager.runDueTodos().catch(() => undefined);
  }, TODO_TICK_MS);
  todoTimer.unref();
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

  const chooseFolderRoute = defineRoute(
    {
      method: 'POST',
      path: '/continuo/choose-folder',
      body: z.object({ prompt: z.string().min(1).max(120).optional(), default_path: z.string().min(1).max(4096).optional() }).optional(),
      success: { data: z.object({ path: z.string().nullable() }) },
      errors: CONTINUO_ERRORS,
      description: "Open the operating system's own folder chooser on the machine running the server (macOS) and return the chosen folder, or null when the user cancels",
      tags: ['continuo'],
      operationId: 'continuoChooseFolder',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      try {
        const path = await chooseFolder(req.body?.prompt ?? '选择文件夹', req.body?.default_path);
        reply.send(okEnvelope({ path: path ?? null }, req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(chooseFolderRoute.path, chooseFolderRoute.options, chooseFolderRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

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

  const retryInitRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/init::retry',
      params: workspaceParamSchema,
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Read the folder again after a first read that failed or was stopped; opening a project only reads it the first time',
      tags: ['continuo'],
      operationId: 'continuoRetryInit',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      try {
        reply.send(okEnvelope(await manager.retryInit(req.params.workspace_id), req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(retryInitRoute.path, retryInitRoute.options, retryInitRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

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
        reply.send(errEnvelope(ErrorCode.WORKSPACE_NOT_FOUND, '这个项目还没有打开过。', req.id));
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
      description: 'Task actions: {task_id}:pause stops a running task (the user pause wins over automatic continuation); {task_id}:resume continues a paused, interrupted, failed or needs_review task in its original session; {task_id}:reply sends the user reply into the task session; {task_id}:fork copies the current line up to the end of that task into a new line and makes it current',
      tags: ['continuo'],
      operationId: 'continuoTaskAction',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      const parsed = parseActionSuffix({ tail: req.params.tail, allowedActions: ['pause', 'resume', 'reply', 'fork'] as const, resourceLabel: 'task' });
      if (parsed.kind !== 'action') {
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, parsed.kind === 'invalid' ? parsed.reason : 'expected {task_id}:pause, :resume, :reply or :fork', req.id));
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
            : parsed.action === 'fork'
              ? await manager.forkAfterTask(req.params.workspace_id, parsed.id)
              : await manager.reply(req.params.workspace_id, parsed.id, text!);
        reply.send(okEnvelope(doc, req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(taskActionRoute.path, taskActionRoute.options, taskActionRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const decisionActionRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/decisions/{tail}',
      params: z.object({ workspace_id: z.string().min(1), tail: z.string().min(1) }),
      body: z.object({ plan_id: z.string().min(1).max(8).optional(), reason: z.string().max(300).optional() }).optional(),
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Decision point actions: {decision_id}:choose follows a plan (in place while the decision is still open on the current line, otherwise on a new line forked at the decision); {decision_id}:expand asks for more plans while it is still open; {decision_id}:abandon marks a plan abandoned with an optional reason',
      tags: ['continuo'],
      operationId: 'continuoDecisionAction',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      const parsed = parseActionSuffix({ tail: req.params.tail, allowedActions: ['choose', 'expand', 'abandon'] as const, resourceLabel: 'decision' });
      if (parsed.kind !== 'action') {
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, parsed.kind === 'invalid' ? parsed.reason : 'expected {decision_id}:choose, :expand or :abandon', req.id));
        return;
      }
      const planId = req.body?.plan_id;
      if (parsed.action !== 'expand' && planId === undefined) {
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, `${parsed.action} requires plan_id`, req.id));
        return;
      }
      try {
        const doc = parsed.action === 'choose'
          ? await manager.choosePlan(req.params.workspace_id, parsed.id, planId!)
          : parsed.action === 'expand'
            ? await manager.expandPlans(req.params.workspace_id, parsed.id)
            : await manager.abandonPlan(req.params.workspace_id, parsed.id, planId!, req.body?.reason);
        reply.send(okEnvelope(doc, req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(decisionActionRoute.path, decisionActionRoute.options, decisionActionRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const permissionRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/permission',
      params: workspaceParamSchema,
      body: z.object({ mode: z.enum(['manual', 'yolo', 'auto']) }),
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: "Set the project's permission mode, one of Kimi Code's three: manual asks before anything but reads, yolo asks only for risky actions, questions and plans, auto never stops; it applies to the current line now and to every task after",
      tags: ['continuo'],
      operationId: 'continuoSetPermission',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      try {
        reply.send(okEnvelope(await manager.setPermissionMode(req.params.workspace_id, req.body.mode), req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(permissionRoute.path, permissionRoute.options, permissionRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const addTodoRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/todos',
      params: workspaceParamSchema,
      body: z.object({ text: z.string().min(1).max(8000), timing: todoTimingSchema.optional() }),
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Add a backlog item, optionally on a schedule (once at a time, daily or weekly); scheduled items start as tasks on the current line when due',
      tags: ['continuo'],
      operationId: 'continuoAddTodo',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      try {
        reply.send(okEnvelope(await manager.addTodo(req.params.workspace_id, req.body.text, req.body.timing), req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(addTodoRoute.path, addTodoRoute.options, addTodoRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const todoActionRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/todos/{tail}',
      params: z.object({ workspace_id: z.string().min(1), tail: z.string().min(1) }),
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Backlog item actions: {todo_id}:start starts it now as a task on the current line (a recurring item keeps its schedule); {todo_id}:accept keeps a suggested item in the backlog for later; {todo_id}:dismiss crosses a suggested item out; {todo_id}:delete removes it',
      tags: ['continuo'],
      operationId: 'continuoTodoAction',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      const parsed = parseActionSuffix({ tail: req.params.tail, allowedActions: ['start', 'accept', 'dismiss', 'delete'] as const, resourceLabel: 'todo' });
      if (parsed.kind !== 'action') {
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, parsed.kind === 'invalid' ? parsed.reason : 'expected {todo_id}:start, :accept, :dismiss or :delete', req.id));
        return;
      }
      try {
        const doc = parsed.action === 'start'
          ? await manager.startTodo(req.params.workspace_id, parsed.id)
          : parsed.action === 'accept'
            ? await manager.acceptTodo(req.params.workspace_id, parsed.id)
            : parsed.action === 'dismiss'
              ? await manager.dismissTodo(req.params.workspace_id, parsed.id)
              : await manager.removeTodo(req.params.workspace_id, parsed.id);
        reply.send(okEnvelope(doc, req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(todoActionRoute.path, todoActionRoute.options, todoActionRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const trajectoryActionRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/trajectories/{tail}',
      params: z.object({ workspace_id: z.string().min(1), tail: z.string().min(1) }),
      body: z.object({}).optional(),
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Line actions: {trajectory_id}:activate makes an existing line current again; nothing on either line is changed',
      tags: ['continuo'],
      operationId: 'continuoTrajectoryAction',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      const parsed = parseActionSuffix({ tail: req.params.tail, allowedActions: ['activate'] as const, resourceLabel: 'trajectory' });
      if (parsed.kind !== 'action') {
        reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, parsed.kind === 'invalid' ? parsed.reason : 'expected {trajectory_id}:activate', req.id));
        return;
      }
      try {
        reply.send(okEnvelope(await manager.activateTrajectory(req.params.workspace_id, parsed.id), req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.post(trajectoryActionRoute.path, trajectoryActionRoute.options, trajectoryActionRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const filesRoute = defineRoute(
    {
      method: 'GET',
      path: '/workspaces/{workspace_id}/continuo/files',
      params: workspaceParamSchema,
      querystring: z.object({ path: z.string().max(4096).optional() }),
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'List one folder of the workspace with size, modification time, guide-file and produced-by-task markers',
      tags: ['continuo'],
      operationId: 'continuoListFiles',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      try {
        const doc = await manager.snapshot(req.params.workspace_id);
        if (doc === undefined) throw new ContinuoError('workspace_not_found', '这个项目还没有打开过。');
        reply.send(okEnvelope(await listFiles(doc, req.query.path ?? ''), req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.get(filesRoute.path, filesRoute.options, filesRoute.handler as Parameters<ContinuoRouteHost['get']>[2]);

  const fileRoute = defineRoute(
    {
      method: 'GET',
      path: '/workspaces/{workspace_id}/continuo/file',
      params: workspaceParamSchema,
      querystring: z.object({ path: z.string().min(1).max(4096) }),
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Read one text file of the workspace (bounded); binary files return only metadata',
      tags: ['continuo'],
      operationId: 'continuoReadFile',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      try {
        const doc = await manager.snapshot(req.params.workspace_id);
        if (doc === undefined) throw new ContinuoError('workspace_not_found', '这个项目还没有打开过。');
        reply.send(okEnvelope(await readTextFile(doc, req.query.path), req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.get(fileRoute.path, fileRoute.options, fileRoute.handler as Parameters<ContinuoRouteHost['get']>[2]);

  const exportRoute = defineRoute(
    {
      method: 'GET',
      path: '/workspaces/{workspace_id}/continuo/export',
      params: workspaceParamSchema,
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Export every line of the workspace as a trajectory sample, plus plan preference pairs from choices, switches and abandonments',
      tags: ['continuo'],
      operationId: 'continuoExport',
    },
    async (req, reply) => {
      if (!flagGuard(req.id, reply)) return;
      try {
        reply.send(okEnvelope(await manager.exportTrajectories(req.params.workspace_id), req.id));
      } catch (error) {
        sendError(reply, req.id, error);
      }
    },
  );
  app.get(exportRoute.path, exportRoute.options, exportRoute.handler as Parameters<ContinuoRouteHost['get']>[2]);

}
