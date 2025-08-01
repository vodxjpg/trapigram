// src/app/admin/api-tester/page.tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

export default function ApiTester() {
  const [endpoint, setEndpoint] = useState<string>("/api/fee-rates")
  const [body, setBody] = useState<string>("{}")
  const [apiKey, setApiKey] = useState<string>("")
  const [timestamp, setTimestamp] = useState<string>("")
  const [signature, setSignature] = useState<string>("")
  const [response, setResponse] = useState<string>("")
  const [loading, setLoading] = useState<boolean>(false)

  async function callApi() {
    setLoading(true)
    setResponse("")
    try {
      const res = await fetch(endpoint, {
        method: body.trim() ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey && { "x-api-key": apiKey }),
          ...(timestamp && { "x-timestamp": timestamp }),
          ...(signature && { "x-signature": signature }),
        },
        body: body.trim() ? body : undefined,
      })
      const text = await res.text()
      setResponse(`Status: ${res.status}\n\n${text}`)
    } catch (err: any) {
      setResponse(`Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Internal API Tester</h1>

      <div className="space-y-2">
        <label className="block font-medium">Endpoint</label>
        <input
          type="text"
          value={endpoint}
          onChange={e => setEndpoint(e.target.value)}
          className="w-full border px-2 py-1"
        />
      </div>

      <div className="space-y-2">
        <label className="block font-medium">Request Body (JSON)</label>
        <textarea
          rows={4}
          value={body}
          onChange={e => setBody(e.target.value)}
          className="w-full border p-2 font-mono"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1">
          <label className="block font-medium">x-api-key</label>
          <input
            type="text"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            className="w-full border px-2 py-1"
          />
        </div>
        <div className="space-y-1">
          <label className="block font-medium">x-timestamp</label>
          <input
            type="text"
            value={timestamp}
            onChange={e => setTimestamp(e.target.value)}
            className="w-full border px-2 py-1"
          />
        </div>
        <div className="space-y-1">
          <label className="block font-medium">x-signature</label>
          <input
            type="text"
            value={signature}
            onChange={e => setSignature(e.target.value)}
            className="w-full border px-2 py-1"
          />
        </div>
      </div>

      <Button onClick={callApi} disabled={loading}>
        {loading ? "Calling…" : "Call API"}
      </Button>

      <div>
        <label className="block font-medium">Response</label>
        <pre className="bg-gray-100 p-2 font-mono whitespace-pre-wrap">
          {response}
        </pre>
      </div>
    </div>
  )
}
