// /home/zodx/Desktop/trapigram/src/app/(dashboard)/organizations/[slug]/invite-member-form.tsx
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  role: z.string().min(1, "Please select a role"),
});

type FormValues = z.infer<typeof formSchema>;

interface InviteMemberFormProps {
  organizationId: string;
  currentUserRole: string | null;
}

export function InviteMemberForm({ organizationId, currentUserRole }: InviteMemberFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", role: "" },
  });

  const getInviteRoles = () => {
    if (currentUserRole === "owner") return ["owner", "manager", "accountant", "employee"];
    if (currentUserRole === "manager") return ["manager", "accountant", "employee"];
    return [];
  };

  const onSubmit = async (values: FormValues) => {
    setIsSubmitting(true);
    try {
      await authClient.organization.inviteMember({
        email: values.email,
        role: values.role,
        organizationId,
      });
      toast.success(`Invitation sent to ${values.email}`);
      form.reset();
    } catch (error) {
      console.error("Error inviting member:", error);
      toast.error("Failed to send invitation");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite Members</CardTitle>
        <CardDescription>Invite new members to join this organization.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col sm:flex-row gap-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormControl>
                    <Input {...field} placeholder="Email address" type="email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem className="w-full sm:w-[180px]">
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {getInviteRoles().map((role) => (
                        <SelectItem key={role} value={role}>
                          {role.charAt(0).toUpperCase() + role.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Send className="mr-2 h-4 w-4" /> Send Invite
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}