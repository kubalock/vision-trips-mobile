import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { LinkExchangesModule } from './link-exchanges/link-exchanges.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { TripActionsModule } from './trip-actions/trip-actions.module.js';
import { ExternalContentModule } from './external-content/external-content.module.js';

@Module({
  imports: [SessionsModule, LinkExchangesModule, TripActionsModule, ExternalContentModule],
  controllers: [AppController],
})
export class AppModule {}
