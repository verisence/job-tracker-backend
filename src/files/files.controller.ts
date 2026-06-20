import {
  Body, Controller, Delete, Get, MaxFileSizeValidator, FileTypeValidator,
  Param, ParseFilePipe, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { FilesService } from './files.service';
import { UploadFileDto } from './dto/upload-file.dto';

const ALLOWED_FILE_TYPES = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const uploadOptions = { storage: memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } };
const fileValidators = () =>
  new ParseFilePipe({
    validators: [
      new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE }),
      new FileTypeValidator({ fileType: ALLOWED_FILE_TYPES }),
    ],
  });

@UseGuards(FirebaseAuthGuard)
@Controller()
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('files')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  uploadStandalone(
    @CurrentUser() user: DecodedIdToken,
    @Body() dto: UploadFileDto,
    @UploadedFile(fileValidators()) file: Express.Multer.File,
  ) {
    return this.filesService.uploadStandalone(user.uid, dto.type, file);
  }

  @Post('applications/:id/files')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  uploadAttachment(
    @CurrentUser() user: DecodedIdToken,
    @Param('id') appId: string,
    @UploadedFile(fileValidators()) file: Express.Multer.File,
  ) {
    return this.filesService.uploadAttachment(user.uid, appId, file);
  }

  @Get('files')
  list(@CurrentUser() user: DecodedIdToken, @Query('type') type?: string) {
    return this.filesService.listForUser(user.uid, type);
  }

  @Get('applications/:id/files')
  listForApplication(@CurrentUser() user: DecodedIdToken, @Param('id') appId: string) {
    return this.filesService.listForApplication(appId, user.uid);
  }

  @Get('files/:id/url')
  getUrl(@CurrentUser() user: DecodedIdToken, @Param('id') id: string) {
    return this.filesService.getSignedUrl(id, user.uid);
  }

  @Delete('files/:id')
  remove(@CurrentUser() user: DecodedIdToken, @Param('id') id: string) {
    return this.filesService.remove(id, user.uid);
  }
}