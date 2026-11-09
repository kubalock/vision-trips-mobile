import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

try {
  process.loadEnvFile();
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== 'ENOENT') throw error;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const production = process.env.NODE_ENV === 'production';
  const origins = allowedOrigins();
  if (production && origins.length === 0) throw new Error('MOBILE_ORIGIN must contain at least one explicit production origin.');
  if (process.env.TRUST_PROXY) app.getHttpAdapter().getInstance().set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
  app.setGlobalPrefix('v1');
  app.enableCors({
    origin: origins,
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id', 'X-Vision-Key'],
    maxAge: 86_400,
  });
  app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
    if (production) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle('Vision Trips API')
    .setDescription('Trusted mobile API for Vision Trips')
    .setVersion('1.0')
    .build();
  if (!production || process.env.ENABLE_API_DOCS === 'true') {
    const documentFactory = () => SwaggerModule.createDocument(app, openApiConfig);
    SwaggerModule.setup('docs', app, documentFactory, { jsonDocumentUrl: 'openapi.json' });
  }

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();

function allowedOrigins(): string[] {
  const configured = process.env.MOBILE_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:4200');
  return configured.split(',').map((origin) => origin.trim()).filter((origin) => /^https?:\/\/[^*]+$/.test(origin) || /^(capacitor|ionic):\/\/localhost$/.test(origin));
}
