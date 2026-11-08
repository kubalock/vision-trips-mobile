import { Module } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { TripsService } from '../trips/trips.service.js';
import { ExternalCacheService } from './external-cache.service.js';
import { ExternalContentController } from './external-content.controller.js';
import { ExternalContentService } from './external-content.service.js';
import { ProviderHealthController } from './provider-health.controller.js';

@Module({ imports: [SessionsModule], controllers: [ExternalContentController, ProviderHealthController], providers: [AirtableService, TripsService, ExternalCacheService, ExternalContentService] })
export class ExternalContentModule {}
