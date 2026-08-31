import { Body, Controller, Get, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { type AuthenticatedSession, CurrentUser } from '#platform/auth';
import { ensureRequestIds, type RequestIdCarrier } from '#platform/observability';
import { requireTenant, TenantRequired } from '#platform/tenant-context';
import { ApiCommonErrors, ApiTenantHeader, collectionUrl } from '#shared/http';
import { isUuidV7 } from '#shared/util';

import { ConfirmUploadUseCase } from '../application/confirm-upload.use-case';
import { ListMyUploadsUseCase } from '../application/list-my-uploads.use-case';
import { PresignUploadUseCase } from '../application/presign-upload.use-case';
import {
  ConfirmUploadRequestDto,
  ListUploadsRequestDto,
  PresignedUploadResponseDto,
  PresignUploadRequestDto,
  StoredFileListResponseDto,
  StoredFileResponseDto,
} from './dto/upload.dto';

const ROUTE = 'upload';

const PRESIGN_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/**
 * Two steps, because a presigned upload is inherently two steps: the client asks
 * for somewhere to put the bytes, puts them there itself, and then tells the
 * server it is done so the server can check what actually arrived.
 */
@ApiTags('upload')
@ApiCommonErrors({ validation: true, conflict: true, notFound: true, payloadTooLarge: true })
@Controller(ROUTE)
@TenantRequired()
@ApiTenantHeader()
export class UploadController {
  constructor(
    private readonly presign: PresignUploadUseCase,
    private readonly confirm: ConfirmUploadUseCase,
    private readonly listMine: ListMyUploadsUseCase,
  ) {}

  @Post('presign')
  @Throttle(PRESIGN_LIMIT)
  @ApiOperation({ summary: 'Issue a scoped, time-limited upload policy.' })
  @ApiCreatedResponse({ type: PresignedUploadResponseDto })
  async createPolicy(
    @CurrentUser() caller: AuthenticatedSession | undefined,
    @Body() body: PresignUploadRequestDto,
  ): Promise<PresignedUploadResponseDto> {
    const view = await this.presign.execute({
      organizationId: requireTenant().organizationId,
      ownerId: requireCaller(caller).userId,
      filename: body.filename,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    });

    return PresignedUploadResponseDto.from(view);
  }

  @Post('confirm')
  @ApiOperation({ summary: 'Verify the stored object and make the file usable.' })
  @ApiOkResponse({ type: StoredFileResponseDto })
  async confirmUpload(
    @CurrentUser() caller: AuthenticatedSession | undefined,
    @Body() body: ConfirmUploadRequestDto,
    @Req() request: RequestIdCarrier,
  ): Promise<StoredFileResponseDto> {
    const correlationId = correlationIdOf(request);

    const view = await this.confirm.execute({
      organizationId: requireTenant().organizationId,
      callerId: requireCaller(caller).userId,
      fileId: body.fileId,
      ...(correlationId === undefined ? {} : { correlationId }),
    });

    return StoredFileResponseDto.from(view);
  }

  @Get()
  @ApiOperation({ summary: "List the caller's own confirmed files, newest first." })
  @ApiOkResponse({ type: StoredFileListResponseDto })
  async list(
    @CurrentUser() caller: AuthenticatedSession | undefined,
    @Query() query: ListUploadsRequestDto,
    @Req() request: { readonly url: string },
  ): Promise<StoredFileListResponseDto> {
    const page = await this.listMine.execute({
      organizationId: requireTenant().organizationId,
      ownerId: requireCaller(caller).userId,
      startingAfter: query.startingAfter,
      limit: query.limit,
    });

    return {
      object: 'list',
      url: collectionUrl(request),
      data: page.files.map((file) => StoredFileResponseDto.from(file)),
      hasMore: page.hasMore,
      lastCursor: page.lastCursor,
    };
  }
}

function requireCaller(caller: AuthenticatedSession | undefined): AuthenticatedSession {
  if (caller === undefined) {
    throw new UnauthorizedException();
  }

  return caller;
}

/**
 * The id that ties the audit entry back to the request that caused it.
 *
 * A caller may send its own `x-correlation-id`, and the accepted alphabet there
 * is wider than a UUID — but the integration event envelope and the audit column
 * are both UUIDv7. Anything else is dropped rather than carried into a publish
 * that would fail contract validation and turn a good upload into a 500.
 */
function correlationIdOf(request: RequestIdCarrier): string | undefined {
  const { correlationId } = ensureRequestIds(request);

  return isUuidV7(correlationId) ? correlationId : undefined;
}
