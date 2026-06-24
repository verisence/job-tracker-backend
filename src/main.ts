import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  const config = app.get(ConfigService);

  const allowedOrigins = config.get<string>('FRONTEND_URLS')?.split(',') ?? ['http://localhost:5173'];
  app.enableCors({ origin: allowedOrigins, credentials: true });

  const port = config.get<number>('PORT') ?? 8080;
  await app.listen(port, '0.0.0.0');
}
bootstrap();