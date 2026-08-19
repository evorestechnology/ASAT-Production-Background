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
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '"ASAT Designer Paradise" <noreply@as-simple-as-that.com>',
    to: customerEmail.trim(),
    subject: `Important Update Regarding Your Order #${orderId}`,
    text: `Dear Customer,

We are so sorry to inform you that your order #${orderId} was cancelled due to some issues (${reason || 'Manufacturing constraint'}).

The full order amount will be refunded to your account within 48 hours.

If you have any questions, please feel free to reach out to us.

Best regards,
ASAT Designer Paradise Team`,
    html: `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background: #ffffff;">
        <div style="background: #121212; color: #C5A059; padding: 24px; text-align: center;">
          <h2 style="margin: 0; font-family: 'Cinzel', serif; letter-spacing: 2px;">ASAT DESIGNER PARADISE</h2>
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

          <p style="margin-top: 30px; font-size: 13px; color: #666;">Warm regards,<br/><strong>ASAT Designer Paradise Team</strong></p>
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
 * Sends Admin Invitation email with login credentials
 */
export async function sendAdminInviteEmail(adminEmail, displayName, role, temporaryPassword, inviteLink) {
  if (!adminEmail) return;

  const loginUrl = inviteLink || 'https://asat-production-frontend.vercel.app/master/login';
  const transporter = getMailTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '"ASAT Designer Paradise Portal" <noreply@as-simple-as-that.com>',
    to: adminEmail.trim(),
    subject: `Welcome to ASAT Designer Paradise Admin Team - Your Login Credentials (${role || 'Admin'})`,
    text: `Hello ${displayName || 'Admin'},

You have been invited to join the ASAT Designer Paradise Administrative Portal with the role of "${role || 'Support Admin'}".

Here are your login credentials:
Portal URL: ${loginUrl}
Email: ${adminEmail.trim()}
Temporary Password: ${temporaryPassword || 'Admin@123456'}

Please log in and update your password upon your first sign-in.

Best regards,
ASAT Designer Paradise Administration`,
    html: `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; background: #ffffff;">
        <div style="background: #121212; color: #C5A059; padding: 24px; text-align: center;">
          <h2 style="margin: 0; font-family: 'Cinzel', serif; letter-spacing: 2px; color: #C5A059;">ASAT DESIGNER PARADISE</h2>
          <p style="margin: 4px 0 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #888;">Administrative Access & Credentials</p>
        </div>
        <div style="padding: 30px; color: #333; line-height: 1.6;">
          <h3 style="color: #121212; margin-top: 0;">Welcome to the ASAT Designer Paradise Admin Team</h3>
          <p>Hello <strong>${displayName || 'Admin'}</strong>,</p>
          <p>You have been appointed to the <strong>ASAT Designer Paradise Master Portal</strong> as a <strong>${(role || 'support').toUpperCase()}</strong> administrator.</p>
          
          <div style="background: #fdfbf7; border: 1px solid rgba(197,160,89,0.3); padding: 20px; margin: 24px 0; border-radius: 6px;">
            <p style="margin: 0 0 12px 0; font-size: 13px; font-weight: bold; color: #121212; text-transform: uppercase; letter-spacing: 1px;">Your Login Credentials:</p>
            <div style="background: #ffffff; border: 1px solid #e5e5e5; border-radius: 4px; padding: 14px 18px; margin-bottom: 16px;">
              <p style="margin: 0 0 8px 0; font-size: 14px;"><strong>Email:</strong> <span style="color: #4f46e5;">${adminEmail.trim()}</span></p>
              <p style="margin: 0 0 8px 0; font-size: 14px;"><strong>Temporary Password:</strong> <code style="background: #f3f4f6; padding: 3px 8px; border-radius: 4px; font-size: 15px; color: #d97706; font-weight: bold;">${temporaryPassword || 'Admin@123456'}</code></p>
              <p style="margin: 0; font-size: 14px;"><strong>Role:</strong> <span style="text-transform: capitalize;">${role || 'Support Admin'}</span></p>
            </div>
            <div style="text-align: center; margin-top: 20px;">
              <a href="${loginUrl}" style="background: #C5A059; color: #000; padding: 12px 28px; text-decoration: none; font-weight: bold; border-radius: 4px; display: inline-block; letter-spacing: 1px; font-size: 14px; text-transform: uppercase;">
                Sign In to Master Portal
              </a>
            </div>
          </div>

          <p style="font-size: 13px; color: #777;">🔒 <em>For security purposes, please log in and change your password in the account settings after your first sign in.</em></p>
          <p style="margin-top: 30px; font-size: 13px; color: #666;">Warm regards,<br/><strong>ASAT Designer Paradise Team</strong></p>
        </div>
      </div>
    `
  };

  if (!transporter) {
    console.log(`\n======================================================`);
    console.log(`[SIMULATED ADMIN INVITE EMAIL DISPATCH]`);
    console.log(`TO: ${adminEmail}`);
    console.log(`ROLE: ${role}`);
    console.log(`PASS: ${temporaryPassword}`);
    console.log(`LINK: ${loginUrl}`);
    console.log(`======================================================\n`);
    return { simulated: true };
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL SENT] Successfully sent admin credentials email to ${adminEmail} (Message ID: ${info.messageId})`);
    return info;
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed to send admin invite email to ${adminEmail}:`, err.message);
  }
}
