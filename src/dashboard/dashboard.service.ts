import { Inject, Injectable } from '@nestjs/common';
import { Firestore } from 'firebase-admin/firestore';
import { FIRESTORE } from '../config/firebase.constants';
import { APPLICATION_STATUSES } from '../applications/dto/create-application.dto';

@Injectable()
export class DashboardService {
  constructor(@Inject(FIRESTORE) private readonly firestore: Firestore) {}

  async getSummary(uid: string) {
    const appsRef = this.firestore.collection('applications').where('uid', '==', uid);

    const totalSnap = await appsRef.count().get();
    const total = totalSnap.data().count;

    const statusCounts = await Promise.all(
      APPLICATION_STATUSES.map(async (status) => {
        const snap = await appsRef.where('status', '==', status).count().get();
        return [status, snap.data().count] as const;
      }),
    );

    const activitySnap = await this.firestore
      .collection('activity')
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    return {
      total,
      byStatus: Object.fromEntries(statusCounts),
      recentActivity: activitySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    };
  }
}