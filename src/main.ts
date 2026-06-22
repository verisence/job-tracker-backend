import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  app.enableCors({
    origin: ['http://localhost:5173'],
    credentials: true,
  });

  const config = app.get(ConfigService);
  await app.listen(config.get<number>('PORT') ?? 3000);
}
bootstrap();