import type { __MODULE_PASCAL__ } from '../domain/__MODULE_KEBAB__.entity';
import type { __MODULE_PASCAL__View } from './dto/__MODULE_KEBAB__.dto';

export function to__MODULE_PASCAL__View(record: __MODULE_PASCAL__): __MODULE_PASCAL__View {
  return {
    id: record.id,
    ownerId: record.ownerId,
    label: record.labelValue,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
