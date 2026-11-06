import { Body, Controller, Post } from '@nestjs/common';
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
  create(@Body() body: { linkOrCode?: unknown }): Promise<LinkExchangeResponse> {
    return this.exchanges.create(body?.linkOrCode);
  }
}
