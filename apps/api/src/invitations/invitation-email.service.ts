import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { InvitationContext } from '../trips/trips.service.js';

interface EmailContent { subject: string; preheader: string; heading: string; paragraphs: string[]; highlight?: string; button?: { label: string; url: string }; footnote: string }

/**
 * Branded invitation and one-time-code emails, sent with the same provider (Resend) as other customer emails. Without
 * RESEND_API_KEY, local development prints the email to the API console instead; production refuses to continue.
 */
@Injectable()
export class InvitationEmailService {
  private readonly logger = new Logger(InvitationEmailService.name);

  async sendInvitation(context: InvitationContext, url: string, expiresAt: number, invitationId: string): Promise<string> {
    const first = context.customer?.firstName;
    return this.deliver(context, `invite:${invitationId}`, {
      subject: `Your trip with ${context.brand.name} is ready in the app`,
      preheader: 'Open your trip and confirm it’s you with a code we’ll email you.',
      heading: first ? `${first}, your trip is ready` : 'Your trip is ready',
      paragraphs: [
        `${context.brand.name} has invited you to view ${context.tripName} in the Vision Trips app — your itinerary, documents and payments in one place.`,
        'When you open the link we’ll email you a six-digit code to confirm it’s you. Your trip is then saved in My Trips on that device.',
      ],
      button: { label: 'Open my trip', url },
      footnote: `This personal link works once and expires on ${longDate(expiresAt)}. Please don’t forward it. If it has expired, ask ${context.brand.name} for a new one.`,
    });
  }

  async sendCode(context: InvitationContext, code: string, idempotencyKey: string): Promise<string> {
    return this.deliver(context, idempotencyKey, {
      subject: `${code} is your ${context.brand.name} verification code`,
      preheader: 'Use this code to open your trip. It expires in 10 minutes.',
      heading: 'Your verification code',
      paragraphs: ['Enter this code in the app to open your trip:'],
      highlight: code,
      footnote: 'The code expires in 10 minutes. If you didn’t ask for it, you can ignore this email — nobody can open your trip without it.',
    });
  }

  private async deliver(context: InvitationContext, idempotencyKey: string, content: EmailContent): Promise<string> {
    const to = context.customer?.email;
    if (!to) throw new ServiceUnavailableException('No email address is available.');
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('Customer email delivery is not configured.');
      // Local development only: show the email in the API console so the flow can be tested without a provider.
      console.info(`[Vision Trips local email] to ${to} · ${content.subject}${content.button ? ` · ${content.button.url}` : ''}`);
      return 'local-console';
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        from: process.env.VISION_EMAIL_FROM?.trim() || 'Vision Trips <onboarding@resend.dev>',
        to: [to],
        ...(context.brand.supportEmail ? { reply_to: context.brand.supportEmail } : {}),
        subject: content.subject,
        html: renderInvitationEmail(context, content),
        text: renderText(content),
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((error: unknown) => {
      this.logger.warn(JSON.stringify({ event: 'invitation_email_failed', reason: error instanceof Error ? error.name : 'unknown' }));
      return null;
    });
    if (!response?.ok) {
      if (response) this.logger.warn(JSON.stringify({ event: 'invitation_email_rejected', status: response.status }));
      throw new BadGatewayException('The email could not be sent.');
    }
    const result = await response.json().catch(() => ({})) as { id?: unknown };
    return typeof result.id === 'string' ? result.id : 'accepted';
  }
}

export function renderInvitationEmail(context: InvitationContext, content: EmailContent): string {
  const accent = context.brand.primaryColor ?? '#0f766e';
  const logo = context.brand.logoUrl
    ? `<img src="${escapeHtml(context.brand.logoUrl)}" alt="${escapeHtml(context.brand.name)}" style="max-height:48px;max-width:220px">`
    : `<strong style="font-size:20px">${escapeHtml(context.brand.name)}</strong>`;
  const paragraphs = content.paragraphs.map((text) => `<p style="font-size:16px;line-height:1.6;margin:0 0 14px">${escapeHtml(text)}</p>`).join('');
  const highlight = content.highlight ? `<p style="font-size:34px;font-weight:700;letter-spacing:8px;margin:18px 0;font-family:Menlo,Consolas,monospace">${escapeHtml(content.highlight)}</p>` : '';
  const button = content.button ? `<p style="margin:22px 0"><a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:${accent};color:#fff;text-decoration:none;font-weight:700">${escapeHtml(content.button.label)}</a></p>` : '';
  const contact = [context.brand.supportPhone, context.brand.supportEmail].filter(Boolean).map((value) => escapeHtml(value!)).join(' · ');
  return `<!doctype html><html lang="en-GB"><body style="margin:0;background:#f2f2ef;font-family:Arial,sans-serif;color:#172033"><span style="display:none;max-height:0;overflow:hidden">${escapeHtml(content.preheader)}</span><table role="presentation" width="100%"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="600" style="max-width:600px;width:100%"><tr><td style="padding-bottom:18px">${logo}</td></tr><tr><td style="background:#fff;border-radius:20px;overflow:hidden"><div style="height:6px;background:${accent}"></div><div style="padding:30px 32px"><h1 style="margin:0 0 14px;font-size:24px">${escapeHtml(content.heading)}</h1>${paragraphs}${highlight}${button}<p style="font-size:13px;line-height:1.6;color:#6b7178;margin:18px 0 0">${escapeHtml(content.footnote)}</p></div></td></tr><tr><td style="padding:20px 8px;font-size:12px;line-height:1.6;color:#6b7178"><strong>${escapeHtml(context.brand.name)}</strong>${contact ? ` · ${contact}` : ''}</td></tr></table></td></tr></table></body></html>`;
}

function renderText(content: EmailContent): string {
  return [content.heading, '', ...content.paragraphs, ...(content.highlight ? ['', content.highlight] : []), ...(content.button ? ['', `${content.button.label}: ${content.button.url}`] : []), '', content.footnote].join('\n');
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function longDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(epochMs));
}
