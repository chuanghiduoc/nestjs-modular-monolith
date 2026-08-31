import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { type AuthenticatedSession, CurrentUser } from '#platform/auth';
import { ApiCommonErrors } from '#shared/http';

import { ChangeOrganizationLifecycleUseCase } from '../application/change-organization-lifecycle.use-case';
import { CreateOrganizationUseCase } from '../application/create-organization.use-case';
import { ListMyOrganizationsUseCase } from '../application/list-my-organizations.use-case';
import type { OrganizationView } from '../application/organization.dto';
import { CreateOrganizationRequestDto } from './dto/create-organization.request.dto';

@ApiTags('organizations')
@ApiCommonErrors({ validation: true, forbidden: true, notFound: true, conflict: true })
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly createOrganization: CreateOrganizationUseCase,
    private readonly listOrganizations: ListMyOrganizationsUseCase,
    private readonly lifecycle: ChangeOrganizationLifecycleUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an organization owned by the caller.' })
  @ApiCreatedResponse({ description: 'The organization and owner membership were created.' })
  create(
    @CurrentUser() caller: AuthenticatedSession | undefined,
    @Body() body: CreateOrganizationRequestDto,
  ): Promise<OrganizationView> {
    return this.createOrganization.execute({ ownerId: requireUser(caller), ...body });
  }

  @Get()
  @ApiOperation({ summary: 'List organizations the caller belongs to.' })
  @ApiOkResponse({ description: 'Organization memberships visible to the caller.' })
  list(
    @CurrentUser() caller: AuthenticatedSession | undefined,
  ): Promise<readonly OrganizationView[]> {
    return this.listOrganizations.execute(requireUser(caller));
  }

  @Post(':organizationId/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete an organization. Only its owner can archive it.' })
  @ApiNoContentResponse({ description: 'The organization was archived.' })
  async archive(
    @CurrentUser() caller: AuthenticatedSession | undefined,
    @Param('organizationId', new ParseUUIDPipe({ version: '7' })) organizationId: string,
  ): Promise<void> {
    await this.lifecycle.archive({ organizationId, actorId: requireUser(caller) });
  }

  @Post(':organizationId/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore an archived organization.' })
  @ApiNoContentResponse({ description: 'The organization was restored.' })
  async restore(
    @CurrentUser() caller: AuthenticatedSession | undefined,
    @Param('organizationId', new ParseUUIDPipe({ version: '7' })) organizationId: string,
  ): Promise<void> {
    await this.lifecycle.restore({ organizationId, actorId: requireUser(caller) });
  }

  @Delete(':organizationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently purge an already archived organization.' })
  @ApiNoContentResponse({ description: 'The organization was permanently purged.' })
  async purge(
    @CurrentUser() caller: AuthenticatedSession | undefined,
    @Param('organizationId', new ParseUUIDPipe({ version: '7' })) organizationId: string,
  ): Promise<void> {
    await this.lifecycle.purge({ organizationId, actorId: requireUser(caller) });
  }
}

function requireUser(caller: AuthenticatedSession | undefined): string {
  if (caller === undefined) throw new UnauthorizedException();

  return caller.userId;
}
