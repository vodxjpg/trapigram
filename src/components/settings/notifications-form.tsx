"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel } from "@/components/ui/form"
import { toast } from "react-hot-toast"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { useState } from "react"
import { Separator } from "@/components/ui/separator"

const notificationsFormSchema = z.object({
  emailNotifications: z.object({
    comments: z.boolean().default(true),
    mentions: z.boolean().default(true),
    follows: z.boolean().default(true),
    directMessages: z.boolean().default(true),
    marketing: z.boolean().default(false),
  }),
  pushNotifications: z.object({
    comments: z.boolean().default(true),
    mentions: z.boolean().default(true),
    follows: z.boolean().default(true),
    directMessages: z.boolean().default(true),
  }),
})

type NotificationsFormValues = z.infer<typeof notificationsFormSchema>

const defaultValues: NotificationsFormValues = {
  emailNotifications: {
    comments: true,
    mentions: true,
    follows: true,
    directMessages: true,
    marketing: false,
  },
  pushNotifications: {
    comments: true,
    mentions: true,
    follows: true,
    directMessages: true,
  },
}

export function NotificationsForm() {
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<NotificationsFormValues>({
    resolver: zodResolver(notificationsFormSchema),
    defaultValues,
    mode: "onChange",
  })

  function onSubmit(data: NotificationsFormValues) {
    setIsLoading(true)

    // Simulate API call
    setTimeout(() => {
      toast.success("Notification preferences updated!")
      setIsLoading(false)
      console.log(data)
    }, 1000)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Configure how you receive notifications and updates.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div>
              <h3 className="text-lg font-medium">Email Notifications</h3>
              <p className="text-sm text-muted-foreground mb-4">Configure which email notifications you receive.</p>
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="emailNotifications.comments"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Comments</FormLabel>
                        <FormDescription>Receive emails when someone comments on your posts.</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="emailNotifications.mentions"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Mentions</FormLabel>
                        <FormDescription>Receive emails when someone mentions you.</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="emailNotifications.follows"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Follows</FormLabel>
                        <FormDescription>Receive emails when someone follows you.</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="emailNotifications.directMessages"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Direct Messages</FormLabel>
                        <FormDescription>Receive emails when someone sends you a direct message.</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="emailNotifications.marketing"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Marketing</FormLabel>
                        <FormDescription>Receive emails about new features and updates.</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-lg font-medium">Push Notifications</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Configure which push notifications you receive on your device.
              </p>
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="pushNotifications.comments"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Comments</FormLabel>
                        <FormDescription>
                          Receive push notifications when someone comments on your posts.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="pushNotifications.mentions"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Mentions</FormLabel>
                        <FormDescription>Receive push notifications when someone mentions you.</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="pushNotifications.follows"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Follows</FormLabel>
                        <FormDescription>Receive push notifications when someone follows you.</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="pushNotifications.directMessages"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Direct Messages</FormLabel>
                        <FormDescription>
                          Receive push notifications when someone sends you a direct message.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <CardFooter className="px-0 pb-0">
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Saving..." : "Save preferences"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

