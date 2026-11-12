import { Module } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { TripsService } from '../trips/trips.service.js';
import { InvitationsModule } from '../invitations/invitations.module.js';
import { TripActionsController } from './trip-actions.controller.js';
import { AcceptanceNotificationsService } from './acceptance-notifications.service.js';
import { PdfDocumentService } from './pdf-document.service.js';
import { MintPaymentsService } from './mint-payments.service.js';
import { RelatedQuotationsService } from './related-quotations.service.js';
import { CustomerAccountService } from './customer-account.service.js';

@Module({
  imports: [SessionsModule, InvitationsModule],
  controllers: [TripActionsController],
  providers: [TripsService, AirtableService, AcceptanceNotificationsService, PdfDocumentService, MintPaymentsService, RelatedQuotationsService, CustomerAccountService],
})
export class TripActionsModule {}
