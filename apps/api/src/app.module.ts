import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { LinkExchangesModule } from './link-exchanges/link-exchanges.module.js';

@Module({
  imports: [LinkExchangesModule],
  controllers: [AppController],
})
export class AppModule {}
