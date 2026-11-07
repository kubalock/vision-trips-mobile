import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';
import { DurableAuthStore } from './durable-auth.store.js';

@Module({
  controllers: [SessionsController],
  providers: [DurableAuthStore, SessionsService],
  exports: [DurableAuthStore, SessionsService],
})
export class SessionsModule {}
