import { Inject, Injectable, Logger } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE } from '../config/firebase.constants';

export type AuditAction = 'status_change' | 'upload' | 'delete';
export type AuditEntityType = 'application' | 'file';

@Injectable()
export class AuditService {
    private readonly logger = new Logger(AuditService.name);

    constructor(@Inject(FIRESTORE) private readonly firestore: Firestore) { }

    async log(
        uid: string,
        action: AuditAction,
        entityType: AuditEntityType,
        entityId: string,
        metadata: Record<string, unknown> = {},
    ) {
        try {
            await this.firestore.collection('auditLogs').add({
                uid,
                action,
                entityType,
                entityId,
                metadata,
                createdAt: Timestamp.now(),
            });
        } catch (err) {
            // Audit logging must never block the action it's recording.
            this.logger.error(`Failed to write audit log: ${action} ${entityType} ${entityId}`, err as Error);
        }
    }

    async listForUser(uid: string) {
        const snap = await this.firestore
            .collection('auditLogs')
            .where('uid', '==', uid)
            .orderBy('createdAt', 'desc')
            .limit(100)
            .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
}