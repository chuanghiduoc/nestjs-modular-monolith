import { type DynamicModule, Global, Module } from '@nestjs/common';

import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import { STORAGE_OPTIONS, type StorageOptions } from './storage.options';
import { STORAGE } from './storage.port';

@Global()
@Module({})
export class StorageModule {
  static forRoot(options: StorageOptions): DynamicModule {
    return {
      module: StorageModule,
      providers: [
        { provide: STORAGE_OPTIONS, useValue: options },
        LocalStorageAdapter,
        {
          provide: STORAGE,
          useClass: options.driver === 'local' ? LocalStorageAdapter : S3StorageAdapter,
        },
      ],
      exports: [STORAGE, LocalStorageAdapter],
    };
  }
}
