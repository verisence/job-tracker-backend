import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DocumentData, Firestore, Query, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE } from '../config/firebase.constants';
import { AuditService } from '../audit/audit.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import type { ApplicationStatus } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

interface ApplicationRecord {
  uid: string;
  jobTitle: string;
  companyName: string;
  companyLocation: string | null;
  status: ApplicationStatus;
  tags: string[];
  notes: string | null;
  appliedDate: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(FIRESTORE) private readonly firestore: Firestore,
    private readonly auditService: AuditService,
  ) { }

  private collection() {
    return this.firestore.collection('applications');
  }

  async create(uid: string, dto: CreateApplicationDto) {
    const now = Timestamp.now();
    const doc: ApplicationRecord = {
      uid,
      jobTitle: dto.jobTitle,
      companyName: dto.companyName,
      companyLocation: dto.companyLocation ?? null,
      status: dto.status ?? 'applied',
      tags: dto.tags ?? [],
      notes: dto.notes ?? null,
      appliedDate: dto.appliedDate ?? null,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await this.collection().add(doc);
    await this.addTimelineEvent(ref.id, uid, {
      type: 'created',
      message: `Application created for ${dto.jobTitle} at ${dto.companyName}`,
    });

    return { id: ref.id, ...doc };
  }

  async findAll(uid: string, filters: { status?: string; companyName?: string; tags?: string }) {
    let query: Query<DocumentData> = this.collection().where('uid', '==', uid);

    if (filters.status) query = query.where('status', '==', filters.status);
    if (filters.companyName) query = query.where('companyName', '==', filters.companyName);
    if (filters.tags) query = query.where('tags', 'array-contains', filters.tags);

    const snap = await query.orderBy('createdAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as ApplicationRecord) }));
  }

  async findOneOwned(id: string, uid: string) {
    const snap = await this.collection().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Application not found');
    const data = snap.data() as ApplicationRecord;
    if (data.uid !== uid) throw new ForbiddenException();
    return { id: snap.id, ...data };
  }

  async update(id: string, uid: string, dto: UpdateApplicationDto) {
    await this.findOneOwned(id, uid);
    await this.collection().doc(id).update({ ...dto, updatedAt: Timestamp.now() });
    return this.findOneOwned(id, uid);
  }

  async updateStatus(id: string, uid: string, dto: UpdateStatusDto) {
    const existing = await this.findOneOwned(id, uid);
    await this.collection().doc(id).update({ status: dto.status, updatedAt: Timestamp.now() });

    await this.addTimelineEvent(id, uid, {
      type: 'status_change',
      fromStatus: existing.status,
      toStatus: dto.status,
      message: dto.note ?? `Status changed from ${existing.status} to ${dto.status}`,
    });

    await this.auditService.log(uid, 'status_change', 'application', id, {
      fromStatus: existing.status,
      toStatus: dto.status,
    });

    return this.findOneOwned(id, uid);
  }

  async remove(id: string, uid: string) {
    const existing = await this.findOneOwned(id, uid);
    await this.collection().doc(id).delete();

    await this.auditService.log(uid, 'delete', 'application', id, {
      jobTitle: existing.jobTitle,
      companyName: existing.companyName,
    });

    return { deleted: true };
  }

  async getTimeline(id: string, uid: string) {
    await this.findOneOwned(id, uid);
    const snap = await this.collection().doc(id).collection('timeline').orderBy('createdAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  private async addTimelineEvent(appId: string, uid: string, event: Record<string, unknown>) {
    const payload = { ...event, createdAt: Timestamp.now() };
    await this.collection().doc(appId).collection('timeline').add(payload);
    await this.firestore.collection('activity').add({ uid, appId, ...payload });
  }
}