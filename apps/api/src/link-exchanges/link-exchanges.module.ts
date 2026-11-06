import { Module } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service.js';
import { LinkTokenService } from '../security/link-token.service.js';
import { TripsService } from '../trips/trips.service.js';
import { LinkExchangesController } from './link-exchanges.controller.js';
import { LinkExchangesService } from './link-exchanges.service.js';

@Module({
  controllers: [LinkExchangesController],
  providers: [LinkExchangesService, LinkTokenService, TripsService, AirtableService],
})
export class LinkExchangesModule {}
