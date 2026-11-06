import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('system')
@Controller()
export class AppController {
  @Get('health')
  @ApiOkResponse({ schema: { example: { status: 'ok', service: 'vision-trips-api' } } })
  getHealth(): { status: 'ok'; service: 'vision-trips-api' } {
    return { status: 'ok', service: 'vision-trips-api' };
  }
}
