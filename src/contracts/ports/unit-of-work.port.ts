export interface TxHandle {
  readonly __brand: 'TxHandle';
}

export interface UnitOfWorkPort {
  transaction<T>(fn: (tx: TxHandle) => Promise<T>): Promise<T>;
}

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
