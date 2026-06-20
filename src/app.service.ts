import { Inject, Injectable } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE } from './config/firebase.constants';

@Injectable()
export class AppService {
  constructor(@Inject(FIRESTORE) private readonly firestore: Firestore) {}

  getHello(): string {
    return 'Hello World!';
  }

  async checkFirestore() {
    const ref = await this.firestore.collection('_health').add({ checkedAt: Timestamp.now() });
    return { ok: true, docId: ref.id };
  }
}