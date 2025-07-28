import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: { channel: string } }) {
  const channel = params.channel;
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/subscribe/${channel}`;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Check if the token is available
  if (!token) {
    console.error('[SSE Proxy] Authentication token is missing');
    return NextResponse.json({ error: 'Authentication token is missing' }, { status: 500 });
  }

  // Fetch the SSE stream from Upstash with the token
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  // Handle fetch errors
  if (!response.ok) {
    console.error('[SSE Proxy] Failed to subscribe to Upstash:', response.statusText);
    return NextResponse.json({ error: 'Failed to subscribe to Upstash' }, { status: response.status });
  }

  const reader = response.body?.getReader();
  if (!reader) {
    console.error('[SSE Proxy] No response body from Upstash');
    return NextResponse.json({ error: 'No response body' }, { status: 500 });
  }

  // Create a readable stream to forward SSE data
  const stream = new ReadableStream({
    async start(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        controller.enqueue(value);
      }
      controller.close();
    },
  });

  // Return the stream with SSE headers
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}