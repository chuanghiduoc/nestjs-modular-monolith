import { Module } from '@nestjs/common';

import { Create__MODULE_PASCAL__UseCase } from './application/create-__MODULE_KEBAB__.use-case';
import { Get__MODULE_PASCAL__UseCase } from './application/get-__MODULE_KEBAB__.use-case';
import { __MODULE_SCREAM___REPOSITORY } from './domain/__MODULE_KEBAB__.repository';
import { __MODULE_PASCAL__Controller } from './http/__MODULE_KEBAB__.controller';
import { Prisma__MODULE_PASCAL__Repository } from './infrastructure/prisma-__MODULE_KEBAB__.repository';

@Module({
  controllers: [__MODULE_PASCAL__Controller],
  providers: [
    Create__MODULE_PASCAL__UseCase,
    Get__MODULE_PASCAL__UseCase,
    { provide: __MODULE_SCREAM___REPOSITORY, useClass: Prisma__MODULE_PASCAL__Repository },
  ],
  exports: [Get__MODULE_PASCAL__UseCase],
})
export class __MODULE_PASCAL__Module {}
