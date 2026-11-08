import { BadRequestException, Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CustomerEngagementRequest, CustomerEngagementResponse } from '@vision-trips/contracts';
import { SessionsService } from '../sessions/sessions.service.js';
import { EngagementService } from './engagement.service.js';

@ApiTags('customer engagement')
@Controller('trips/current/engagement')
export class EngagementController {
  constructor(private readonly sessions: SessionsService, private readonly engagement: EngagementService) {}

  @Post()
  @ApiBearerAuth()
  record(@Headers('authorization') authorization: string | undefined, @Body() body: CustomerEngagementRequest): CustomerEngagementResponse {
    const principal = this.sessions.validateAccess(authorization);
    if (!['section_opened', 'action_clicked'].includes(body?.event) || typeof body?.detail !== 'string' || !body.detail.trim()) throw new BadRequestException('A valid engagement event is required.');
    this.engagement.record(principal, { ...body, detail: body.detail.trim() });
    return { accepted: true };
  }
}
