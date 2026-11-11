import { Controller, Get, Headers, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { ExternalTripContent } from '@vision-trips/contracts';
import { SessionsService } from '../sessions/sessions.service.js';
import { TripsService } from '../trips/trips.service.js';
import { ExternalContentService, publicApiBase } from './external-content.service.js';

@ApiTags('external trip content')
@Controller('trips/current/external-content')
export class ExternalContentController {
  constructor(private readonly sessions: SessionsService, private readonly trips: TripsService, private readonly external: ExternalContentService) {}

  @Get()
  @ApiBearerAuth()
  async content(@Headers('authorization') authorization: string | undefined, @Req() request: Request): Promise<ExternalTripContent> {
    const principal = this.sessions.validateAccess(authorization);
    const snapshot = await this.trips.snapshot(principal.baseId, principal.recordId, principal.fellowTraveller ? 'fellow_traveller' : 'primary_customer');
    return this.external.content(snapshot, publicApiBase(`${request.protocol}://${request.get('host')}`));
  }
}
