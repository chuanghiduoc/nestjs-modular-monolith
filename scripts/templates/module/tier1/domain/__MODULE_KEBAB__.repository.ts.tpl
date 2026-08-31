import type { __MODULE_PASCAL__ } from './__MODULE_KEBAB__';

export interface __MODULE_PASCAL__Repository {
  findById(id: string): Promise<__MODULE_PASCAL__ | null>;
  save(record: __MODULE_PASCAL__): Promise<void>;
}

export const __MODULE_SCREAM___REPOSITORY = Symbol('__MODULE_SCREAM___REPOSITORY');
