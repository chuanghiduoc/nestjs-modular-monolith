import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

import { __MODULE_PASCAL__Label } from '../../domain/__MODULE_KEBAB__-label.vo';

export class Create__MODULE_PASCAL__RequestDto {
  @ApiProperty({
    minLength: __MODULE_PASCAL__Label.MIN_LENGTH,
    maxLength: __MODULE_PASCAL__Label.MAX_LENGTH,
  })
  @IsString()
  @Length(__MODULE_PASCAL__Label.MIN_LENGTH, __MODULE_PASCAL__Label.MAX_LENGTH)
  label!: string;
}
