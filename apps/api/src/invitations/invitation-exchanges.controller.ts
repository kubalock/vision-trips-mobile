import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  invitationOtpStateSchema, invitationStateSchema, openInvitationRequestSchema, resolveInvitationRequestSchema,
  sendInvitationCodeRequestSchema, verifyInvitationCodeRequestSchema,
  type InvitationAuthorized, type InvitationOtpState, type InvitationState,
} from '@vision-trips/contracts';
import { NoStoredReplay } from '../operations/no-stored-replay.js';
import { CustomerInvitationsService } from './customer-invitations.service.js';
import { checkedResponse, parseRequest } from './validation.js';

/**
 * Customer side of an invitation. Lives under /v1/link-exchanges so it shares the stricter authentication rate limit
 * and the HttpOnly trusted-device cookies (scoped to that path) that browsers send automatically.
 * The token travels in the request body, never in a URL or query string.
 */
@ApiTags('customer invitations')
@Controller('link-exchanges/invitations')
@NoStoredReplay()
export class InvitationExchangesController {
  constructor(private readonly invitations: CustomerInvitationsService) {}

  @Post('resolve')
  @HttpCode(200)
  async resolve(@Body() body: unknown): Promise<InvitationState> {
    const input = parseRequest(resolveInvitationRequestSchema, body, 'invitation_invalid');
    return checkedResponse(invitationStateSchema, await this.invitations.resolve(input.token, input.deviceTrustTokens));
  }

  @Post('code')
  @HttpCode(200)
  async sendCode(@Body() body: unknown): Promise<InvitationOtpState> {
    const input = parseRequest(sendInvitationCodeRequestSchema, body, 'invitation_invalid');
    return checkedResponse(invitationOtpStateSchema, await this.invitations.sendCode(input.token));
  }

  @Post('verify')
  @HttpCode(200)
  verify(@Body() body: unknown): Promise<InvitationAuthorized> {
    const input = parseRequest(verifyInvitationCodeRequestSchema, body, 'code_invalid');
    return this.invitations.verifyCode(input.token, input.code, input.rememberDevice);
  }

  @Post('open')
  @HttpCode(200)
  open(@Body() body: unknown): Promise<InvitationAuthorized> {
    const input = parseRequest(openInvitationRequestSchema, body, 'invitation_invalid');
    return this.invitations.open(input.token, input.deviceTrustTokens);
  }
}
