// src/lib/email.ts
/**
 * A very light sanity check – avoids hitting the API with an empty /
 * obviously-bad address (which would 4xx on Resend).
 */
const isPlausibleEmail = (addr: string | undefined | null): addr is string =>
  !!addr && /.+@.+\..+/.test(addr)

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string
  subject: string
  text?: string
  html?: string
}) {
  if (!isPlausibleEmail(to)) {
    console.warn('[sendEmail] skipped – no valid recipient')
    return
  }

  // Build a payload that includes text or html ( both)
  const payload: Record<string, any> = {
    from: 'no-reply@trapyfy.com',
    to,
    subject,
  }
  if (text) payload.text = text
  if (html) payload.html = html

  // Make sure we have at least one
  if (!payload.text && !payload.html) {
    console.error('[sendEmail] failed – neither text nor html was provided')
    return
  }

  // Fire off the REST call
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    console.error('[sendEmail] failed', await res.text())
    return
  }

  console.log('[sendEmail] success', await res.json())
}
