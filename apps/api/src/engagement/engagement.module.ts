import { Module } from '@nestjs/common';
import { AirtableService } from '../airtable/airtable.service.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { EngagementController } from './engagement.controller.js';
import { EngagementService } from './engagement.service.js';

@Module({ imports: [SessionsModule], controllers: [EngagementController], providers: [AirtableService, EngagementService] })
export class EngagementModule {}
