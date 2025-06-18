// src/app/(dashboard)/settings/SettingsClientPage.tsx
"use client";

import { useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ProfileForm } from "@/components/settings/profile-form";
import { AccountForm } from "@/components/settings/account-form";
import { ApiKeyGenerator } from "@/components/settings/api-key-input";
import { useUser } from "@/hooks/use-user"; // your hook for current user

export default function SettingsClientPage() {
  const { user, isLoading: userLoading } = useUser();

  // update header title
  useEffect(() => {
    const event = new CustomEvent("update-header-title", {
      detail: {
        title: "Settings",
        description: "Manage your account settings and preferences",
      },
    });
    window.dispatchEvent(event);
  }, []);

  if (userLoading) return null;

  const isGuest = user?.is_guest === true;

  return (
    <div className="container max-w-6xl py-6 px-6 space-y-6 m-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and set your preferences.
        </p>
      </div>
      <Separator />
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full md:w-auto md:inline-flex grid-cols-2 md:grid-cols-4 gap-2 h-auto">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          {!isGuest && <TabsTrigger value="apikey">API Key Configuration</TabsTrigger>}
        </TabsList>

        <div className="mt-6">
          <TabsContent value="profile" className="space-y-6">
            <ProfileForm />
          </TabsContent>

          <TabsContent value="account" className="space-y-6">
            <AccountForm />
          </TabsContent>

          {!isGuest && (
            <TabsContent value="apikey" className="space-y-6">
              <ApiKeyGenerator />
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}
