import { IsIn } from 'class-validator';

export const STANDALONE_FILE_TYPES = ['cv', 'cover_letter'] as const;
export type StandaloneFileType = (typeof STANDALONE_FILE_TYPES)[number];

export class UploadFileDto {
  @IsIn(STANDALONE_FILE_TYPES)
  type!: StandaloneFileType;
}