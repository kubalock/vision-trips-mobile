import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { LinkExchangesModule } from './link-exchanges/link-exchanges.module.js';
import { SessionsModule } from './sessions/sessions.module.js';

@Module({
  imports: [SessionsModule, LinkExchangesModule],
  controllers: [AppController],
})
export class AppModule {}
