import { newId } from '#shared/util';

import type { __MODULE_PASCAL__Event } from './__MODULE_KEBAB__.events';
import { __MODULE_PASCAL__Label } from './__MODULE_KEBAB__-label.vo';

export class __MODULE_PASCAL__ {
  private readonly events: __MODULE_PASCAL__Event[] = [];

  private constructor(
    readonly id: string,
    readonly ownerId: string,
    private label: __MODULE_PASCAL__Label,
    readonly createdAt: Date,
    private updatedAtValue: Date,
  ) {}

  static create(input: { ownerId: string; label: string; now?: Date }): __MODULE_PASCAL__ {
    const now = input.now ?? new Date();
    const record = new __MODULE_PASCAL__(newId(), input.ownerId, __MODULE_PASCAL__Label.of(input.label), now, now);

    record.events.push({
      kind: '__MODULE_PASCAL__Created',
      id: record.id,
      ownerId: record.ownerId,
    });

    return record;
  }

  static rehydrate(input: {
    id: string;
    ownerId: string;
    label: string;
    createdAt: Date;
    updatedAt: Date;
  }): __MODULE_PASCAL__ {
    return new __MODULE_PASCAL__(
      input.id,
      input.ownerId,
      __MODULE_PASCAL__Label.of(input.label),
      input.createdAt,
      input.updatedAt,
    );
  }

  get labelValue(): string {
    return this.label.value;
  }

  get updatedAt(): Date {
    return this.updatedAtValue;
  }

  relabel(label: string, now: Date = new Date()): void {
    const next = __MODULE_PASCAL__Label.of(label);

    if (next.equals(this.label)) {
      return;
    }

    const previous = this.label.value;
    this.label = next;
    this.updatedAtValue = now;
    this.events.push({
      kind: '__MODULE_PASCAL__Relabelled',
      id: this.id,
      previous,
      current: next.value,
    });
  }

  pullEvents(): readonly __MODULE_PASCAL__Event[] {
    return this.events.splice(0, this.events.length);
  }
}
