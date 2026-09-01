import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class __ACTION_PASCAL__RequestDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  label!: string;
}
