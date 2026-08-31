import { ApiProperty } from '@nestjs/swagger';

import type { __MODULE_PASCAL__View } from '../../application/dto/__MODULE_KEBAB__.dto';

export class __MODULE_PASCAL__ResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  ownerId!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  static from(view: __MODULE_PASCAL__View): __MODULE_PASCAL__ResponseDto {
    const dto = new __MODULE_PASCAL__ResponseDto();
    dto.id = view.id;
    dto.ownerId = view.ownerId;
    dto.label = view.label;
    dto.createdAt = view.createdAt;

    return dto;
  }
}
