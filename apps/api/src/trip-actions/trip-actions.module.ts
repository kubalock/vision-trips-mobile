import { Module } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { TripsService } from '../trips/trips.service.js';
import { TripActionsController } from './trip-actions.controller.js';

@Module({
  imports: [SessionsModule],
  controllers: [TripActionsController],
  providers: [TripsService, AirtableService],
})
export class TripActionsModule {}
