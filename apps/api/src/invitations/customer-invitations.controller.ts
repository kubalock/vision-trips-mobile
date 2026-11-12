import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  createCustomerInvitationRequestSchema, createCustomerInvitationResponseSchema, revokeCustomerInvitationRequestSchema,
  revokeCustomerInvitationResponseSchema, type CreateCustomerInvitationResponse, type RevokeCustomerInvitationResponse,
} from '@vision-trips/contracts';
import { NoStoredReplay } from '../operations/no-stored-replay.js';
import { assertAutomationKey } from '../security/automation-key.js';
import { CustomerInvitationsService } from './customer-invitations.service.js';
import { checkedResponse, parseRequest } from './validation.js';

/** Agent and Airtable-automation API. Authenticated with `X-Vision-Key` (VISION_AUTOMATION_KEY). */
@ApiTags('customer invitations')
@Controller('customer-invitations')
@NoStoredReplay()
export class CustomerInvitationsController {
  constructor(private readonly invitations: CustomerInvitationsService) {}

  @Post()
  @HttpCode(200)
  @ApiHeader({ name: 'X-Vision-Key', required: true })
  @ApiBody({ schema: { example: { baseId: 'appXXXXXXXXXXXXXX', bookingRecordId: 'recXXXXXXXXXXXXXX', customerRecordId: 'recXXXXXXXXXXXXXX', scope: 'primary_customer', sendEmail: true, idempotencyKey: 'airtable:recXXXXXXXXXXXXXX:1731400000' } } })
  @ApiOkResponse({ description: 'The customer-facing link (null for a duplicate) and non-sensitive status.' })
  async create(@Headers('x-vision-key') key: string | undefined, @Body() body: unknown): Promise<CreateCustomerInvitationResponse> {
    assertAutomationKey(key);
    const input = parseRequest(createCustomerInvitationRequestSchema, body);
    return checkedResponse(createCustomerInvitationResponseSchema, await this.invitations.create(input));
  }

  @Post('revoke')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Vision-Key', required: true })
  async revoke(@Headers('x-vision-key') key: string | undefined, @Body() body: unknown): Promise<RevokeCustomerInvitationResponse> {
    assertAutomationKey(key);
    const input = parseRequest(revokeCustomerInvitationRequestSchema, body);
    return checkedResponse(revokeCustomerInvitationResponseSchema, await this.invitations.revoke(input.baseId, input.bookingRecordId, input.customerRecordId ?? null));
  }
}
