import { IFlagService, type ContinuoWorkspaceDoc, type Scope } from '@moonshot-ai/agent-core-v2';
import { z } from 'zod';

import { chooseFolder } from '../continuo/chooseFolder';
import { ContinuoError, type ContinuoErrorCode } from '../continuo/errors';
import { listFiles, readTextFile } from '../continuo/files';
import { ContinuoTaskManager } from '../continuo/taskManager';
import { TodoRunner } from '../continuo/todos';
import { errEnvelope, okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import { ErrorCode } from '../protocol/error-codes';
import { type ActionTable, dispatchAction } from './action-dispatch';

const workspaceParamSchema = z.object({ workspace_id: z.string().min(1) });
const tailParamSchema = z.object({ workspace_id: z.string().min(1), tail: z.string().min(1) });
const openBodySchema = z.object({ client_request_id: z.string().min(1).optional() });
const createTaskBodySchema = z.object({ text: z.string().min(1).max(8000), client_request_id: z.string().min(1).optional() });
const replyBodySchema = z.object({ text: z.string().min(1).max(8000) });
const planBodySchema = z.object({ plan_id: z.string().min(1).max(8) });
const abandonBodySchema = z.object({ plan_id: z.string().min(1).max(8), reason: z.string().max(300).optional() });
const docSchema = z.record(z.string(), z.unknown());
const todoTimingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.string().min(1).max(64) }),
  z.object({ kind: z.literal('daily'), time: z.string().min(3).max(5) }),
  z.object({ kind: z.literal('weekly'), day: z.number().int().min(0).max(6), time: z.string().min(3).max(5) }),
]);

interface Reply {
  send(payload: unknown): unknown;
}

interface ContinuoRouteHost {
  get(path: string, options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined, handler: (req: { id: string; params: unknown; query?: unknown }, reply: Reply) => Promise<void> | void): unknown;
  post(path: string, options: { preHandler: unknown[]; schema?: Record<string, unknown> } | undefined, handler: (req: { id: string; params: unknown; body: unknown }, reply: Reply) => Promise<void> | void): unknown;
  addHook(name: 'onClose', hook: () => void): unknown;
}

interface ActionExtra {
  readonly manager: ContinuoTaskManager;
  readonly workspaceId: string;
  readonly respond: (doc: ContinuoWorkspaceDoc) => void;
}

type ActionCtx<TBody = unknown> = ActionExtra & { readonly id: string; readonly body: TBody };

interface ActionRequest {
  readonly id: string;
  readonly params: { readonly workspace_id: string; readonly tail: string };
  readonly body?: unknown;
}

const CONTINUO_ERRORS = {
  [ErrorCode.VALIDATION_FAILED]: {},
  [ErrorCode.WORKSPACE_NOT_FOUND]: {},
  [ErrorCode.TASK_NOT_FOUND]: {},
};

const FILE_ERRORS = { ...CONTINUO_ERRORS, [ErrorCode.FS_PATH_NOT_FOUND]: {} };

const ERROR_CODES: Record<ContinuoErrorCode, ErrorCode> = {
  workspace_not_found: ErrorCode.WORKSPACE_NOT_FOUND,
  task_not_found: ErrorCode.TASK_NOT_FOUND,
  invalid_state: ErrorCode.VALIDATION_FAILED,
  entry_not_found: ErrorCode.FS_PATH_NOT_FOUND,
};

const DISABLED = 'Continuo is disabled; start the server with KIMI_CODE_EXPERIMENTAL_CONTINUO=1';

function errorEnvelope(error: unknown, requestId: string) {
  if (error instanceof ContinuoError) return errEnvelope(ERROR_CODES[error.code], error.message, requestId);
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return errEnvelope(ErrorCode.VALIDATION_FAILED, issue === undefined ? 'validation failed' : `${issue.path.join('.')}: ${issue.message}`, requestId);
  }
  return errEnvelope(ErrorCode.INTERNAL_ERROR, error instanceof Error ? error.message : String(error), requestId);
}

const taskActions: ActionTable<'pause' | 'resume' | 'reply' | 'steer' | 'complete' | 'fork', ActionExtra> = {
  pause: { handle: async ({ manager, workspaceId, id, respond }) => { respond(await manager.pause(workspaceId, id)); } },
  resume: { handle: async ({ manager, workspaceId, id, respond }) => { respond(await manager.resume(workspaceId, id)); } },
  reply: { body: replyBodySchema, handle: async ({ manager, workspaceId, id, body, respond }: ActionCtx<z.infer<typeof replyBodySchema>>) => { respond(await manager.reply(workspaceId, id, body.text)); } },
  steer: { body: replyBodySchema, handle: async ({ manager, workspaceId, id, body, respond }: ActionCtx<z.infer<typeof replyBodySchema>>) => { respond(await manager.steer(workspaceId, id, body.text)); } },
  complete: { handle: async ({ manager, workspaceId, id, respond }) => { respond(await manager.complete(workspaceId, id)); } },
  fork: { handle: async ({ manager, workspaceId, id, respond }) => { respond(await manager.decisions.forkAfterTask(workspaceId, id)); } },
};

const decisionActions: ActionTable<'choose' | 'expand' | 'abandon', ActionExtra> = {
  choose: { body: planBodySchema, handle: async ({ manager, workspaceId, id, body, respond }: ActionCtx<z.infer<typeof planBodySchema>>) => { respond(await manager.decisions.choosePlan(workspaceId, id, body.plan_id)); } },
  expand: { handle: async ({ manager, workspaceId, id, respond }) => { respond(await manager.decisions.expandPlans(workspaceId, id)); } },
  abandon: { body: abandonBodySchema, handle: async ({ manager, workspaceId, id, body, respond }: ActionCtx<z.infer<typeof abandonBodySchema>>) => { respond(await manager.decisions.abandonPlan(workspaceId, id, body.plan_id, body.reason)); } },
};

const todoActions: ActionTable<'start' | 'accept' | 'dismiss' | 'delete', ActionExtra> = {
  start: { handle: async ({ manager, workspaceId, id, respond }) => { respond(await manager.startTodo(workspaceId, id)); } },
  accept: { handle: async ({ manager, workspaceId, id, respond }) => { respond(await manager.acceptTodo(workspaceId, id)); } },
  dismiss: { handle: async ({ manager, workspaceId, id, respond }) => { respond(await manager.dismissTodo(workspaceId, id)); } },
  delete: { handle: async ({ manager, workspaceId, id, respond }) => { respond(await manager.removeTodo(workspaceId, id)); } },
};

const trajectoryActions: ActionTable<'activate', ActionExtra> = {
  activate: { handle: async ({ manager, workspaceId, id, respond }) => { respond(await manager.decisions.activateTrajectory(workspaceId, id)); } },
};

export function registerContinuoRoutes(app: ContinuoRouteHost, core: Scope): void {
  const manager = new ContinuoTaskManager(core);
  const enabled = (): boolean => core.accessor.get(IFlagService).enabled('continuo');
  const todos = new TodoRunner(() => (enabled() ? manager.runDueTodos() : Promise.resolve()));
  todos.start();
  app.addHook('onClose', () => { todos.dispose(); });

  const guarded = async (req: { id: string }, reply: Reply, work: () => Promise<unknown>): Promise<void> => {
    if (!enabled()) {
      reply.send(errEnvelope(ErrorCode.VALIDATION_FAILED, DISABLED, req.id));
      return;
    }
    try {
      await work();
    } catch (error) {
      reply.send(errorEnvelope(error, req.id));
    }
  };
  const respond = (req: { id: string }, reply: Reply, work: () => Promise<unknown>): Promise<void> => guarded(req, reply, async () => { reply.send(okEnvelope(await work(), req.id)); });
  const dispatch = <TAction extends string>(req: ActionRequest, reply: Reply, actions: ActionTable<TAction, ActionExtra>, resourceLabel: string): Promise<void> => guarded(req, reply, () => dispatchAction({
    tail: req.params.tail,
    actions,
    resourceLabel,
    extra: { manager, workspaceId: req.params.workspace_id, respond: (doc) => { reply.send(okEnvelope(doc, req.id)); } },
    body: req.body,
    onUnsupported: (message) => { throw new ContinuoError('invalid_state', message); },
  }));
  const opened = async (workspaceId: string): Promise<ContinuoWorkspaceDoc> => {
    const doc = await manager.snapshot(workspaceId);
    if (doc === undefined) throw new ContinuoError('workspace_not_found', '这个项目还没有打开过。');
    return doc;
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
    (req, reply) => respond(req, reply, async () => ({ path: (await chooseFolder(req.body?.prompt ?? '选择文件夹', req.body?.default_path)) ?? null })),
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
    (req, reply) => respond(req, reply, () => manager.open(req.params.workspace_id, req.body.client_request_id)),
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
    (req, reply) => respond(req, reply, () => manager.retryInit(req.params.workspace_id)),
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
    (req, reply) => respond(req, reply, () => opened(req.params.workspace_id)),
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
    (req, reply) => respond(req, reply, () => manager.createUserTask(req.params.workspace_id, req.body.text, req.body.client_request_id)),
  );
  app.post(createTaskRoute.path, createTaskRoute.options, createTaskRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const taskActionRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/tasks/{tail}',
      params: tailParamSchema,
      body: z.object({ text: z.string().min(1).max(8000).optional() }).optional(),
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Task actions: {task_id}:pause stops a running task (the user pause wins over automatic continuation); {task_id}:resume continues a paused, interrupted, failed or needs_review task in its original session; {task_id}:reply sends the user reply into the task session; {task_id}:steer adds a user supplement to the turn that is running; {task_id}:complete closes a task that is waiting for a reply; {task_id}:fork copies the current line up to the end of that task into a new line and makes it current',
      tags: ['continuo'],
      operationId: 'continuoTaskAction',
    },
    (req, reply) => dispatch(req, reply, taskActions, 'task'),
  );
  app.post(taskActionRoute.path, taskActionRoute.options, taskActionRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const decisionActionRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/decisions/{tail}',
      params: tailParamSchema,
      body: z.object({ plan_id: z.string().min(1).max(8).optional(), reason: z.string().max(300).optional() }).optional(),
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Decision point actions: {decision_id}:choose follows a plan (in place while the decision is still open on the current line, otherwise on a new line forked at the decision); {decision_id}:expand asks for more plans while it is still open; {decision_id}:abandon marks a plan abandoned with an optional reason',
      tags: ['continuo'],
      operationId: 'continuoDecisionAction',
    },
    (req, reply) => dispatch(req, reply, decisionActions, 'decision'),
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
    (req, reply) => respond(req, reply, () => manager.setPermissionMode(req.params.workspace_id, req.body.mode)),
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
    (req, reply) => respond(req, reply, () => manager.addTodo(req.params.workspace_id, req.body.text, req.body.timing)),
  );
  app.post(addTodoRoute.path, addTodoRoute.options, addTodoRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const todoActionRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/todos/{tail}',
      params: tailParamSchema,
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Backlog item actions: {todo_id}:start starts it now as a task on the current line (a recurring item keeps its schedule); {todo_id}:accept keeps a suggested item in the backlog for later; {todo_id}:dismiss crosses a suggested item out; {todo_id}:delete removes it',
      tags: ['continuo'],
      operationId: 'continuoTodoAction',
    },
    (req, reply) => dispatch(req, reply, todoActions, 'todo'),
  );
  app.post(todoActionRoute.path, todoActionRoute.options, todoActionRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const trajectoryActionRoute = defineRoute(
    {
      method: 'POST',
      path: '/workspaces/{workspace_id}/continuo/trajectories/{tail}',
      params: tailParamSchema,
      body: z.object({}).optional(),
      success: { data: docSchema },
      errors: CONTINUO_ERRORS,
      description: 'Line actions: {trajectory_id}:activate makes an existing line current again; nothing on either line is changed',
      tags: ['continuo'],
      operationId: 'continuoTrajectoryAction',
    },
    (req, reply) => dispatch(req, reply, trajectoryActions, 'trajectory'),
  );
  app.post(trajectoryActionRoute.path, trajectoryActionRoute.options, trajectoryActionRoute.handler as Parameters<ContinuoRouteHost['post']>[2]);

  const filesRoute = defineRoute(
    {
      method: 'GET',
      path: '/workspaces/{workspace_id}/continuo/files',
      params: workspaceParamSchema,
      querystring: z.object({ path: z.string().max(4096).optional() }),
      success: { data: docSchema },
      errors: FILE_ERRORS,
      description: 'List one folder of the workspace with size, modification time, guide-file and produced-by-task markers',
      tags: ['continuo'],
      operationId: 'continuoListFiles',
    },
    (req, reply) => respond(req, reply, async () => listFiles(await opened(req.params.workspace_id), req.query.path ?? '')),
  );
  app.get(filesRoute.path, filesRoute.options, filesRoute.handler as Parameters<ContinuoRouteHost['get']>[2]);

  const fileRoute = defineRoute(
    {
      method: 'GET',
      path: '/workspaces/{workspace_id}/continuo/file',
      params: workspaceParamSchema,
      querystring: z.object({ path: z.string().min(1).max(4096) }),
      success: { data: docSchema },
      errors: FILE_ERRORS,
      description: 'Read one text file of the workspace (bounded); binary files return only metadata',
      tags: ['continuo'],
      operationId: 'continuoReadFile',
    },
    (req, reply) => respond(req, reply, async () => readTextFile(await opened(req.params.workspace_id), req.query.path)),
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
    (req, reply) => respond(req, reply, () => manager.exportTrajectories(req.params.workspace_id)),
  );
  app.get(exportRoute.path, exportRoute.options, exportRoute.handler as Parameters<ContinuoRouteHost['get']>[2]);
}
