"use client";

import type React from "react";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Paperclip, Send } from "lucide-react";

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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";

/* ------------------------------------------------------------------ */
/* 1. API payload types                                               */
/* ------------------------------------------------------------------ */
type TicketHeader = {
  id: string;
  title: string;
  priority: "low" | "medium" | "high";
  status: "open" | "in-progress" | "closed";
  userId: string;
  username: string;
  createdAt: Date;
};

type TicketMessage = {
  id: string;
  message: string;
  attachments: { name: string; url: string; size: number }[];
  isInternal: boolean;
  createdAt: Date;
};

/* ------------------------------------------------------------------ */
/* 2. Helper                                                          */
/* ------------------------------------------------------------------ */
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

  const [newMessage, setNewMessage] = useState("");
  const [status, setStatus] = useState<"open" | "in-progress" | "closed">(
    "open"
  );
  const [attachments, setAttachments] = useState<File[]>([]);

  /* fetch ticket + messages */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/tickets/${id}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setHeader(data.ticket);
        setMessages(data.messages);
        setStatus(data.ticket.status);
      } catch {
        toast.error("Failed to load ticket");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  /* attachment handler */
  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    e.target.files && setAttachments(Array.from(e.target.files));

  /* loading / not‑found guards */
  if (loading) return <p className="p-6">Loading…</p>;
  if (!header) return <p className="p-6">Ticket not found.</p>;

  const handleSendMessage = async () => {
    if (!newMessage.trim()) {
      toast.warning("Message cannot be empty");
      return;
    }

    try {
      /* 1 · build a simple attachment payload (names only).  
           In real life you’d upload files first and send their URLs. */
      const attachJson = attachments.length
        ? JSON.stringify(
          attachments.map((f) => ({
            name: f.name,
            url: "",
            size: f.size,
          })),
        )
        : [];

      /* 2 · POST to the API with x‑is‑internal = true */
      const res = await fetch(`/api/tickets/${id}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-is-internal": "true",          // <- required header
        },
        body: JSON.stringify({
          message: newMessage,
          attachments: attachJson,
        }),
      });

      if (!res.ok) throw new Error("Request failed");

      /* 3 · append the returned message to local state */
      const created: TicketMessage = await res.json();
      setMessages((m) => [...m, created]);

      /* 4 · reset composer */
      setNewMessage("");
      setAttachments([]);
    } catch {
      toast.error("Failed to send message");
    }
  }

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
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {header.title}:
              <PriorityBadge priority={header.priority} />
            </CardTitle>
            <CardTitle>Ticket #{header.id}</CardTitle>
            <CardDescription>
              Created on {fmtLocal(header.createdAt)} by {header.username}
            </CardDescription>
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
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
                        ? header.username.charAt(0).toUpperCase()
                        : "A"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <div
                      className={`rounded-lg p-3 ${message.isInternal === false
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
              {attachments.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {attachments.length} file(s) selected
                </span>
              )}
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