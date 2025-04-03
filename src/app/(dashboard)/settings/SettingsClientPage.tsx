"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import { ProfileForm } from "@/components/settings/profile-form"
import { AccountForm } from "@/components/settings/account-form"
import { AppearanceForm } from "@/components/settings/appearance-form"
import { NotificationsForm } from "@/components/settings/notifications-form"
import { useEffect } from "react"

export default function SettingsClientPage() {
  // This will update the header title in your HeaderTitleContext
  useEffect(() => {
    const event = new CustomEvent("update-header-title", {
      detail: { title: "Settings", description: "Manage your account settings and preferences" },
    })
    window.dispatchEvent(event)
  }, [])

  return (
    <div className="container max-w-6xl py-6 space-y-6 m-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account settings and set your preferences.</p>
      </div>
      <Separator />
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full md:w-auto md:inline-flex grid-cols-2 md:grid-cols-4 gap-2 h-auto">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>
        <div className="mt-6">
          <TabsContent value="profile" className="space-y-6">
            <ProfileForm />
          </TabsContent>
          <TabsContent value="account" className="space-y-6">
            <AccountForm />
          </TabsContent>
          <TabsContent value="appearance" className="space-y-6">
            <AppearanceForm />
          </TabsContent>
          <TabsContent value="notifications" className="space-y-6">
            <NotificationsForm />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

