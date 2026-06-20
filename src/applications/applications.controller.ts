import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@UseGuards(FirebaseAuthGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  create(@CurrentUser() user: DecodedIdToken, @Body() dto: CreateApplicationDto) {
    return this.applicationsService.create(user.uid, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: DecodedIdToken,
    @Query('status') status?: string,
    @Query('companyName') companyName?: string,
  ) {
    return this.applicationsService.findAll(user.uid, { status, companyName });
  }

  @Get(':id')
  findOne(@CurrentUser() user: DecodedIdToken, @Param('id') id: string) {
    return this.applicationsService.findOneOwned(id, user.uid);
  }

  @Patch(':id')
  update(@CurrentUser() user: DecodedIdToken, @Param('id') id: string, @Body() dto: UpdateApplicationDto) {
    return this.applicationsService.update(id, user.uid, dto);
  }

  @Patch(':id/status')
  updateStatus(@CurrentUser() user: DecodedIdToken, @Param('id') id: string, @Body() dto: UpdateStatusDto) {
    return this.applicationsService.updateStatus(id, user.uid, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: DecodedIdToken, @Param('id') id: string) {
    return this.applicationsService.remove(id, user.uid);
  }

  @Get(':id/timeline')
  getTimeline(@CurrentUser() user: DecodedIdToken, @Param('id') id: string) {
    return this.applicationsService.getTimeline(id, user.uid);
  }
}