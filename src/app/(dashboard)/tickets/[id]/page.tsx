"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Paperclip, Send, Tag } from "lucide-react";
import CreatableSelect from "react-select/creatable";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

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

const fmtLocal = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export default function TicketDetail({ params }: { params: { id: string } }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [header, setHeader] = useState<TicketHeader | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState<TicketHeader["status"]>("open");
  const [priority, setPriority] = useState<TicketHeader["priority"]>("medium");
  const [newMessage, setNewMessage] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);

  const [tagsOptions, setTagsOptions] = useState<{ value: string; label: string }[]>([]);
  const [selectedTags, setSelectedTags] = useState<typeof tagsOptions>([]);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [tags, setTags] = useState<{ description: string }[]>([]);

  // NEW: state for showing the “Close Ticket?” dialog
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [tRes, tagsRes] = await Promise.all([
          fetch(`/api/tickets/${id}`),
          fetch(`/api/tickets/${id}/tags`),
        ]);
        if (!tRes.ok) throw new Error();
        const { ticket, messages } = await tRes.json();
        const { tagList, tags } = await tagsRes.json();
        setHeader(ticket);
        setMessages(messages);
        setStatus(ticket.status);
        setPriority(ticket.priority);
        setTagsOptions(tagList.map((t: any) => ({ value: t.description, label: t.description })));
        setTags(tags);
        setSelectedTags(tags.map((t: any) => ({ value: t.description, label: t.description })));
      } catch {
        toast.error("Failed to load ticket or tags");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const updateStatus = async (newStatus: TicketHeader["status"]) => {
    setStatus(newStatus);
    try {
      const res = await fetch(`/api/tickets/${id}/status`, {
        method: "PATCH",
        headers: { "x-status": newStatus },
      });
      if (!res.ok) throw new Error();
      toast.success(`Status set to ${newStatus}`);
    } catch {
      toast.error("Failed to update status");
      setStatus(header?.status ?? "in-progress");
    }
  };

  const handleStatusChange = (newStatus: TicketHeader["status"]) => {
    if (newStatus === "closed") {
      // open confirmation dialog instead of Swal
      setCloseDialogOpen(true);
    } else {
      updateStatus(newStatus);
    }
  };

  const handlePriorityChange = async (newPriority: TicketHeader["priority"]) => {
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
    try {
      const res = await fetch(`/api/tickets/${id}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: selectedTags.map((t) => t.value) }),
      });
      if (!res.ok) throw new Error();
      toast.success("Tags created");
      setTagsDialogOpen(false);
      setTags(selectedTags.map((t) => ({ description: t.value })));
    } catch {
      toast.error("Failed to save tags");
    }
  };

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    e.target.files && setAttachments(Array.from(e.target.files));

  const handleSendMessage = async () => {
    if (!newMessage.trim()) {
      toast.warning("Message cannot be empty");
      return;
    }
    try {
      const attachJson = attachments.length
        ? JSON.stringify(attachments.map((f) => ({ name: f.name, url: "", size: f.size })))
        : null;
      const res = await fetch(`/api/tickets/${id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-is-internal": "true",
        },
        body: JSON.stringify({ content: newMessage, attachments: attachJson }),
      });
      if (!res.ok) throw new Error();
      const created: TicketMessage = await res.json();
      setMessages((m) => [...m, created]);
      setNewMessage("");
      setAttachments([]);
    } catch {
      toast.error("Failed to send message");
    }
  };

  if (loading) return <p className="p-6">Loading…</p>;
  if (!header) return <p className="p-6">Ticket not found.</p>;

  return (
    <div className="container mx-auto py-10">
      <div className="mb-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/tickets" className="flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Back to Tickets
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex items-start justify-between">
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

          <div className="flex items-center gap-4">
            <Dialog open={tagsDialogOpen} onOpenChange={setTagsDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon">
                  <Tag className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Tags</DialogTitle>
                </DialogHeader>
                <CreatableSelect
                  isMulti
                  options={tagsOptions}
                  value={selectedTags}
                  onChange={(v) => setSelectedTags(v as any)}
                  placeholder="Select or type tags…"
                  formatCreateLabel={(input) => `Add "${input}"`}
                />
                <DialogFooter className="mt-4 flex justify-end space-x-2">
                  <DialogClose asChild>
                    <Button variant="ghost">Cancel</Button>
                  </DialogClose>
                  <Button onClick={handleSaveTags}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Select
              value={priority}
              onValueChange={handlePriorityChange}
              disabled={status === "closed"}
            >
              <SelectTrigger className="w-[120px]">
                <Badge
                  className={{
                    low: "bg-green-100 text-green-800",
                    medium: "bg-yellow-100 text-yellow-800",
                    high: "bg-red-100 text-red-800",
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

            <Select
              value={status}
              onValueChange={handleStatusChange}
              disabled={status === "closed"}
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

        <CardContent>
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.isInternal === false ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`flex gap-3 max-w-[80%] ${message.isInternal === false ? "flex-row" : "flex-row-reverse"}`}
                >
                  <Avatar
                    className={message.isInternal === false ? "mt-1" : "mt-1"}
                  >
                    <AvatarFallback>
                      {message.isInternal === false
                        ? header.firstName.charAt(0).toUpperCase()
                        : "A"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div
                      className={`rounded-lg p-3 ${
                        message.isInternal === false
                          ? "bg-muted text-foreground"
                          : "bg-primary text-primary-foreground"
                      }`}
                    >
                      <p>{message.message}</p>
                      {message.attachments &&
                        message.attachments.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {message.attachments.map((attachment, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-1 text-sm"
                              >
                                <Paperclip className="h-3 w-3" />
                                <a
                                  href={attachment.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline"
                                >
                                  {attachment.name}
                                </a>
                              </div>
                            ))}
                          </div>
                        )}
                    </div>
                    <div
                      className={`text-xs text-muted-foreground mt-1 ${message.isInternal === false ? "text-left" : "text-right"}`}
                    >
                      {fmtLocal(message.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-4">
          <Textarea
            placeholder={
              status === "closed"
                ? "Ticket is closed"
                : "Type your response here..."
            }
            className="min-h-[100px]"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            disabled={status === "closed"}
          />

          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <input
                type="file"
                id="file-upload"
                multiple
                className="hidden"
                onChange={handleAttachmentChange}
              />
              <Button variant="outline" size="sm" asChild>
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

            <Button
              onClick={handleSendMessage}
              disabled={status === "closed"}
            >
              <Send className="h-4 w-4 mr-2" />
              Send Response
            </Button>
          </div>
        </CardFooter>
      </Card>

      {/* Shadcn “Close Ticket?” confirmation */}
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
