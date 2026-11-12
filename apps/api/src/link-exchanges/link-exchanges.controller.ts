import { Body, Controller, Delete, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { devInvitationResponseSchema, devInvitationStatusSchema, stepUpResponseSchema, type DevInvitationResponse, type DevInvitationStatus, type LinkExchangeResponse, type StepUpResponse } from '@vision-trips/contracts';
import { CustomerInvitationsService } from '../invitations/customer-invitations.service.js';
import { checkedResponse } from '../invitations/validation.js';
import { NoStoredReplay } from '../operations/no-stored-replay.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { LinkExchangesService } from './link-exchanges.service.js';

@ApiTags('link exchanges')
@Controller('link-exchanges')
@NoStoredReplay()
export class LinkExchangesController {
  constructor(private readonly exchanges: LinkExchangesService, private readonly invitations: CustomerInvitationsService, private readonly sessions: SessionsService) {}

  @Post()
  @ApiBody({ schema: { example: { linkOrCode: 'https://example.test/trip/vt_…' } } })
  @ApiCreatedResponse({ description: 'An invitation to verify, or (legacy fellow-traveller links only) a restricted trip snapshot.' })
  create(@Body() body: { linkOrCode?: unknown }): Promise<LinkExchangeResponse> {
    return this.exchanges.create(body?.linkOrCode);
  }

  /** Browsers keep trusted-device tokens in HttpOnly cookies; the web-session interceptor clears them on this call. */
  @Delete('device-trust')
  @HttpCode(204)
  forgetDeviceTrust(): void {}

  /** Asks for an email code before a sensitive action when the current session was not verified by email. */
  @Post('step-up')
  @ApiBearerAuth()
  async stepUp(@Headers('authorization') authorization: string | undefined): Promise<StepUpResponse> {
    const principal = this.sessions.validateAccess(authorization);
    return checkedResponse(stepUpResponseSchema, { invitationToken: await this.invitations.stepUp(principal) });
  }

  /** Local development only (404 in production): is a test invitation configured on the server? */
  @Get('dev-invitation')
  devInvitationStatus(): DevInvitationStatus {
    return checkedResponse(devInvitationStatusSchema, this.invitations.devStatus());
  }

  /** Local development only (404 in production): an invitation for VISION_DEV_* — identifiers never leave the server. */
  @Post('dev-invitation')
  async devInvitation(): Promise<DevInvitationResponse> {
    return checkedResponse(devInvitationResponseSchema, await this.invitations.devInvitation());
  }
}
