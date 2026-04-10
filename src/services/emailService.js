const nodemailer = require('nodemailer');

// ─── TRANSPORTER CONFIG ───────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

/**
 * Sends a notification email to the admin when a new support ticket is created.
 */
async function sendAdminNotification(report) {
  const adminEmail = process.env.GMAIL_USER || 'jaredcuerbo21@gmail.com';
  
  const mailOptions = {
    from: `"Animexis Support" <${process.env.GMAIL_USER}>`,
    to: adminEmail,
    subject: `[Support Ticket] ${report.title}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; color: #333;">
        <h2 style="color: #DC143C;">New Support Ticket</h2>
        <p><strong>From:</strong> ${report.email}</p>
        <p><strong>Type:</strong> ${report.type.toUpperCase()}</p>
        <p><strong>Title:</strong> ${report.title}</p>
        <hr style="border: none; border-top: 1px solid #eee;" />
        <p style="white-space: pre-wrap;">${report.description}</p>
        <hr style="border: none; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #999;">
          Submitted at: ${new Date(report.createdAt).toLocaleString()}
        </p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`[Email] Support notification sent to ${adminEmail}`);
  } catch (error) {
    console.error('[Email] Failed to send admin notification:', error);
  }
}

module.exports = {
  sendAdminNotification,
};
