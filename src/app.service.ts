import { Inject, Injectable } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE } from './config/firebase.constants';

@Injectable()
export class AppService {
  constructor(@Inject(FIRESTORE) private readonly firestore: Firestore) { }

  getHello(): string {
    return 'Hello World!';
  }

  async checkFirestore() {
    // TODO improve on the health check later. Return more usefull info like the storage used etc. Send via mail.
    const ref = await this.firestore.collection('_health').add({ checkedAt: Timestamp.now() });
    return { ok: true, docId: ref.id };
  }
}