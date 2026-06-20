---
## title: "Job Application Tracker — Backend Setup Runbook"
subtitle: "NestJS (TypeScript) + Firebase Admin SDK (Firestore, Storage, Auth)"
date: \today


# Before You Start


This runbook assumes:


* A Firebase project already exists, with **Firestore** and **Storage** enabled in  *test mode* .
* A **service account JSON key** has been downloaded from Firebase console → Project settings → Service accounts.
* Node.js and npm are installed.


Every code file below is the final, confirmed-working version. Every console step and terminal command was actually run and verified before moving to the next step. Follow them in order — later steps depend on earlier ones being in place.
---
# Step 1 — Create the backend project (TypeScript)

NestJS's plain-JavaScript template relies on Babel transpiling decorators and `import`/`export` syntax on the fly, which turned out to be fragile on this machine (Node version + Windows path resolution). TypeScript compiles natively with no Babel involved, so that's what this runbook uses throughout.

```bash
mkdir job-tracker
cd job-tracker

npx @nestjs/cli new backend --package-manager npm --language ts
```

This creates `job-tracker/backend` with the standard Nest TypeScript structure (`src/app.module.ts`, `src/main.ts`, etc.).

---

# Step 2 — Place the service account file and configure environment variables

```bash
cd backend
```

Place the downloaded key file at the **project root** (not inside `src/`):

```
backend/firebase-service-account.json
```

Immediately exclude it and your env file from git:

```bash
echo "firebase-service-account.json" >> .gitignore
echo ".env" >> .gitignore
git status
```

Confirm neither file shows as trackable before continuing.

Create  **`backend/.env`** :

```
GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
FIREBASE_STORAGE_BUCKET=<your-project-id>.appspot.com
PORT=8080
```

> **Console check:** Firebase console → **Storage** tab → copy the exact bucket name shown there into `.env`. Projects created since late 2024 may use `<project-id>.firebasestorage.app` instead of the older `<project-id>.appspot.com` — using the wrong one won't error immediately, it'll only fail later when a file is actually uploaded.

Create **`backend/.env.example`** (this one is safe to commit):

```
GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json
FIREBASE_STORAGE_BUCKET=
PORT=8080
```

`GOOGLE_APPLICATION_CREDENTIALS` is read automatically by `admin.credential.applicationDefault()` (used in Step 5) during local development. On a real deployment (e.g. Cloud Run), this line is simply omitted — the platform's attached service account takes over with zero code changes.

---

# Step 3 — Install dependencies

```bash
npm install firebase-admin @nestjs/config class-validator class-transformer
```

`@nestjs/mapped-types` is installed later, in Step 9, when it's first needed.

---

# Step 4 — Wire up `ConfigModule` so `.env` is actually read

By default, Nest's generated `main.ts` hardcodes port 3000 and ignores `.env` entirely. Fix that now.

**`src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

`isGlobal: true` means `ConfigService` can be injected anywhere later without re-importing `ConfigModule` in every feature module.

**`src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  await app.listen(config.get<number>('PORT') ?? 3000);
}
bootstrap();
```

**Verify:**

```bash
npm run start:dev
```

Visit `http://localhost:8080` — should show "Hello World!".

---

# Step 5 — Build the Firebase Admin module

This is the single place `firebase-admin` is initialized. Every other module injects Firestore, Auth, or Storage from here — nothing calls `firebase-admin` directly anywhere else in the app.

> **Important version note:** `firebase-admin` v12+ uses modular, tree-shakeable imports (`firebase-admin/app`, `firebase-admin/firestore`, etc.) instead of the older `admin.firestore()`-style namespaced API. The code below uses the current modular API — the older namespaced calls (`admin.apps`, `admin.credential`, `admin.app()`) no longer exist on the installed package's types and will fail to compile.

**`src/config/firebase.constants.ts`**

```typescript
export const FIREBASE_APP = 'FIREBASE_APP';
export const FIRESTORE = 'FIRESTORE';
export const FIREBASE_AUTH = 'FIREBASE_AUTH';
export const FIREBASE_BUCKET = 'FIREBASE_BUCKET';
```

**`src/config/firebase-admin.module.ts`**

```typescript
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
```

`@Global()` means any feature module can inject `FIRESTORE`, `FIREBASE_AUTH`, or `FIREBASE_BUCKET` without re-importing this module.

**`src/app.module.ts`** — register it:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FirebaseAdminModule } from './config/firebase-admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    FirebaseAdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

---

# Step 6 — Verify the wiring with a health-check endpoint

**`src/app.service.ts`**

```typescript
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
```

**`src/app.controller.ts`**

```typescript
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health/firestore')
  checkFirestore() {
    return this.appService.checkFirestore();
  }
}
```

**Verify:**

```bash
curl http://localhost:8080/health/firestore
```

Confirmed working response:

```json
{"ok":true,"docId":"xOVv5rFRGPXXHjKsBlB6"}
```

A new document should also appear in Firestore console under a `_health` collection. This confirms the service account credentials, project wiring, and Firestore read/write access all work end to end.

---

# Step 7 — Authentication: guard, decorator, and `/me` endpoint

## 7.1 — Firebase console setup

1. Firebase console → **Authentication** → **Sign-in method** tab → enable  **Email/Password** .
2. Firebase console → **Authentication** → **Users** tab → **Add user** → enter any email + password. This is your test user.
3. Firebase console → gear icon → **Project settings** → **General** tab → copy the **Web API Key** (a string starting with `AIzaSy...`, found near Project ID / Project number). This is a public-safe identifier, *not* the private key from the service account JSON — it's safe to embed in client-side code later.

## 7.2 — Code

**`src/common/decorators/current-user.decorator.ts`**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});
```

**`src/common/guards/firebase-auth.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Auth } from 'firebase-admin/auth';
import { FIREBASE_AUTH } from '../../config/firebase.constants';

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(@Inject(FIREBASE_AUTH) private readonly auth: Auth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.split('Bearer ')[1];

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      request.user = await this.auth.verifyIdToken(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
```

**`src/users/users.service.ts`**

```typescript
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
```

**`src/users/users.controller.ts`**

> Note the `import type` on `DecodedIdToken`: when `isolatedModules` + `emitDecoratorMetadata` are both enabled (Nest's default `tsconfig.json`), any type used purely as a parameter annotation on a decorated method must use `import type`, not a regular `import`, or the compiler can't tell whether to keep it as a runtime value or strip it.

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

@UseGuards(FirebaseAuthGuard)
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@CurrentUser() user: DecodedIdToken) {
    return this.usersService.findOrCreateProfile(user);
  }
}
```

**`src/users/users.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
```

**`src/app.module.ts`** — add `UsersModule` to imports.

**`src/main.ts`** — enable global validation now, since DTOs are next:

```typescript
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  const config = app.get(ConfigService);
  await app.listen(config.get<number>('PORT') ?? 3000);
}
bootstrap();
```

## 7.3 — Get a real ID token and test

There's no frontend yet, so a token has to be obtained directly via the Identity Toolkit REST API:

```bash
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=YOUR_WEB_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"yourpassword","returnSecureToken":true}'
```

Copy the `idToken` value from the response, then:

```bash
curl http://localhost:8080/me -H "Authorization: Bearer PASTE_ID_TOKEN_HERE"
```

Confirmed working response:

```json
{"uid":"plAvJl4DHQT6C565kCH7mInfK6k1","email":"test@example.com","displayName":null,"role":"user","createdAt":{"_seconds":1781938199,"_nanoseconds":330000000}}
```

A matching document also appears in Firestore under `users/{uid}`.

**Negative check (important, not optional):** run the same call with no `Authorization` header at all and confirm it returns `401`, not a crash or a silent success.

---

# Step 8 — Applications module (CRUD + ownership)

```bash
npm install @nestjs/mapped-types
```

## 8.1 — DTOs

**`src/applications/dto/create-application.dto.ts`**

> Fields use `!:` (definite assignment assertion), not `?:`. Using `?:` would make TypeScript treat the field as genuinely optional everywhere, even though `class-validator`'s `@IsString()` (without `@IsOptional()`) still enforces it as required at runtime — that mismatch becomes misleading later.

```typescript
import { IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const APPLICATION_STATUSES = ['applied', 'interviewing', 'offer', 'rejected', 'withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export class CreateApplicationDto {
  @IsString()
  @MaxLength(200)
  jobTitle!: string;

  @IsString()
  @MaxLength(200)
  companyName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyLocation?: string;

  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: ApplicationStatus;

  @IsOptional()
  @IsDateString()
  appliedDate?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
```

**`src/applications/dto/update-application.dto.ts`**

```typescript
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateApplicationDto } from './create-application.dto';

export class UpdateApplicationDto extends PartialType(
  OmitType(CreateApplicationDto, ['status'] as const),
) {}
```

Status is excluded here because every status change needs a timeline entry written alongside it — a generic PATCH shouldn't be able to skip that silently. It has its own endpoint below.

**`src/applications/dto/update-status.dto.ts`**

> `APPLICATION_STATUSES` is a real array used at runtime inside `@IsIn()`, so it's a normal import. `ApplicationStatus` is only ever a type annotation, so it needs `import type`. Mixing both from the same file requires splitting the import like this.

```typescript
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { APPLICATION_STATUSES } from './create-application.dto';
import type { ApplicationStatus } from './create-application.dto';

export class UpdateStatusDto {
  @IsIn(APPLICATION_STATUSES)
  status!: ApplicationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
```

## 8.2 — Service

> `snap.data()` from Firestore types as a bare index signature. Spreading it collapses to an untyped shape, so later property access (e.g. `existing.status`) fails to compile. Casting to a local `ApplicationRecord` interface right after reading fixes this.

**`src/applications/applications.service.ts`**

```typescript
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
  ) {}

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

  async findAll(uid: string, filters: { status?: string; companyName?: string }) {
    let query: Query<DocumentData> = this.collection().where('uid', '==', uid);

    if (filters.status) query = query.where('status', '==', filters.status);
    if (filters.companyName) query = query.where('companyName', '==', filters.companyName);

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
```

> This file already includes the `AuditService` calls added in Step 11. They're included here rather than as a separate later edit, since you should only ever keep one final version of this file.

## 8.3 — Controller and module

**`src/applications/applications.controller.ts`**

```typescript
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
```

**`src/applications/applications.module.ts`**

> Includes `AuditModule` (Step 11) and `exports: [ApplicationsService]` (Step 9, needed by the Files module).

```typescript
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [AuditModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
```

**`src/app.module.ts`** — add `ApplicationsModule` to imports.

## 8.4 — Test

```bash
curl -X POST http://localhost:8080/applications \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jobTitle":"Frontend Engineer","companyName":"Acme Corp","companyLocation":"Remote"}'

curl http://localhost:8080/applications -H "Authorization: Bearer YOUR_TOKEN"
```

Confirmed working — create returns the new application document, list returns it back.

> **Note on filtered queries:** the first time a `where` + `orderBy` combination runs (e.g. `?status=applied`), Firestore may respond with a `failed-precondition` error containing a console link to create a composite index. This is expected, not a bug — click the link, wait about 30 seconds, then retry.

---

# Step 9 — Files module (upload, list, signed URL, delete)

File metadata is stored in a flat top-level `files` collection with a nullable `appId`, rather than as an `applications/{id}/files` subcollection — a standalone CV upload (no associated application) can't live inside a subcollection that requires a parent document.

## 9.1 — DTO

**`src/files/dto/upload-file.dto.ts`**

```typescript
import { IsIn } from 'class-validator';

export const STANDALONE_FILE_TYPES = ['cv', 'cover_letter'] as const;
export type StandaloneFileType = (typeof STANDALONE_FILE_TYPES)[number];

export class UploadFileDto {
  @IsIn(STANDALONE_FILE_TYPES)
  type!: StandaloneFileType;
}
```

## 9.2 — Service

> Uploaded files are saved with `memoryStorage` (buffer, never touches disk) and kept **private** in the bucket. A signed URL with a 15-minute expiry is generated on demand instead of making files public — important since CVs and cover letters are personal documents.

**`src/files/files.service.ts`**

```typescript
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
```

> Includes the `AuditService` calls added in Step 11, kept inline for the same reason as the Applications service above.

## 9.3 — Controller and module

**`src/files/files.controller.ts`**

```typescript
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
```

**`src/files/files.module.ts`**

> Includes `AuditModule` (Step 11).

```typescript
import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { AuditModule } from '../audit/audit.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [ApplicationsModule, AuditModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
```

**`src/app.module.ts`** — add `FilesModule` to imports.

## 9.4 — Test

```bash
curl -X POST http://localhost:8080/files \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "type=cv" \
  -F "file=@/path/to/resume.pdf"

curl http://localhost:8080/files -H "Authorization: Bearer YOUR_TOKEN"
```

Confirmed working: upload returns JSON including `storagePath` and a signed `url` (valid 15 minutes); pasting that URL into a browser downloads/previews the PDF; the list call returns it back.

**Negative checks performed and confirmed:**

* Uploading a disallowed file type returns `400` from `FileTypeValidator`, not a silent upload.
* The file lands under `users/{uid}/cv/` in Storage console, and is **not** publicly accessible without a signed URL.

> **Known limitation:** `FileTypeValidator` here checks the client-supplied `mimetype` field, which can be spoofed — it does not inspect actual file bytes. Acceptable for this MVP behind authentication; magic-byte sniffing (e.g. the `file-type` npm package) would be the hardening step if this matters more later.

---

# Step 10 — Lock down Firestore and Storage security rules

This step matters because of how "test mode" works: it grants  **fully open read/write access to anyone** , with no auth check at all, for roughly 30 days. That's harmless right now because the only thing touching Firestore/Storage is the NestJS backend's Admin SDK, which bypasses security rules entirely. It becomes a real risk the moment a frontend is added — the Firebase client SDK config embedded in that frontend's JS bundle is not secret by design, and with test-mode rules still active, anyone with that config could call Firestore/Storage directly, completely bypassing the backend, the auth guard, and every ownership check built above.

Since the backend's Admin SDK ignores rules entirely, locking these down is purely additive — it doesn't change how anything built so far behaves.

**Firebase console → Firestore Database → Rules tab** — replace contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Click  **Publish** .

**Firebase console → Storage → Rules tab** — replace contents with:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

Click  **Publish** .

**Verify:** rerun the applications-list and file-signed-url curl commands from Steps 8 and 9 — both should behave identically, confirming this change only closes off direct client access and didn't break anything the backend does.

---

# Step 11 — Audit module

A lightweight, separate trail from the per-application `timeline` built in Step 8. `timeline` is user-facing history; `auditLogs` is for accountability — it specifically captures status changes, uploads, and deletions, the sensitive/destructive actions, not every read.

**`src/audit/audit.service.ts`**

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { FIRESTORE } from '../config/firebase.constants';

export type AuditAction = 'status_change' | 'upload' | 'delete';
export type AuditEntityType = 'application' | 'file';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(FIRESTORE) private readonly firestore: Firestore) {}

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
```

**`src/audit/audit.controller.ts`**

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from './audit.service';

@UseGuards(FirebaseAuthGuard)
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(@CurrentUser() user: DecodedIdToken) {
    return this.auditService.listForUser(user.uid);
  }
}
```

**`src/audit/audit.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

**`src/app.module.ts`** — add `AuditModule` to imports.

> The `ApplicationsService` and `FilesService` shown in Steps 8 and 9 already include the calls into `AuditService` (`auditService.log(...)`) at the relevant points — status change, application delete, file upload, file delete — plus the corresponding `imports: [AuditModule]` lines in `applications.module.ts` and `files.module.ts`.

## Test

```bash
curl -X PATCH http://localhost:8080/applications/YOUR_APP_ID/status \
  -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"interviewing"}'

curl http://localhost:8080/audit-logs -H "Authorization: Bearer YOUR_TOKEN"
```

Confirmed working: the status-change call produces a matching `action: "status_change"` entry in `/audit-logs`; deleting a previously-uploaded file produces a second entry with `action: "delete"` and `entityType: "file"`.

---

# Step 12 — Dashboard summary endpoint

Counts use Firestore's `count()` aggregation query (cheap — doesn't pull full documents). Recent activity reads from the flat `activity` collection that `ApplicationsService.addTimelineEvent` has been writing to since Step 8.

**`src/dashboard/dashboard.service.ts`**

```typescript
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
```

**`src/dashboard/dashboard.controller.ts`**

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseAuthGuard } from '../common/guards/firebase-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@UseGuards(FirebaseAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  getSummary(@CurrentUser() user: DecodedIdToken) {
    return this.dashboardService.getSummary(user.uid);
  }
}
```

**`src/dashboard/dashboard.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

**`src/app.module.ts`** — final version, all modules registered:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FirebaseAdminModule } from './config/firebase-admin.module';
import { UsersModule } from './users/users.module';
import { ApplicationsModule } from './applications/applications.module';
import { FilesModule } from './files/files.module';
import { AuditModule } from './audit/audit.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    FirebaseAdminModule,
    UsersModule,
    ApplicationsModule,
    FilesModule,
    AuditModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

## Test

```bash
curl http://localhost:8080/dashboard/summary -H "Authorization: Bearer YOUR_TOKEN"
```

Confirmed working response shape:

```json
{
  "total": 1,
  "byStatus": { "applied": 0, "interviewing": 1, "offer": 0, "rejected": 0, "withdrawn": 0 },
  "recentActivity": [ /* ... */ ]
}
```

> Same composite-index caveat as Step 8 applies here if this is the first query against `activity` filtering by `uid` and sorting by `createdAt` — a console link will appear if an index is needed; click it, wait, retry.

---

# Final project structure

```
backend/
  firebase-service-account.json     (gitignored)
  .env                              (gitignored)
  .env.example
  src/
    config/
      firebase.constants.ts
      firebase-admin.module.ts
    common/
      decorators/current-user.decorator.ts
      guards/firebase-auth.guard.ts
    users/
      users.controller.ts
      users.service.ts
      users.module.ts
    applications/
      dto/
        create-application.dto.ts
        update-application.dto.ts
        update-status.dto.ts
      applications.controller.ts
      applications.service.ts
      applications.module.ts
    files/
      dto/upload-file.dto.ts
      files.controller.ts
      files.service.ts
      files.module.ts
    audit/
      audit.controller.ts
      audit.service.ts
      audit.module.ts
    dashboard/
      dashboard.controller.ts
      dashboard.service.ts
      dashboard.module.ts
    app.module.ts
    app.controller.ts
    app.service.ts
    main.ts
```

# What's next

The backend MVP is complete: authentication, applications CRUD with ownership enforcement, private file upload/download via signed URLs, status timeline, audit trail, basic filtering, and a dashboard summary — all guard-protected and scoped to the authenticated user's `uid`.

The next phase is the React frontend: Firebase Auth sign-in, attaching the ID token to outgoing API requests, and building the first screens (login, application list, create form).
