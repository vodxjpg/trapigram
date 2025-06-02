// src/lib/email.ts
import nodemailer from "nodemailer";

/**
 * Very-light sanity check – avoids hitting nodemailer with an empty /
 * obviously-bad address (which raises EENVELOPE).
 */
const isPlausibleEmail = (addr: string | undefined | null): addr is string =>
  !!addr && /.+@.+\..+/.test(addr);

export async function sendEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}) {
  /* -------------------------------------------------------------- */
  /* guard-rail – skip when no usable “to”                           */
  /* -------------------------------------------------------------- */
  if (!isPlausibleEmail(to)) {
    console.warn("[sendEmail] skipped – no valid recipient");
    return;
  }

  // Create a test account with Ethereal
  const testAccount = await nodemailer.createTestAccount();

  // Set up the transporter using Ethereal's SMTP while we are in local.
  const transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false, // Use TLS
    auth: {
      user: testAccount.user, // Ethereal test user
      pass: testAccount.pass, // Ethereal test password
    },
  });

  try {
    // Send the email
    const info = await transporter.sendMail({
      from: '"Trapigram" <no-reply@trapigram.com>',
      to,
      subject,
      text,
    });

    // Log the preview URL to view the sent email
    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
  } catch (err) {
    /* swallow bad-address errors so they never bubble to /api/order  */
    console.error("[sendEmail] nodemailer error:", err);
  }
}
