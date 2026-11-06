import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableCors({
    origin: process.env.MOBILE_ORIGIN ?? 'http://localhost:4200',
    credentials: false,
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle('Vision Trips API')
    .setDescription('Trusted mobile API for Vision Trips')
    .setVersion('1.0')
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('docs', app, documentFactory, { jsonDocumentUrl: 'openapi.json' });

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
