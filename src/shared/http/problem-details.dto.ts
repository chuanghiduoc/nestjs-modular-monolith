import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FieldErrorDto {
  @ApiProperty({ example: 'displayName' })
  path!: string;

  @ApiProperty({ example: 'isLength' })
  code!: string;

  @ApiProperty({ example: 'displayName must be longer than or equal to 2 characters' })
  message!: string;
}

export class ProblemDetailsDto {
  @ApiProperty({ example: '/errors/validation-failed' })
  type!: string;

  @ApiProperty({ example: 'Validation failed' })
  title!: string;

  @ApiProperty({ example: 422 })
  status!: number;

  @ApiProperty({ example: 'validation_failed' })
  code!: string;

  @ApiProperty({ example: 'One or more fields did not pass validation.' })
  detail!: string;

  @ApiProperty({ example: '/api/v1/users/me' })
  instance!: string;

  @ApiProperty({ format: 'uuid', example: '019dd1a5-9235-70db-8d57-54ef901d8185' })
  requestId!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiPropertyOptional({ type: [FieldErrorDto] })
  errors?: FieldErrorDto[];
}
