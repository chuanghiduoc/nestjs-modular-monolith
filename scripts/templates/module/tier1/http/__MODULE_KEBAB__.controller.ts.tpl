import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type AuthenticatedSession, CurrentUser } from '#platform/auth';

import { Create__MODULE_PASCAL__UseCase } from '../application/create-__MODULE_KEBAB__.use-case';
import { Get__MODULE_PASCAL__UseCase } from '../application/get-__MODULE_KEBAB__.use-case';
import { Create__MODULE_PASCAL__RequestDto } from './dto/create-__MODULE_KEBAB__.request.dto';
import { __MODULE_PASCAL__ResponseDto } from './dto/__MODULE_KEBAB__.response.dto';

@ApiTags('__MODULE_KEBAB__')
@Controller('__MODULE_KEBAB__')
export class __MODULE_PASCAL__Controller {
  constructor(
    private readonly create__MODULE_PASCAL__: Create__MODULE_PASCAL__UseCase,
    private readonly get__MODULE_PASCAL__: Get__MODULE_PASCAL__UseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a __MODULE_KEBAB__ record for the caller.' })
  @ApiCreatedResponse({ type: __MODULE_PASCAL__ResponseDto })
  async create(
    @CurrentUser() caller: AuthenticatedSession | undefined,
    @Body() body: Create__MODULE_PASCAL__RequestDto,
  ): Promise<__MODULE_PASCAL__ResponseDto> {
    const session = requireCaller(caller);

    const view = await this.create__MODULE_PASCAL__.execute({
      ownerId: session.userId,
      label: body.label,
    });

    return __MODULE_PASCAL__ResponseDto.from(view);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A __MODULE_KEBAB__ record by id.' })
  @ApiOkResponse({ type: __MODULE_PASCAL__ResponseDto })
  async byId(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<__MODULE_PASCAL__ResponseDto> {
    return __MODULE_PASCAL__ResponseDto.from(await this.get__MODULE_PASCAL__.execute(id));
  }
}

function requireCaller(caller: AuthenticatedSession | undefined): AuthenticatedSession {
  if (caller === undefined) {
    throw new UnauthorizedException();
  }

  return caller;
}
