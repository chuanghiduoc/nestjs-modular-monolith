import { newId } from '#shared/util';

export interface __MODULE_PASCAL__ {
  readonly id: string;
  readonly ownerId: string;
  readonly label: string;
  readonly createdAt: Date;
}

export interface Create__MODULE_PASCAL__Input {
  readonly ownerId: string;
  readonly label: string;
  readonly createdAt?: Date;
  readonly id?: string;
}

export function create__MODULE_PASCAL__(input: Create__MODULE_PASCAL__Input): __MODULE_PASCAL__ {
  return {
    id: input.id ?? newId(),
    ownerId: input.ownerId,
    label: input.label,
    createdAt: input.createdAt ?? new Date(),
  };
}
