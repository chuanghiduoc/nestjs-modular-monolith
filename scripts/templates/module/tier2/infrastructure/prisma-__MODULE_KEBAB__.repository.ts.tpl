import { Injectable } from '@nestjs/common';

import type { __MODULE_PASCAL__ } from '../domain/__MODULE_KEBAB__.entity';
import type { __MODULE_PASCAL__Repository } from '../domain/__MODULE_KEBAB__.repository';

@Injectable()
export class Prisma__MODULE_PASCAL__Repository implements __MODULE_PASCAL__Repository {
  findById(_id: string): Promise<__MODULE_PASCAL__ | null> {
    return tableNotDeclared();
  }

  save(_record: __MODULE_PASCAL__): Promise<void> {
    return tableNotDeclared();
  }
}

function tableNotDeclared(): never {
  throw new Error(
    'The __MODULE_KEBAB__ context has no table yet: add prisma/models/__MODULE_KEBAB__.prisma, run `pnpm db:migrate`, then implement Prisma__MODULE_PASCAL__Repository.',
  );
}
