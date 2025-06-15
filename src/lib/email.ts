// src/lib/email.ts
import { Resend } from 'resend'

/**
 * Very-light sanity check – avoids hitting the API with an empty /
 * obviously-bad address.
 */
const isPlausibleEmail = (addr: string | undefined | null): addr is string =>
  !!addr && /.+@.+\..+/.test(addr)

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}) {
  if (!/.+@.+\..+/.test(to)) return

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'no-reply@trapigram.com',
      to,
      subject,
      html,
    }),
  })

  if (!res.ok) {
    console.error('[sendEmail] failed', await res.text())
    return
  }

  console.log('[sendEmail] success', await res.json())
}
