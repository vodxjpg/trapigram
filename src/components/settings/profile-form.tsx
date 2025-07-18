{"use client"};

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { toast } from "react-hot-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth-client";

const profileFormSchema = z.object({
  username: z
    .string()
    .min(2, {
      message: "Username must be at least 2 characters.",
    })
    .max(30, {
      message: "Username must not be longer than 30 characters.",
    }),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

// Fetch session data on mount
export function ProfileForm() {
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<any>(null); // Use any temporarily for session type
  const [formLoaded, setFormLoaded] = useState(false);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      username: "",
    }, // Initial empty value, will be reset after session load
    mode: "onChange",
  });

  useEffect(() => {
    const fetchSession = async () => {
      const { data, error } = await authClient.getSession();
      if (error) {
        console.error("Session error:", error);
      } else if (data) {
        setSession(data);
        // Reset form with session data
        form.reset({
          username: data.user.name || "",
        });
        setFormLoaded(true); // Only set formLoaded when session data is valid
      }
      setIsLoading(false);
    };
    fetchSession();
  }, [form]);

  async function onSubmit(data: ProfileFormValues) {
    setIsLoading(true);

    try {
      if (!session?.user?.id) {
        throw new Error("User session not found");
      }

      const response = await fetch("/api/users/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: session.user.id,
          name: data.username,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to update name");

      toast.success("Name updated successfully!");
      console.log("Updated name:", data.username);

      setSession((prev: any) => prev ? { ...prev, user: { ...prev.user, name: data.username } } : prev);
    } catch (err) {
      toast.error((err as Error).message || "An error occurred");
      console.error("Update error:", err);
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading || !formLoaded) {
    return <div>Loading profile...</div>; // Simple loading state
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
          <CardDescription>
            Update your name. This information will be displayed publicly. Email
            is read-only and can only be changed by contacting support.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid gap-5">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Full name</FormLabel>
                      <FormControl>
                        <Input placeholder="john doe" {...field} />
                      </FormControl>
                      <FormDescription>
                        Please use your full real name. This is used for invoicing.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Display email as read-only outside the form validation */}
                <div>
                  <FormLabel>Email</FormLabel>
                  <Input
                    disabled={true}
                    value={session?.user?.email || ""}
                    placeholder="john.doe@example.com"
                  />
                  <FormDescription>
                    You need to contact support to change this. We'll never share
                    your email with anyone else.
                  </FormDescription>
                </div>
              </div>
              <CardFooter className="px-0 pb-0">
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? "Saving..." : "Save changes"}
                </Button>
              </CardFooter>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}