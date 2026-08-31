export interface __MODULE_PASCAL__Created {
  readonly kind: '__MODULE_PASCAL__Created';
  readonly id: string;
  readonly ownerId: string;
}

export interface __MODULE_PASCAL__Relabelled {
  readonly kind: '__MODULE_PASCAL__Relabelled';
  readonly id: string;
  readonly previous: string;
  readonly current: string;
}

export type __MODULE_PASCAL__Event = __MODULE_PASCAL__Created | __MODULE_PASCAL__Relabelled;
