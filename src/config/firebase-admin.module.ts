import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, applicationDefault, getApps, getApp, App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import {
  FIREBASE_APP,
  FIRESTORE,
  FIREBASE_AUTH,
  FIREBASE_BUCKET,
} from './firebase.constants';

@Global()
@Module({
  providers: [
    {
      provide: FIREBASE_APP,
      useFactory: (config: ConfigService): App =>
        getApps().length
          ? getApp()
          : initializeApp({
              credential: applicationDefault(),
              storageBucket: config.get<string>('FIREBASE_STORAGE_BUCKET'),
            }),
      inject: [ConfigService],
    },
    {
      provide: FIRESTORE,
      useFactory: (app: App) => getFirestore(app),
      inject: [FIREBASE_APP],
    },
    {
      provide: FIREBASE_AUTH,
      useFactory: (app: App) => getAuth(app),
      inject: [FIREBASE_APP],
    },
    {
      provide: FIREBASE_BUCKET,
      useFactory: (app: App) => getStorage(app).bucket(),
      inject: [FIREBASE_APP],
    },
  ],
  exports: [FIRESTORE, FIREBASE_AUTH, FIREBASE_BUCKET],
})
export class FirebaseAdminModule {}