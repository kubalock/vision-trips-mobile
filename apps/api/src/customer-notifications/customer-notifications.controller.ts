import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { CustomerNotificationsService, type CustomerEmailRequest } from './customer-notifications.service.js';

@ApiTags('customer notifications')
@Controller('notifications/customer')
export class CustomerNotificationsController {
  constructor(private readonly notifications: CustomerNotificationsService) {}

  @Post()
  @ApiHeader({ name: 'X-Vision-Key', required: true })
  send(@Headers('x-vision-key') automationKey: string | undefined, @Body() body: CustomerEmailRequest) {
    return this.notifications.send(automationKey, body ?? {});
  }
}
