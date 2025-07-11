// src/app/(dashboard)/tickets/[id]/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter }               from "next/navigation";
import Link                                   from "next/link";
import { ArrowLeft, Paperclip, Send, Tag }    from "lucide-react";
import CreatableSelect                        from "react-select/creatable";
import { toast }                              from "sonner";

import { authClient }                         from "@/lib/auth-client";
import { useHasPermission }                   from "@/hooks/use-has-permission";

import { Badge }                              from "@/components/ui/badge";
import { Button }                             from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardFooter,
  CardHeader, CardTitle
} from "@/components/ui/card";
import { Textarea }                           from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Dialog, DialogTrigger, DialogContent,
  DialogHeader, DialogTitle, DialogFooter, DialogClose
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback }             from "@/components/ui/avatar";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction
} from "@/components/ui/alert-dialog";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type TicketHeader = {
  id: string;
  title: string;
  clientId: string;
  priority: "low" | "medium" | "high";
  status: "open" | "in-progress" | "closed";
  userId: string;
  firstName: string;
  createdAt: Date;
};

type TicketMessage = {
  id: string;
  message: string;
  attachments: { name: string; url: string; size: number }[];
  isInternal: boolean;
  createdAt: Date;
};

/* -------------------------------------------------------------------------- */
/*  Utils                                                                     */
/* -------------------------------------------------------------------------- */

const fmtLocal = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function TicketDetail() {
  /* ---------------- params / routing ------------------------------------ */
  const { id }  = useParams<{ id: string }>();
  const router  = useRouter();

  /* ---------------- state ------------------------------------------------ */
  const [header,       setHeader]        = useState<TicketHeader | null>(null);
  const [messages,     setMessages]      = useState<TicketMessage[]>([]);
  const [loading,      setLoading]       = useState(true);
  const [status,       setStatus]        = useState<TicketHeader["status"]>("open");
  const [priority,     setPriority]      = useState<TicketHeader["priority"]>("medium");
  const [newMessage,   setNewMessage]    = useState("");
  const [attachments,  setAttachments]   = useState<File[]>([]);
  const [tagsOptions,  setTagsOptions]   = useState<{value:string;label:string}[]>([]);
  const [selectedTags, setSelectedTags]  = useState<typeof tagsOptions>([]);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [tags,         setTags]           = useState<{description:string}[]>([]);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  // ── Permission hooks ─────────────────────────────────────────────────────
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;
  const { hasPermission: canViewRaw,   isLoading: viewLoading   } =
    useHasPermission(organizationId, { ticket: ["view"] });
  const { hasPermission: canUpdateRaw, isLoading: updateLoading } =
    useHasPermission(organizationId, { ticket: ["update"] });

  const canView   = useMemo(() => !viewLoading   && canViewRaw,   [viewLoading,   canViewRaw]);
  const canUpdate = useMemo(() => !updateLoading && canUpdateRaw,[updateLoading, canUpdateRaw]);

  // ── Redirect if no view right ────────────────────────────────────────────
  useEffect(() => {
    if (!viewLoading && !canViewRaw) router.replace("/tickets");
  }, [viewLoading, canViewRaw, router]);

  /* ---------------- fetch ticket + tags --------------------------------- */
  useEffect(() => {
    // Always run the hook; abort early to keep hook order stble.
    if (!canView || !id) return;

    (async () => {
      setLoading(true);
      try {
        const [tRes, tagsRes] = await Promise.all([
          fetch(`/api/tickets/${id}`),
          fetch(`/api/tickets/${id}/tags`),
        ]);
        if (!tRes.ok) throw new Error();
        const { ticket, messages } = await tRes.json();
        const { tagList, tags }    = await tagsRes.json();

        setHeader(ticket);
        setMessages(messages);
        setStatus(ticket.status);
        setPriority(ticket.priority);

        setTagsOptions(tagList.map((t:any) => ({ value:t.description, label:t.description })));
        setTags(tags);
        setSelectedTags(tags.map((t:any) => ({ value:t.description, label:t.description })));
      } catch {
        // toast.error("Failed to load ticket or tags");
      } finally {
        setLoading(false);
      }
    })();
    
  }, [id, canView]);

   /* ────────────────────────── LIVE UPDATES (POLLING) ─────────────────────── */
   useEffect(() => {
     if (!id || !canView) return;
  
     const interval = setInterval(async () => {
       try {
         const res = await fetch(`/api/tickets/${id}/messages`);
         if (!res.ok) throw new Error();
         const fetchedMessages: TicketMessage[] = await res.json();
         setMessages(prev => {
           const existingIds = new Set(prev.map(m => m.id));
           const newMessages = fetchedMessages.filter(m => !existingIds.has(m.id));
           if (newMessages.length > 0) {
             return [...prev, ...newMessages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
           }
           return prev;
         });
       } catch (err) {
         console.error('Error fetching messages:', err);
       }
     }, 5000); // Poll every 5 seconds
  
     return () => clearInterval(interval);
   }, [id, canView]);

  /* ---------------- guards AFTER all hooks ------------------------------ */
  if (viewLoading || !canView) return null;

  /* ---------------- helpers that honour canUpdate ------------------------ */
  const updateStatus = async (newStatus: TicketHeader["status"]) => {
    if (!canUpdate) return;
    setStatus(newStatus);
    try {
      const res = await fetch(`/api/tickets/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Status set to ${newStatus}`);
    } catch {
      toast.error("Failed to update status");
      setStatus(header?.status ?? "in-progress");
    }
  };

  const handleStatusChange = (newStatus: TicketHeader["status"]) => {
    if (!canUpdate) return;
    if (newStatus === "closed") setCloseDialogOpen(true);
    else updateStatus(newStatus);
  };

  const handlePriorityChange = async (newPriority: TicketHeader["priority"]) => {
    if (!canUpdate) return;
    setPriority(newPriority);
    try {
      const res = await fetch(`/api/tickets/${id}/priority`, {
        method: "PATCH",
        headers: { "x-priority": newPriority },
      });
      if (!res.ok) throw new Error();
      toast.success(`Priority set to ${newPriority}`);
    } catch {
      toast.error("Failed to update priority");
      setPriority(header?.priority ?? "medium");
    }
  };

  const handleSaveTags = async () => {
    if (!canUpdate) return;
    try {
      const res = await fetch(`/api/tickets/${id}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: selectedTags.map((t) => t.value) }),
      });
      if (!res.ok) throw new Error();
      toast.success("Tags saved");
      setTagsDialogOpen(false);
      setTags(selectedTags.map((t) => ({ description: t.value })));
    } catch {
      toast.error("Failed to save tags");
    }
  };

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    e.target.files && setAttachments(Array.from(e.target.files));

  /** upload one file and return {name, url, size} */
  const uploadFile = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const up = await fetch("/api/upload", { method: "POST", body: fd });
    if (!up.ok) throw new Error("upload failed");
    const { filePath } = await up.json();
    return { name: file.name, url: filePath, size: file.size };
  };
  
  const handleSendMessage = async () => {
    if (!canUpdate) return;
    if (!newMessage.trim()) {
      toast.warning("Message cannot be empty");
      return;
    }
    try {
      /* 1️⃣ upload every attachment (in parallel) */
      let uploaded: { name: string; url: string; size: number }[] = [];
      if (attachments.length) {
        uploaded = await Promise.all(attachments.map(uploadFile));
      }
  
      /* 2️⃣ post the message with the real URLs */
      const res = await fetch(`/api/tickets/${id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-is-internal": "true",
        },
        body: JSON.stringify({
          content: newMessage,
          attachments: uploaded,     // <-- NOT stringified
        }),
      });
      if (!res.ok) throw new Error();
  
      const created: TicketMessage = await res.json();
      setMessages((m) => [...m, created]);
      setNewMessage("");
      setAttachments([]);
    } catch (err) {
      console.error(err);
      toast.error("Failed to send message");
    }
  };
  

  /* ---------------- render guards --------------------------------------- */
  if (loading)          return <p className="p-6">Loading…</p>;
  if (!header)          return <p className="p-6">Ticket not found.</p>;

  /* ---------------- JSX -------------------------------------------------- */
  return (
    <div className="container mx-auto py-10 px-3">
      <div className="mb-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/tickets" className="flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Back to Tickets
          </Link>
        </Button>
      </div>

      <Card>
        {/* -------- header ------------------------------------------------- */}
        <CardHeader className="flex items-start justify-between sm:flex-wrap">
          <div>
            <CardTitle className="text-lg font-semibold">
              {header.title}{" "}
              {tags.map((t) => (
                <Badge key={t.description} variant="outline">
                  {t.description}
                </Badge>
              ))}
            </CardTitle>
            <CardDescription>
              Created on {fmtLocal(header.createdAt)} by {header.firstName}. ID:{" "}
              <Link href={`/clients/${header.clientId}/info/`}>
                {header.clientId}
              </Link>
            </CardDescription>
          </div>

          <div className="flex items-center gap-4 sm:mt-2">
            {/* ---- TAGS dialog (disabled if !canUpdate) ------------------ */}
            <Dialog
              open={tagsDialogOpen}
              onOpenChange={(open) => canUpdate && setTagsDialogOpen(open)}
            >
              <DialogTrigger asChild>
                <Button variant="outline" size="icon" disabled={!canUpdate}>
                  <Tag className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Tags</DialogTitle>
                </DialogHeader>
                <CreatableSelect
                  isMulti
                  options={tagsOptions}
                  value={selectedTags}
                  onChange={(v) => setSelectedTags(v as any)}
                  placeholder="Select or type tags…"
                  formatCreateLabel={(input) => `Add "${input}"`}
                  isDisabled={!canUpdate}
                />
                <DialogFooter className="mt-4 flex justify-end space-x-2">
                  <DialogClose asChild>
                    <Button variant="ghost">Cancel</Button>
                  </DialogClose>
                  <Button onClick={handleSaveTags} disabled={!canUpdate}>
                    Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* ---- priority ------------------------------------------------ */}
            <Select
              value={priority}
              onValueChange={handlePriorityChange}
              disabled={!canUpdate || status === "closed"}
            >
              <SelectTrigger className="w-[120px]">
                <Badge
                  className={{
                    low:    "bg-green-100 text-green-800",
                    medium: "bg-yellow-100 text-yellow-800",
                    high:   "bg-red-100 text-red-800",
                  }[priority]}
                  variant="outline"
                >
                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
                </Badge>
              </SelectTrigger>
              <SelectContent side="bottom">
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>

            {/* ---- status -------------------------------------------------- */}
            <Select
              value={status}
              onValueChange={handleStatusChange}
              disabled={!canUpdate || status === "closed"}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="bottom">
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in-progress">In Progress</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        {/* -------- messages --------------------------------------------- */}
        <CardContent>
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.isInternal ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`flex gap-3 max-w-[80%] ${message.isInternal ? "flex-row-reverse" : "flex-row"}`}
                >
                  <Avatar className="mt-1">
                    <AvatarFallback>
                      {message.isInternal ? "A" : header.firstName.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div
                      className={`rounded-lg p-3 ${
                        message.isInternal
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      <p>{message.message}</p>
                      {message.attachments?.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {message.attachments.map((att, i) => (
                            <div key={i} className="flex items-center gap-1 text-sm">
                              <Paperclip className="h-3 w-3" />
                              <a href={att.url} target="_blank" rel="noopener noreferrer" className="underline">
                                {att.name}
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div
                      className={`text-xs text-muted-foreground mt-1 ${message.isInternal ? "text-right" : "text-left"}`}
                    >
                      {fmtLocal(message.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>

        {/* -------- composer --------------------------------------------- */}
        <CardFooter className="flex flex-col gap-4">
          <Textarea
            placeholder={
              status === "closed"
                ? "Ticket is closed"
                : "Type your response here…"
            }
            className="min-h-[100px]"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            disabled={!canUpdate || status === "closed"}
          />

          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <input
                type="file"
                id="file-upload"
                multiple
                className="hidden"
                onChange={handleAttachmentChange}
                disabled={!canUpdate || status === "closed"}
              />
              <Button variant="outline" size="sm" asChild disabled={!canUpdate || status === "closed"}>
                <label htmlFor="file-upload" className="cursor-pointer">
                  <Paperclip className="h-4 w-4 mr-2" />
                  Attach Files
                </label>
              </Button>
              {attachments.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {attachments.length} file(s) selected
                </span>
              )}
            </div>

            <Button onClick={handleSendMessage} disabled={!canUpdate || status === "closed"}>
              <Send className="h-4 w-4 mr-2" />
              Send Response
            </Button>
          </div>
        </CardFooter>
      </Card>

      {/* -------- close confirmation ------------------------------------- */}
      <AlertDialog
        open={closeDialogOpen}
        onOpenChange={(open) => !open && setCloseDialogOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to close this ticket?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setCloseDialogOpen(false);
                updateStatus("closed");
              }}
            >
              Yes, close it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small helper component                                                    */
/* -------------------------------------------------------------------------- */

function PriorityBadge({ priority }: { priority: "low" | "medium" | "high" }) {
  const variants = {
    low: "bg-green-100 text-green-800 hover:bg-green-100",
    medium: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
    high: "bg-red-100 text-red-800 hover:bg-red-100",
  };
  return (
    <Badge className={variants[priority]} variant="outline">
      {priority.charAt(0).toUpperCase() + priority.slice(1)}
    </Badge>
  );
}