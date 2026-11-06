import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import type { LinkExchangeResponse } from '@vision-trips/contracts';
import { LinkExchangesService } from './link-exchanges.service.js';

@ApiTags('link exchanges')
@Controller('link-exchanges')
export class LinkExchangesController {
  constructor(private readonly exchanges: LinkExchangesService) {}

  @Post()
  @ApiBody({ schema: { example: { linkOrCode: 'https://example.test/trip/{signed-token}/' } } })
  @ApiCreatedResponse({ description: 'An authorized trip snapshot or a verification challenge.' })
  create(@Body() body: { linkOrCode?: unknown; deviceTrustToken?: unknown }): Promise<LinkExchangeResponse> {
    return this.exchanges.create(body?.linkOrCode, body?.deviceTrustToken);
  }

  @Post('local')
  @ApiBody({ schema: { example: { baseId: 'appXXXXXXXXXXXXXX', recordId: 'recXXXXXXXXXXXXXX' } } })
  @ApiCreatedResponse({ description: 'A local-development trip snapshot. Disabled in production.' })
  createLocal(@Body() body: { baseId?: unknown; recordId?: unknown }): Promise<LinkExchangeResponse> {
    return this.exchanges.createLocal(body?.baseId, body?.recordId);
  }

  @Post(':exchangeId/verify/knowledge')
  verifyPostcode(
    @Param('exchangeId') exchangeId: string,
    @Body() body: { postcode?: unknown; rememberDevice?: unknown },
  ): Promise<LinkExchangeResponse> {
    return this.exchanges.verifyPostcode(exchangeId, body?.postcode, body?.rememberDevice);
  }

  @Post(':exchangeId/otp/send')
  sendOtp(@Param('exchangeId') exchangeId: string) { return this.exchanges.sendOtp(exchangeId); }

  @Post(':exchangeId/verify/otp')
  verifyOtp(@Param('exchangeId') exchangeId: string, @Body() body: { code?: unknown; rememberDevice?: unknown }): Promise<LinkExchangeResponse> {
    return this.exchanges.verifyOtp(exchangeId, body?.code, body?.rememberDevice);
  }
}
