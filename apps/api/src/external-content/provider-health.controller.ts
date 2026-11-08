import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ExternalContentService } from './external-content.service.js';

@ApiTags('system')
@Controller('health/providers')
export class ProviderHealthController {
  constructor(private readonly external: ExternalContentService) {}

  @Get()
  @ApiOkResponse({ description: 'Redacted provider configuration and cache diagnostics.' })
  health(): { status: 'ok' | 'degraded'; providers: ReturnType<ExternalContentService['diagnostics']>['sources']; cache: ReturnType<ExternalContentService['diagnostics']>['cache'] } {
    const diagnostics = this.external.diagnostics();
    return {
      status: diagnostics.sources.some((provider) => !provider.configured && provider.provider !== 'weather') ? 'degraded' : 'ok',
      providers: diagnostics.sources,
      cache: diagnostics.cache,
    };
  }
}
