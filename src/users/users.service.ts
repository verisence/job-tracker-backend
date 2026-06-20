import { Inject, Injectable } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { DecodedIdToken } from 'firebase-admin/auth';
import { FIRESTORE } from '../config/firebase.constants';

@Injectable()
export class UsersService {
  constructor(@Inject(FIRESTORE) private readonly firestore: Firestore) {}

  async findOrCreateProfile(decoded: DecodedIdToken) {
    const ref = this.firestore.collection('users').doc(decoded.uid);
    const snap = await ref.get();

    if (snap.exists) {
      return { uid: snap.id, ...snap.data() };
    }

    const profile = {
      email: decoded.email ?? null,
      displayName: decoded.name ?? null,
      role: 'user',
      createdAt: Timestamp.now(),
    };

    await ref.set(profile);
    return { uid: decoded.uid, ...profile };
  }
}