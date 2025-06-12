// src/app/(dashboard)/organizations/[identifier]/invite-member-form.tsx
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { useOrgRoles } from "@/hooks/use-org-roles";
import { usePermission } from "@/hooks/use-permission";

import { Button } from "@/components/ui/button";
import {
  Form, FormField, FormItem, FormControl, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
  role:  z.string().min(1, "Please select a role"),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  organizationId: string;
}

export function InviteMemberForm({ organizationId }: Props) {
  const can = usePermission();
  const { roles, isLoading: rolesLoading } = useOrgRoles(organizationId);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", role: "" },
  });

  // only render if they have the `invitation:create` permission
  if (!can({ invitation: ["create"] })) {
    return null;
  }

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      await authClient.organization.inviteMember({
        organizationId,
        email: values.email,
        role:  values.role,
      });
      toast.success(`Invitation sent to ${values.email}`);
      form.reset();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send invitation");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite Members</CardTitle>
        <CardDescription>
          Send an email invitation with a role you’ve created.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rolesLoading ? (
          <p className="text-sm text-muted-foreground">Loading roles…</p>
        ) : roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven’t created any roles yet. Create one in{" "}
            <strong>Settings → Roles</strong> before inviting members.
          </p>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-col sm:flex-row gap-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="Email address"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem className="w-full sm:w-[200px]">
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.name} value={r.name}>
                              {r.name.charAt(0).toUpperCase() + r.name.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                disabled={submitting}
                className="w-full sm:w-auto"
              >
                {submitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                <Send className="mr-2 h-4 w-4" />
                Send Invite
              </Button>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
