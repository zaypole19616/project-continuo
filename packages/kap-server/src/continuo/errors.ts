export type ContinuoErrorCode = 'workspace_not_found' | 'task_not_found' | 'invalid_state' | 'revision_conflict' | 'entry_not_found';

export class ContinuoError extends Error {
  constructor(readonly code: ContinuoErrorCode, message: string) {
    super(message);
  }
}
