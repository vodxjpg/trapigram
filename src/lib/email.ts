import nodemailer from "nodemailer";

export async function sendEmail({ to, subject, text }: { to: string; subject: string; text: string }) {
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

  // Send the email
  const info = await transporter.sendMail({
    from: '"Trapigram" <no-reply@trapigram.com>', // Sender address
    to, // Recipient
    subject, // Subject line
    text, // Plain text body
  });

  // Log the preview URL to view the sent email
  console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
}