"use client"

import type React from "react"
import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

export function ApiKeyGenerator() {
  // State to store the API key, its name, visibility toggle, loading flags, and any errors.
  const [apiKey, setApiKey] = useState("")
  const [apiKeyName, setApiKeyName] = useState("")
  const [showApiKey, setShowApiKey] = useState(false)
  const [loadingGenerate, setLoadingGenerate] = useState(false)
  const [loadingUpdate, setLoadingUpdate] = useState(false)
  const [loadingGet, setLoadingGet] = useState(false)
  const [error, setError] = useState("")

  // Toggle the API key visibility (text vs. password field).
  const toggleVisibility = () => {
    setShowApiKey(!showApiKey)
  }

  // Handler to generate a new API key.
  const handleGenerate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoadingGenerate(true)
    setError("")

    try {
      const response = await fetch("/api/auth/apikey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: apiKeyName }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || "Failed to generate API key.")
      } else {
        const data = await response.json()
        setApiKey(data.apiKey)
      }
    } catch (err) {
      setError("An unexpected error occurred while generating API key.")
    } finally {
      setLoadingGenerate(false)
    }
  }

  // Handler to update (regenerate) the API key.
  const handleUpdate = async () => {
    setLoadingUpdate(true)
    setError("")

    try {
      const response = await fetch("/api/auth/apikey/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: apiKeyName }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || "Failed to update API key.")
      } else {
        const data = await response.json()
        setApiKey(data.apiKey)
      }
    } catch (err) {
      setError("An unexpected error occurred while updating API key.")
    } finally {
      setLoadingUpdate(false)
    }
  }

  const handleGet = async () => {
    setLoadingGet(true)
    setError("")

    try {
      const response = await fetch("/api/auth/apikey", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        }
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.log(errorData)
      } else {
        const data = await response.json()
        console.log(data)
      }
    } catch (err) {
      setError("An unexpected error occurred while updating API key.")
    } finally {
      setLoadingUpdate(false)
    }
  }

  return (
    <form onSubmit={handleGenerate} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="apiKeyName">API Key Name</Label>
        <Input
          id="apiKeyName"
          type="text"
          value={apiKeyName}
          onChange={(e) => setApiKeyName(e.target.value)}
          placeholder="Enter a name for your API key"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">API Key</Label>
        <div className="relative">
          <Input
            id="apiKey"
            type={showApiKey ? "text" : "password"}
            value={apiKey}
            readOnly
            placeholder="Your API key will appear here"
            className="pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 h-full px-3"
            onClick={toggleVisibility}
            aria-label={showApiKey ? "Hide API key" : "Show API key"}
          >
            {showApiKey ? (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
      </div>

      {/* Buttons for generating and updating the API key */}
      <div className="flex space-x-4">
        <Button type="submit" disabled={loadingGenerate || apiKeyName.trim() === ""}>
          {loadingGenerate ? "Generating API key..." : "Generate API Key"}
        </Button>
        <Button type="button" disabled={loadingUpdate || apiKeyName.trim() === ""} onClick={handleUpdate}>
          {loadingUpdate ? "Updating API key..." : "Update API Key"}
        </Button>
        <Button type="button" onClick={handleGet}>
          {loadingGet ? "Getting API key..." : "Get API Key"}
        </Button>
      </div>

      {error && <p className="text-red-500">{error}</p>}
    </form>
  )
}
