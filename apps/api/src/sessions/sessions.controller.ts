import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { MobileSession } from '@vision-trips/contracts';
import { SessionsService } from './sessions.service.js';

@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post('refresh')
  refresh(@Body() body: { refreshToken?: unknown }): MobileSession {
    return this.sessions.refresh(body?.refreshToken);
  }

  @Delete('current')
  @HttpCode(204)
  revoke(@Body() body: { refreshToken?: unknown }): void {
    this.sessions.revoke(body?.refreshToken);
  }
}
