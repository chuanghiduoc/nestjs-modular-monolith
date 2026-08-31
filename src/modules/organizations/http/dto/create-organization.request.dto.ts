import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateOrganizationRequestDto {
  @ApiProperty({ example: 'acme' })
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @ApiProperty({ example: 'Acme Inc.' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;
}
