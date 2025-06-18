// src/components/settings/api-key-input.tsx
"use client";

import React, { useState, useEffect } from "react";
import { Eye, EyeOff, Copy, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import toast from "react-hot-toast";
import { useUser } from "@/hooks/use-user"; // hook for current user

export function ApiKeyGenerator() {
  const { user, isLoading: userLoading } = useUser();
  const [apiKey, setApiKey] = useState("");
  const [apiKeyName, setApiKeyName] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [loadingGenerate, setLoadingGenerate] = useState(false);
  const [loadingUpdate, setLoadingUpdate] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [currentKeyId, setCurrentKeyId] = useState<string | null>(null);
  const [fullKeys, setFullKeys] = useState<Record<string, string>>({});

  // don't allow guests at all
  if (userLoading) return null;
  if (user?.is_guest) {
    return (
      <p className="text-center text-red-600">
        Guest accounts cannot manage API keys.
      </p>
    );
  }

  useEffect(() => {
    fetchApiKeys();
  }, []);

  const fetchApiKeys = async () => {
    try {
      const { data, error } = await authClient.apiKey.list();
      if (error) {
        toast.error("Failed to load API keys.");
        return;
      }
      setApiKeys(data || []);
      if (data && data.length > 0 && !apiKey) {
        const latestKey = data[data.length - 1];
        setCurrentKeyId(latestKey.id);
      }
    } catch {
      toast.error("Unexpected error while fetching API keys.");
    }
  };

  const toggleVisibility = () => setShowApiKey((v) => !v);

  const handleGenerate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoadingGenerate(true);
    const isDuplicate = apiKeys.some((k) => k.name === apiKeyName);
    if (isDuplicate) {
      toast.error("An API key with this name already exists.");
      setLoadingGenerate(false);
      return;
    }
    try {
      const { data, error } = await authClient.apiKey.create({
        name: apiKeyName,
        expiresIn: 60 * 60 * 24 * 30,
        prefix: "tp_",
        metadata: { createdBy: "user" },
      });
      if (error) {
        toast.error(error.message || "Failed to generate API key.");
      } else if (data) {
        setApiKey(data.key);
        setCurrentKeyId(data.id);
        setFullKeys((p) => ({ ...p, [data.id]: data.key }));
        await fetchApiKeys();
        toast.success("API key generated successfully!");
      }
    } catch {
      toast.error("Unexpected error while generating API key.");
    } finally {
      setLoadingGenerate(false);
    }
  };

  const handleUpdate = async () => {
    if (!currentKeyId) {
      toast.error("No API key selected to update.");
      return;
    }
    setLoadingUpdate(true);
    try {
      const { data, error } = await authClient.apiKey.update({
        keyId: currentKeyId,
        name: apiKeyName,
      });
      if (error) {
        toast.error(error.message || "Failed to update API key.");
      } else {
        setApiKey("");
        setApiKeyName("");
        setCurrentKeyId(null);
        await fetchApiKeys();
        toast.success("API key updated successfully!");
      }
    } catch {
      toast.error("Unexpected error while updating API key.");
    } finally {
      setLoadingUpdate(false);
    }
  };

  const handleDelete = async (keyId: string) => {
    setLoadingDelete(keyId);
    try {
      const { data, error } = await authClient.apiKey.delete({ keyId });
      if (error) {
        toast.error(error.message || "Failed to delete API key.");
      } else if (data.success) {
        await fetchApiKeys();
        if (currentKeyId === keyId) {
          setApiKey("");
          setApiKeyName("");
          setCurrentKeyId(null);
        }
        setFullKeys((prev) => {
          const next = { ...prev };
          delete next[keyId];
          return next;
        });
        toast.success("API key deleted successfully!");
      }
    } catch {
      toast.error("Unexpected error while deleting API key.");
    } finally {
      setLoadingDelete(null);
    }
  };

  const handleCopy = (keyId: string) => {
    const full = fullKeys[keyId];
    if (full) {
      navigator.clipboard.writeText(full)
        .then(() => toast.success("Full API key copied!"))
        .catch(() => toast.error("Failed to copy API key."));
    } else {
      const k = apiKeys.find((k) => k.id === keyId);
      navigator.clipboard.writeText(k.start + "...")
        .then(() => toast.error("Partial key copied. Regenerate to get full."))
        .catch(() => toast.error("Failed to copy API key."));
    }
  };

  return (
    <div className="space-y-6">
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
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 h-full px-3"
              onClick={toggleVisibility}
              aria-label={showApiKey ? "Hide API key" : "Show API key"}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="flex space-x-4">
          <Button type="submit" disabled={loadingGenerate || !apiKeyName.trim()}>
            {loadingGenerate ? "Generating..." : "Generate API Key"}
          </Button>
          <Button
            type="button"
            disabled={loadingUpdate || !apiKeyName.trim() || !currentKeyId}
            onClick={handleUpdate}
          >
            {loadingUpdate ? "Updating..." : "Update API Key"}
          </Button>
        </div>
      </form>

      {apiKeys.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Your API Keys</h3>
          <p className="text-sm text-muted-foreground">
            Full keys are only available right after creation. Regenerate older keys to reveal.
          </p>
          <ul className="space-y-2">
            {apiKeys.map((key) => (
              <li key={key.id} className="flex items-center justify-between p-2 border rounded-md">
                <div>
                  <p className="font-medium">{key.name}</p>
                  <p className="text-sm text-muted-foreground">{key.start}…</p>
                </div>
                <div className="flex space-x-2">
                  <Button variant="outline" size="sm" onClick={() => handleCopy(key.id)}>
                    <Copy className="h-4 w-4 mr-1" /> Copy
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(key.id)}
                    disabled={loadingDelete === key.id}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    {loadingDelete === key.id ? "Deleting…" : "Delete"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
