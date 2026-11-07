import { Module } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service.js';
import { LinkTokenService } from '../security/link-token.service.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { TripsService } from '../trips/trips.service.js';
import { CustomerNotificationsController } from './customer-notifications.controller.js';
import { CustomerNotificationsService } from './customer-notifications.service.js';

@Module({
  imports: [SessionsModule], controllers: [CustomerNotificationsController],
  providers: [CustomerNotificationsService, TripsService, AirtableService, LinkTokenService],
})
export class CustomerNotificationsModule {}
