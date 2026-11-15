import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';
import { DurableAuthStore } from './durable-auth.store.js';
import { TripEntitlementsService } from './trip-entitlements.service.js';
import { AirtableService } from '../airtable/airtable.service.js';

@Module({
  controllers: [SessionsController],
  providers: [DurableAuthStore, AirtableService, TripEntitlementsService, SessionsService],
  exports: [DurableAuthStore, TripEntitlementsService, SessionsService],
})
export class SessionsModule {}
