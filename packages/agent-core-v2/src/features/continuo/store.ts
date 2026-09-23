import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { Service } from '#/_base/di/service';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';

import { migrateWorkspaceDoc } from './migrate';
import { CONTINUO_SCHEMA_VERSION, CONTINUO_STORE_SCOPE, newWorkspaceDoc, type ContinuoWorkspaceDoc } from './types';

export type DocMutator = (doc: ContinuoWorkspaceDoc) => ContinuoWorkspaceDoc;

export interface IContinuoStore {
  readonly _serviceBrand: undefined;
  load(workspaceId: string): Promise<ContinuoWorkspaceDoc | undefined>;
  peek(workspaceId: string): ContinuoWorkspaceDoc | undefined;
  ensure(workspaceId: string, root: string): Promise<ContinuoWorkspaceDoc>;
  update(workspaceId: string, mutate: DocMutator): Promise<ContinuoWorkspaceDoc>;
  onDidChange(listener: (doc: ContinuoWorkspaceDoc) => void): () => void;
}

export const IContinuoStore: ServiceIdentifier<IContinuoStore> = createDecorator<IContinuoStore>('continuoStore');

export class ContinuoStoreService extends Service implements IContinuoStore {
  declare readonly _serviceBrand: undefined;

  private readonly cache = new Map<string, ContinuoWorkspaceDoc>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<(doc: ContinuoWorkspaceDoc) => void>();

  constructor(@IAtomicDocumentStore private readonly documents: IAtomicDocumentStore) {
    super();
  }

  peek(workspaceId: string): ContinuoWorkspaceDoc | undefined {
    return this.cache.get(workspaceId);
  }

  async load(workspaceId: string): Promise<ContinuoWorkspaceDoc | undefined> {
    const cached = this.cache.get(workspaceId);
    if (cached !== undefined) return cached;
    const stored = await this.documents.get<unknown>(CONTINUO_STORE_SCOPE, workspaceId);
    const doc = migrateWorkspaceDoc(stored);
    if (doc === undefined) return undefined;
    if ((stored as { schemaVersion?: number }).schemaVersion !== CONTINUO_SCHEMA_VERSION) await this.documents.set(CONTINUO_STORE_SCOPE, workspaceId, doc);
    this.cache.set(workspaceId, doc);
    return doc;
  }

  async ensure(workspaceId: string, root: string): Promise<ContinuoWorkspaceDoc> {
    const existing = await this.load(workspaceId);
    if (existing !== undefined) return existing;
    return this.serialize(workspaceId, async () => {
      const again = this.cache.get(workspaceId);
      if (again !== undefined) return again;
      const doc = newWorkspaceDoc(workspaceId, root);
      await this.persist(doc);
      return doc;
    });
  }

  update(workspaceId: string, mutate: DocMutator): Promise<ContinuoWorkspaceDoc> {
    return this.serialize(workspaceId, async () => {
      const current = await this.load(workspaceId);
      if (current === undefined) throw new Error(`continuo workspace ${workspaceId} is not initialized`);
      const next = mutate(current);
      const stamped: ContinuoWorkspaceDoc = {
        ...next,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await this.persist(stamped);
      return stamped;
    });
  }

  onDidChange(listener: (doc: ContinuoWorkspaceDoc) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private async persist(doc: ContinuoWorkspaceDoc): Promise<void> {
    await this.documents.set(CONTINUO_STORE_SCOPE, doc.workspaceId, doc);
    this.cache.set(doc.workspaceId, doc);
    for (const listener of this.listeners) listener(doc);
  }

  private serialize<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(workspaceId) ?? Promise.resolve();
    const run = previous.then(work, work);
    this.queues.set(workspaceId, run.catch(() => undefined));
    return run;
  }
}
