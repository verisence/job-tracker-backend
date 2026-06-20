import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import { randomUUID } from 'crypto';
import { FIRESTORE, FIREBASE_BUCKET } from '../config/firebase.constants';
import { ApplicationsService } from '../applications/applications.service';
import { AuditService } from '../audit/audit.service';
import type { StandaloneFileType } from './dto/upload-file.dto';

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

interface FileRecord {
  uid: string;
  appId: string | null;
  type: StandaloneFileType | 'attachment';
  originalName: string;
  storagePath: string;
  contentType: string;
  size: number;
  uploadedAt: Timestamp;
}

@Injectable()
export class FilesService {
  constructor(
    @Inject(FIRESTORE) private readonly firestore: Firestore,
    @Inject(FIREBASE_BUCKET) private readonly bucket: Bucket,
    private readonly applicationsService: ApplicationsService,
    private readonly auditService: AuditService,
  ) {}

  private collection() {
    return this.firestore.collection('files');
  }

  private sanitizeName(name: string) {
    return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  }

  async uploadStandalone(uid: string, type: StandaloneFileType, file: Express.Multer.File) {
    const folder = type === 'cv' ? 'cv' : 'cover-letters';
    const storagePath = `users/${uid}/${folder}/${randomUUID()}-${this.sanitizeName(file.originalname)}`;
    return this.saveFile(uid, null, type, storagePath, file);
  }

  async uploadAttachment(uid: string, appId: string, file: Express.Multer.File) {
    await this.applicationsService.findOneOwned(appId, uid);
    const storagePath = `users/${uid}/applications/${appId}/${randomUUID()}-${this.sanitizeName(file.originalname)}`;
    return this.saveFile(uid, appId, 'attachment', storagePath, file);
  }

  private async saveFile(
    uid: string,
    appId: string | null,
    type: FileRecord['type'],
    storagePath: string,
    file: Express.Multer.File,
  ) {
    await this.bucket.file(storagePath).save(file.buffer, {
      contentType: file.mimetype,
      resumable: false,
    });

    const record: FileRecord = {
      uid,
      appId,
      type,
      originalName: file.originalname,
      storagePath,
      contentType: file.mimetype,
      size: file.size,
      uploadedAt: Timestamp.now(),
    };

    const ref = await this.collection().add(record);

    await this.auditService.log(uid, 'upload', 'file', ref.id, {
      type,
      originalName: file.originalname,
      size: file.size,
      appId,
    });

    const url = await this.signUrl(storagePath);
    return { id: ref.id, ...record, url };
  }

  async listForUser(uid: string, type?: string) {
    let query = this.collection().where('uid', '==', uid).where('appId', '==', null);
    if (type) query = query.where('type', '==', type);
    const snap = await query.orderBy('uploadedAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async listForApplication(appId: string, uid: string) {
    await this.applicationsService.findOneOwned(appId, uid);
    const snap = await this.collection().where('appId', '==', appId).orderBy('uploadedAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async getSignedUrl(id: string, uid: string) {
    const record = await this.findOwned(id, uid);
    return { id, url: await this.signUrl(record.storagePath) };
  }

  async remove(id: string, uid: string) {
    const record = await this.findOwned(id, uid);
    await this.bucket.file(record.storagePath).delete({ ignoreNotFound: true });
    await this.collection().doc(id).delete();

    await this.auditService.log(uid, 'delete', 'file', id, {
      originalName: record.originalName,
      storagePath: record.storagePath,
    });

    return { deleted: true };
  }

  private async findOwned(id: string, uid: string) {
    const snap = await this.collection().doc(id).get();
    if (!snap.exists) throw new NotFoundException('File not found');
    const data = snap.data() as FileRecord;
    if (data.uid !== uid) throw new ForbiddenException();
    return data;
  }

  private async signUrl(storagePath: string) {
    const [url] = await this.bucket.file(storagePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });
    return url;
  }
}