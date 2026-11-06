import { Injectable, Logger } from '@nestjs/common';
import type { TripSnapshot } from '@vision-trips/contracts';

export type DeliveryStatus = 'sent' | 'local_preview' | 'failed' | 'not_configured';

@Injectable()
export class AcceptanceNotificationsService {
  private readonly logger = new Logger(AcceptanceNotificationsService.name);

  async send(snapshot: TripSnapshot, customer: { name: string; email: string }, acceptedAt: string): Promise<{ customer: Exclude<DeliveryStatus, 'not_configured'>; agent: DeliveryStatus }> {
    const customerHtml = `<h1>Thank you, ${escapeHtml(customer.name.split(/\s+/)[0] || customer.name)}</h1><p>We have recorded your acceptance of quotation <strong>${escapeHtml(snapshot.summary.reference)}</strong> for ${escapeHtml(snapshot.summary.name)}.</p><p>Your travel agent will confirm each part with the suppliers. The booking status has not yet changed.</p><p>Accepted at ${escapeHtml(acceptedAt)}.</p>`;
    const agentHtml = `<h1>Quotation accepted</h1><p>${escapeHtml(customer.name)} (${escapeHtml(customer.email)}) accepted <strong>${escapeHtml(snapshot.summary.reference)}</strong> — ${escapeHtml(snapshot.summary.name)}.</p><p>Confirm the booking after supplier confirmation. Acceptance was recorded at ${escapeHtml(acceptedAt)}.</p>`;
    return {
      customer: await this.deliver(customer.email, `Thank you — ${snapshot.summary.name}`, customerHtml),
      agent: snapshot.support.email ? await this.deliver(snapshot.support.email, `Quotation accepted online: ${snapshot.summary.reference}`, agentHtml) : 'not_configured',
    };
  }

  private async deliver(to: string, subject: string, html: string): Promise<Exclude<DeliveryStatus, 'not_configured'>> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      this.logger.log(`Local email preview · to=${to} · subject=${subject}`);
      return 'local_preview';
    }
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.VISION_EMAIL_FROM?.trim() || 'Vision Trips <onboarding@resend.dev>', to: [to], subject, html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`email provider returned ${response.status}`);
      return 'sent';
    } catch (error) {
      this.logger.warn(`Acceptance email failed for ${to}: ${error instanceof Error ? error.message : 'unknown error'}`);
      return 'failed';
    }
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
