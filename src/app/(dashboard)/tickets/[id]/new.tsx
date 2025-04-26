"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Paperclip, Send, Tag } from "lucide-react";
import Swal from "sweetalert2";
import CreatableSelect from "react-select/creatable";

import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/* ------------------------------------------------------------------ */
/* Types & helpers                                                    */
/* ------------------------------------------------------------------ */
type TicketHeader = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high";
  status: "open" | "in-progress" | "closed";
  username: string;
  createdAt: string;
};
type TicketMessage = {
  id: string;
  content: string;
  attachments: { name: string; url: string; size: number }[];
  isInternal: boolean;
  createdAt: string;
};
const fmtLocal = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [header, setHeader] = useState<TicketHeader | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const [status, setStatus] = useState<TicketHeader["status"]>("open");
  const [priority, setPriority] = useState<TicketHeader["priority"]>("medium");
  const [newMessage, setNewMessage] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);

  // tags modal state
  const [tagsOptions, setTagsOptions] = useState<{ value: string; label: string }[]>([]);
  const [selectedTags, setSelectedTags] = useState<typeof tagsOptions>([]);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);

  /* fetch ticket + messages + initial tags */
  useEffect(() => {
    (async () => {
      try {
        const [tRes, tagsRes] = await Promise.all([
          fetch(`/api/tickets/${id}`),
          fetch("/api/tickets/tags"),
        ]);
        if (!tRes.ok || !tagsRes.ok) throw new Error();
        const { ticket, messages } = await tRes.json();
        const tagsList: string[] = await tagsRes.json();
        setHeader(ticket);
        setMessages(messages);
        setStatus(ticket.status);
        setPriority(ticket.priority);
        setTagsOptions(tagsList.map((t) => ({ value: t, label: t })));
        // if you have existing ticket.tags, you could also setSelectedTags here
      } catch {
        toast.error("Failed to load ticket or tags");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  /* status‐change handler (unchanged) */
  const handleStatusChange = async (newStatus: TicketHeader["status"]) => {
    if (newStatus === "closed") {
      const { isConfirmed } = await Swal.fire({
        title: "Close Ticket?",
        text: "Are you sure you want to close this ticket?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Yes, close it",
      });
      if (!isConfirmed) {
        setStatus("in-progress");
        return;
      }
    }
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

  /* priority-change handler (unchanged) */
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

  /* “Add tags” save */
  const handleSaveTags = async () => {
    try {
      const res = await fetch(`/api/tickets/${id}/tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags: selectedTags.map((t) => t.value),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Tags updated");
      setTagsDialogOpen(false);
    } catch {
      toast.error("Failed to update tags");
    }
  };

  /* message composer (unchanged) */
  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    e.target.files && setAttachments(Array.from(e.target.files));
  const handleSendMessage = async () => {
    if (!newMessage.trim()) {
      toast.warning("Message cannot be empty");
      return;
    }
    try {
      const attachJson = attachments.length
        ? JSON.stringify(
            attachments.map((f) => ({
              name: f.name,
              url: "",
              size: f.size,
            }))
          )
        : null;
      const res = await fetch(`/api/tickets/${id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-is-internal": "true",
        },
        body: JSON.stringify({
          content: newMessage,
          attachments: attachJson,
        }),
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
        <CardHeader className="flex justify-between items-start">
          <div>
            <CardTitle>{header.title}</CardTitle>
            <CardDescription>
              Created {fmtLocal(header.createdAt)} by {header.username}
            </CardDescription>
          </div>

          {/* priority + status + add‐tags button */}
          <div className="flex items-center gap-3">
            {/* Add Tags */}
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

            {/* Priority */}
            <Select
              value={priority}
              onValueChange={handlePriorityChange}
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

            {/* Status */}
            <Select value={status} onValueChange={handleStatusChange}>
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

        <CardContent className="space-y-4">
          {messages.map((m) => {
            const fromUser = !m.isInternal;
            return (
              <div
                key={m.id}
                className={`flex ${fromUser ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`flex gap-3 max-w-[80%] ${
                    fromUser ? "flex-row" : "flex-row-reverse"
                  }`}
                >
                  <Avatar className="mt-1">
                    <AvatarFallback>
                      {fromUser
                        ? header.username.charAt(0)
                        : "A"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div
                      className={`rounded-lg p-3 ${
                        fromUser
                          ? "bg-muted text-foreground"
                          : "bg-primary text-primary-foreground"
                      }`}
                    >
                      <p>{m.content}</p>
                      {m.attachments.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {m.attachments.map((a) => (
                            <div
                              key={a.url}
                              className="flex items-center gap-1 text-sm"
                            >
                              <Paperclip className="h-3 w-3" />
                              <a
                                href={a.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                              >
                                {a.name}
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div
                      className={`text-xs text-muted-foreground mt-1 ${
                        fromUser ? "text-left" : "text-right"
                      }`}
                    >
                      {fmtLocal(m.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>

        <CardFooter className="flex flex-col gap-4">
          <Textarea
            placeholder="Type your response here..."
            className="min-h-[100px]"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
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
            </div>
            <Button onClick={handleSendMessage}>
              <Send className="h-4 w-4 mr-2" />
              Send Response
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
