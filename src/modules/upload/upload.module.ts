import { type DynamicModule, Module } from '@nestjs/common';

import { ConfirmUploadUseCase } from './application/confirm-upload.use-case';
import { CountUserUploadsUseCase } from './application/count-user-uploads.use-case';
import { ExpireStaleUploadsUseCase } from './application/expire-stale-uploads.use-case';
import { ListMyUploadsUseCase } from './application/list-my-uploads.use-case';
import { PresignUploadUseCase } from './application/presign-upload.use-case';
import { PurgeUserFilesUseCase } from './application/purge-user-files.use-case';
import {
  DEFAULT_PENDING_TTL_MINUTES,
  DEFAULT_PRESIGN_EXPIRY_SECONDS,
  UPLOAD_LIMITS,
  type UploadLimits,
} from './application/upload.limits';
import { FILE_STORAGE } from './domain/file-storage.port';
import { STORED_FILE_REPOSITORY } from './domain/stored-file.repository';
import { UploadController } from './http/upload.controller';
import { PurgeFilesOnUserDeletedListener } from './infrastructure/listeners/purge-files-on-user-deleted.listener';
import { SweepUnconfirmedUploadsListener } from './infrastructure/listeners/sweep-unconfirmed-uploads.listener';
import { PrismaStoredFileRepository } from './infrastructure/prisma-stored-file.repository';
import { S3FileStorageAdapter } from './infrastructure/s3-file-storage.adapter';

export interface UploadModuleInput {
  readonly maxFileBytes: number;
  readonly exposeHttp?: boolean;
  readonly presignExpirySeconds?: number;
  readonly pendingTtlMinutes?: number;
}

@Module({})
export class UploadModule {
  static forRoot(input: UploadModuleInput): DynamicModule {
    const limits: UploadLimits = {
      maxFileBytes: input.maxFileBytes,
      presignExpirySeconds: input.presignExpirySeconds ?? DEFAULT_PRESIGN_EXPIRY_SECONDS,
      pendingTtlMinutes: input.pendingTtlMinutes ?? DEFAULT_PENDING_TTL_MINUTES,
    };

    return {
      module: UploadModule,

      controllers: input.exposeHttp === false ? [] : [UploadController],
      providers: [
        { provide: UPLOAD_LIMITS, useValue: limits },
        PresignUploadUseCase,
        ConfirmUploadUseCase,
        ListMyUploadsUseCase,
        CountUserUploadsUseCase,
        PurgeUserFilesUseCase,
        ExpireStaleUploadsUseCase,
        PurgeFilesOnUserDeletedListener,
        SweepUnconfirmedUploadsListener,
        { provide: STORED_FILE_REPOSITORY, useClass: PrismaStoredFileRepository },
        { provide: FILE_STORAGE, useClass: S3FileStorageAdapter },
      ],
      exports: [ListMyUploadsUseCase, CountUserUploadsUseCase],
    };
  }
}
