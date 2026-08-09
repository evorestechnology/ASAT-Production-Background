import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

export function getMailTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host: host,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    auth: {
      user: user,
      pass: pass,
    },
  });
}

/**
 * Sends order cancellation email to user
 */
export async function sendOrderCancellationEmail(customerEmail, orderId, reason) {
  if (!customerEmail) {
    console.warn(`[EMAIL CANCELLED] No customer email provided for Order #${orderId}`);
    return;
  }

  const transporter = getMailTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '"ASAT Studio" <noreply@as-simple-as-that.com>',
    to: customerEmail.trim(),
    subject: `Important Update Regarding Your Order #${orderId}`,
    text: `Dear Customer,

We are so sorry to inform you that your order #${orderId} was cancelled due to some issues (${reason || 'Manufacturing constraint'}).

The full order amount will be refunded to your account within 48 hours.

If you have any questions, please feel free to reach out to us.

Best regards,
ASAT Team`,
    html: `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background: #ffffff;">
        <div style="background: #121212; color: #C5A059; padding: 24px; text-align: center;">
          <h2 style="margin: 0; font-family: 'Cinzel', serif; letter-spacing: 2px;">AS SIMPLE AS THAT</h2>
          <p style="margin: 4px 0 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Order Cancellation Notice</p>
        </div>
        <div style="padding: 30px; color: #333; line-height: 1.6;">
          <h3 style="color: #d9534f; margin-top: 0;">Order Cancellation & Refund Notice</h3>
          <p>Dear Customer,</p>
          <p>We are so sorry to inform you that your order <strong>#${orderId}</strong> was cancelled due to some issues${reason ? ` (<em>${reason}</em>)` : ''}.</p>
          
          <div style="background: #fff8f8; border-left: 4px solid #d9534f; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <p style="margin: 0; font-weight: bold; color: #b91c1c;">Refund Information:</p>
            <p style="margin: 5px 0 0 0; font-size: 14px;">The order amount will be refunded to your original payment account within <strong>48 hours</strong>.</p>
          </div>

          <p>We sincerely apologize for any inconvenience this may cause. If you have any questions, please contact our support team.</p>

          <p style="margin-top: 30px; font-size: 13px; color: #666;">Warm regards,<br/><strong>ASAT Team</strong></p>
        </div>
      </div>
    `
  };

  if (!transporter) {
    console.log(`\n======================================================`);
    console.log(`[SIMULATED EMAIL DISPATCH TO USER]`);
    console.log(`TO: ${customerEmail}`);
    console.log(`SUBJECT: ${mailOptions.subject}`);
    console.log(`BODY: We are so sorry to inform that the order #${orderId} was cancelled due to some issues. The amount will be refunded within 48 hours.`);
    console.log(`======================================================\n`);
    return { simulated: true };
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL SENT] Successfully sent order cancellation email to ${customerEmail} (Message ID: ${info.messageId})`);
    return info;
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed to send email to ${customerEmail}:`, err.message);
  }
}

/**
 * Sends Admin Invitation email
 */
export async function sendAdminInviteEmail(adminEmail, displayName, role, inviteLink) {
  if (!adminEmail) return;

  const transporter = getMailTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '"ASAT Admin Portal" <noreply@as-simple-as-that.com>',
    to: adminEmail.trim(),
    subject: `You have been invited to join ASAT as an Admin (${role || 'Admin'})`,
    text: `Hello ${displayName || 'Admin'},

You have been invited to join the ASAT Administrative Portal with the role of "${role || 'Support Admin'}".

You can access the Master Admin Portal here:
${inviteLink || 'https://as-simple-as-that.com/master/login'}

Best regards,
ASAT Master Administration`,
    html: `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background: #ffffff;">
        <div style="background: #121212; color: #C5A059; padding: 24px; text-align: center;">
          <h2 style="margin: 0; font-family: 'Cinzel', serif; letter-spacing: 2px; color: #C5A059;">AS SIMPLE AS THAT</h2>
          <p style="margin: 4px 0 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Administrative Access Invitation</p>
        </div>
        <div style="padding: 30px; color: #333; line-height: 1.6;">
          <h3 style="color: #121212; margin-top: 0;">Welcome to the ASAT Admin Team</h3>
          <p>Hello <strong>${displayName || 'Admin'}</strong>,</p>
          <p>You have been invited to join the <strong>ASAT Master Portal</strong> as a <strong>${(role || 'support').toUpperCase()}</strong> administrator.</p>
          
          <div style="background: #fdfbf7; border: 1px solid rgba(197,160,89,0.3); padding: 20px; margin: 24px 0; border-radius: 6px; text-align: center;">
            <p style="margin: 0 0 15px 0; font-size: 14px; color: #666;">Click the button below to access the admin portal and configure your account:</p>
            <a href="${inviteLink || 'https://as-simple-as-that.com/master/login'}" style="background: #C5A059; color: #000; padding: 12px 28px; text-decoration: none; font-weight: bold; border-radius: 4px; display: inline-block; letter-spacing: 1px; font-size: 14px; text-transform: uppercase;">
              Access Admin Portal
            </a>
          </div>

          <p style="font-size: 13px; color: #777;">If you have any questions or did not expect this invitation, please contact the Master Admin.</p>
          <p style="margin-top: 30px; font-size: 13px; color: #666;">Warm regards,<br/><strong>ASAT Master Team</strong></p>
        </div>
      </div>
    `
  };

  if (!transporter) {
    console.log(`\n======================================================`);
    console.log(`[SIMULATED ADMIN INVITE EMAIL DISPATCH]`);
    console.log(`TO: ${adminEmail}`);
    console.log(`ROLE: ${role}`);
    console.log(`LINK: ${inviteLink || '/master/login'}`);
    console.log(`======================================================\n`);
    return { simulated: true };
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL SENT] Successfully sent admin invite email to ${adminEmail} (Message ID: ${info.messageId})`);
    return info;
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed to send admin invite email to ${adminEmail}:`, err.message);
  }
}
