// src/lib/email.ts
/**
 * A very light sanity check – avoids hitting the API with an empty /
 * obviously-bad address (which would 4xx on Resend).
 */
const isPlausibleEmail = (addr: string | undefined | null): addr is string =>
  !!addr && /.+@.+\..+/.test(addr)

type ResendAttachment = {
  filename: string
  /** Base64-encoded content (no data: prefix) */
  content: string
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
  attachments,
}: {
  to: string
  subject: string
  text?: string
  html?: string
  /** Optional attachments for Resend: filename + base64 content */
  attachments?: ResendAttachment[]
}) {
  if (!isPlausibleEmail(to)) {
    console.warn('[sendEmail] skipped – no valid recipient')
    return
  }

  // Build payload for Resend API
  const payload: Record<string, any> = {
    from: 'no-reply@trapyfy.com',
    to,
    subject,
  }
  if (text) payload.text = text
  if (html) payload.html = html
  if (attachments && attachments.length) {
    // Resend expects [{ filename, content (base64) }]
    payload.attachments = attachments.map(a => ({
      filename: a.filename,
      content: a.content,
    }))
  }

  // Make sure we have at least one of text/html
  if (!payload.text && !payload.html) {
    console.error('[sendEmail] failed – neither text nor html was provided')
    return
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[sendEmail] failed – RESEND_API_KEY is not set')
    return
  }

  // Fire off the REST call
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    console.error('[sendEmail] failed', await res.text())
    return
  }

  console.log('[sendEmail] success', await res.json())
}
