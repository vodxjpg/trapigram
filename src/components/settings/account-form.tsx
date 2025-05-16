"use client";

import * as React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
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
import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import zxcvbn from "zxcvbn";

const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(8, {
      message: "Password must be at least 8 characters.",
    }),
    newPassword: z.string().min(8, {
      message: "Password must be at least 8 characters.",
    }),
    confirmPassword: z.string().min(8, {
      message: "Password must be at least 8 characters.",
    }),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type PasswordFormValues = z.infer<typeof passwordFormSchema>;

export function AccountForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    mode: "onChange",
  });

  const [passwordStrength, setPasswordStrength] = React.useState(0);

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value;
    form.setValue("newPassword", newPassword);
    if (newPassword) {
      const evaluation = zxcvbn(newPassword);
      setPasswordStrength(evaluation.score);
    } else {
      setPasswordStrength(0);
    }
  };

  const getStrengthLabel = (score: number) => {
    switch (score) {
      case 0:
        return "Very Weak";
      case 1:
        return "Weak";
      case 2:
        return "Fair";
      case 3:
        return "Strong";
      case 4:
        return "Very Strong";
      default:
        return "";
    }
  };

  // The onSubmit function now makes a POST request to the API endpoint.
  async function onSubmit(data: PasswordFormValues) {
    setIsLoading(true);

    try {
      // Make a POST request to the /api/auth/change-password/ endpoint.
      const response = await fetch("/api/auth/change-password/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // Send the form data as a JSON string.
        body: JSON.stringify(data),
      });

      // Parse the response data.
      const result = await response.json();

      // Check for a successful response.
      if (response.ok) {
        toast.success(result.message || "Password updated successfully!");
        form.reset();
      } else {
        // Display an error message if something went wrong.
        toast.error(result.error || "Error updating password");
      }
    } catch (error) {
      console.error("Error updating password:", error);
      toast.error("Something went wrong. Please try again later.");
    }

    setIsLoading(false);
  }

  function handleTwoFactorToggle() {
    setTwoFactorEnabled(!twoFactorEnabled);
    // Simulate API call for two-factor toggling
    toast.success(
      `Two-factor authentication ${!twoFactorEnabled ? "enabled" : "disabled"}`
    );
  }

  // --- Delete account handler ---
  const handleDeleteAccount = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/users/delete-account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // if you need to send any body (e.g. user ID), add it here:
        // body: JSON.stringify({ /* ... */ }),
      });
      const json = await res.json();
      if (res.ok) {
        router.push("/sign-out");
        toast.success(json.message || "Account deleted successfully.");
        // maybe redirect or clear user state here…
      } else {
        toast.error(json.error || "Could not delete account.");
      }
    } catch (err: any) {
      console.error("deleteAccount error:", err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>
            Update your password to keep your account secure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid gap-5">
                <FormField
                  control={form.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          {...field}
                          onChange={handlePasswordChange}
                        />
                      </FormControl>
                      <FormDescription>
                        Password must be at least 8 characters long.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          placeholder="••••••••"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                      {field.value && (
                        <p className="text-sm mt-1">
                          Strength:{" "}
                          <strong>{getStrengthLabel(passwordStrength)}</strong>
                        </p>
                      )}
                    </FormItem>
                  )}
                />
              </div>
              <CardFooter className="px-0 pb-0">
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? "Updating..." : "Update password"}
                </Button>
              </CardFooter>
            </form>
          </Form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Delete Account</CardTitle>
          <CardDescription>
            Permanently delete your account and all of your content.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* keep your warning banner */}
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              This action cannot be undone. This will permanently delete your
              account and remove your data from our servers.
            </AlertDescription>
          </Alert>

          {/* now wrap the delete button in an AlertDialog */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isLoading}>
                {isLoading ? "Deleting…" : "Delete Account"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete
                  your account and remove your data from our servers.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteAccount}>
                  Continue
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
