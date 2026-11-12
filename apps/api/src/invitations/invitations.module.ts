import { Module } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service.js';
import { DeviceTrustService } from '../security/device-trust.service.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { TripsService } from '../trips/trips.service.js';
import { CustomerInvitationsController } from './customer-invitations.controller.js';
import { CustomerInvitationsService } from './customer-invitations.service.js';
import { InvitationEmailService } from './invitation-email.service.js';
import { InvitationExchangesController } from './invitation-exchanges.controller.js';

@Module({
  imports: [SessionsModule],
  controllers: [CustomerInvitationsController, InvitationExchangesController],
  providers: [CustomerInvitationsService, InvitationEmailService, DeviceTrustService, TripsService, AirtableService],
  exports: [CustomerInvitationsService],
})
export class InvitationsModule {}
