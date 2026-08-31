import { Inject, Injectable } from '@nestjs/common';

import { create__MODULE_PASCAL__ } from '../domain/__MODULE_KEBAB__';
import {
  __MODULE_SCREAM___REPOSITORY,
  type __MODULE_PASCAL__Repository,
} from '../domain/__MODULE_KEBAB__.repository';
import type { __MODULE_PASCAL__View } from './dto/__MODULE_KEBAB__.dto';
import { to__MODULE_PASCAL__View } from './__MODULE_KEBAB__.mapper';

export interface Create__MODULE_PASCAL__Command {
  readonly ownerId: string;
  readonly label: string;
}

@Injectable()
export class Create__MODULE_PASCAL__UseCase {
  constructor(@Inject(__MODULE_SCREAM___REPOSITORY) private readonly __MODULE_CAMEL__s: __MODULE_PASCAL__Repository) {}

  async execute(command: Create__MODULE_PASCAL__Command): Promise<__MODULE_PASCAL__View> {
    const record = create__MODULE_PASCAL__({
      ownerId: command.ownerId,
      label: command.label,
    });

    await this.__MODULE_CAMEL__s.save(record);

    return to__MODULE_PASCAL__View(record);
  }
}
