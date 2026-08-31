import type { TxHandle, UnitOfWorkPort } from '#contracts/ports';

import { type JournalOptions, TestJournal } from './journal';

export interface TransactionParticipant {
  snapshot(): () => void;
}

export interface RolledBackTransaction {
  readonly tx: TxHandle;
  readonly error: unknown;
}

export interface InMemoryUnitOfWorkOptions extends JournalOptions {
  readonly participants?: readonly TransactionParticipant[];
}

export class InMemoryUnitOfWork implements UnitOfWorkPort {
  readonly journal: TestJournal;

  readonly handles: TxHandle[] = [];
  readonly commits: TxHandle[] = [];
  readonly rollbacks: RolledBackTransaction[] = [];

  private readonly participants: readonly TransactionParticipant[];
  private open: TxHandle | null = null;

  constructor(options: InMemoryUnitOfWorkOptions = {}) {
    this.journal = options.journal ?? new TestJournal();
    this.participants = options.participants ?? [];
  }

  get activeTx(): TxHandle | null {
    return this.open;
  }

  async transaction<T>(fn: (tx: TxHandle) => Promise<T>): Promise<T> {
    if (this.open !== null) {
      throw new Error(
        'Nested transaction: a second physical transaction would commit independently of the first.',
      );
    }

    const tx: TxHandle = { __brand: 'TxHandle' };
    const undo = this.participants.map((participant) => participant.snapshot());

    this.handles.push(tx);
    this.open = tx;
    this.journal.record('uow', 'begin');

    try {
      const result = await fn(tx);
      this.commits.push(tx);
      this.journal.record('uow', 'commit');

      return result;
    } catch (error) {
      for (const restore of undo.reverse()) {
        restore();
      }
      this.rollbacks.push({ tx, error });
      this.journal.record('uow', 'rollback');
      throw error;
    } finally {
      this.open = null;
    }
  }
}
