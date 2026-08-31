import { Inject, Injectable } from '@nestjs/common';

import { DomainErrors, ERROR_CODES } from '#shared/errors';

import { __MODULE_SCREAM___REPOSITORY, type __MODULE_PASCAL__Repository } from '../domain/__MODULE_KEBAB__.repository';
import type { __MODULE_PASCAL__View } from './dto/__MODULE_KEBAB__.dto';
import { to__MODULE_PASCAL__View } from './__MODULE_KEBAB__.mapper';

export interface Relabel__MODULE_PASCAL__Command {
  readonly callerId: string;
  readonly id: string;
  readonly label: string;
}

@Injectable()
export class Relabel__MODULE_PASCAL__UseCase {
  constructor(@Inject(__MODULE_SCREAM___REPOSITORY) private readonly __MODULE_CAMEL__s: __MODULE_PASCAL__Repository) {}

  async execute(command: Relabel__MODULE_PASCAL__Command): Promise<__MODULE_PASCAL__View> {
    const record = await this.__MODULE_CAMEL__s.findById(command.id);

    if (record === null) {
      throw DomainErrors.notFound(ERROR_CODES.NOT_FOUND, '__MODULE_PASCAL__ not found.');
    }

    if (record.ownerId !== command.callerId) {
      throw DomainErrors.forbidden(
        ERROR_CODES.FORBIDDEN,
        'A __MODULE_KEBAB__ record may only be changed by its owner.',
      );
    }

    record.relabel(command.label);

    await this.__MODULE_CAMEL__s.save(record);
    record.pullEvents();

    return to__MODULE_PASCAL__View(record);
  }
}
