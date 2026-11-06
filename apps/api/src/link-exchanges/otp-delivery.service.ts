import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class OtpDeliveryService {
  async send(email: string, code: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.info(`[Vision Trips local OTP] ${email}: ${code}`);
      return;
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.VISION_EMAIL_FROM || 'Vision Trips <onboarding@resend.dev>', to: [email], subject: 'Your Vision Trips verification code', html: `<p>Your verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>It expires in 10 minutes. If you did not request it, you can ignore this email.</p>` }),
    });
    if (!response.ok) throw new ServiceUnavailableException('We could not send the verification email. Please try again.');
  }
}
