import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { APPLICATION_STATUSES } from './create-application.dto';
import type { ApplicationStatus } from './create-application.dto';

export class UpdateStatusDto {
  @IsIn(APPLICATION_STATUSES)
  status!: ApplicationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}