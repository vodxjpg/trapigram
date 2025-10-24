// src/app/(dashboard)/orders/[id]/components/order-notes.tsx
"use client";

import * as React from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Eye, EyeOff, Loader2, MessageSquarePlus, Trash } from "lucide-react";

export type OrderNote = {
    id: string;
    orderId: string;
    organizationId: string;
    authorRole: "client" | "staff";
    authorClientId: string | null;
    authorUserId: string | null;
    note: string;
    visibleToCustomer: boolean;
    createdAt: string;
    updatedAt: string;
};

export interface OrderNotesProps {
    notesScope: "staff" | "customer";
    setNotesScope: (s: "staff" | "customer") => void;

    notesLoading: boolean;
    notes: OrderNote[];

    newNote: string;
    setNewNote: (v: string) => void;
    newNotePublic: boolean;
    setNewNotePublic: (v: boolean) => void;

    creatingNote: boolean;
    createNote: () => void;

    toggleNoteVisibility: (noteId: string, visible: boolean) => void | Promise<void>;
    deleteNote: (noteId: string) => void | Promise<void>;
}

export default function OrderNotes(props: OrderNotesProps) {
    const {
        notesScope,
        setNotesScope,
        notesLoading,
        notes,
        newNote,
        setNewNote,
        newNotePublic,
        setNewNotePublic,
        creatingNote,
        createNote,
        toggleNoteVisibility,
        deleteNote,
    } = props;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <MessageSquarePlus className="h-5 w-5" /> Order Notes
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Scope toggle */}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Button
                            variant={notesScope === "staff" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setNotesScope("staff")}
                        >
                            Staff view
                        </Button>
                        <Button
                            variant={notesScope === "customer" ? "default" : "outline"}
                            size="sm"
                            onClick={() => setNotesScope("customer")}
                        >
                            Customer view
                        </Button>
                    </div>
                    <div className="text-sm text-muted-foreground">
                        Public notes are visible to the customer.
                    </div>
                </div>

                {/* Notes list */}
                <div className="border rounded-lg">
                    <ScrollArea className="h-64">
                        <div className="p-3 space-y-3">
                            {notesLoading ? (
                                <div className="flex items-center justify-center py-8 text-muted-foreground">
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading notes…
                                </div>
                            ) : notes.length === 0 ? (
                                <div className="text-center text-muted-foreground py-8">
                                    No notes yet.
                                </div>
                            ) : (
                                notes.map((n) => (
                                    <div key={n.id} className="border rounded-md p-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="secondary">
                                                    {n.authorRole === "staff" ? "Staff" : "Client"}
                                                </Badge>
                                                <Badge className={n.visibleToCustomer ? "bg-green-600" : "bg-gray-500"}>
                                                    {n.visibleToCustomer ? "Customer-visible" : "Staff-only"}
                                                </Badge>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    size="icon" variant="ghost"
                                                    onClick={() => toggleNoteVisibility(n.id, !n.visibleToCustomer)}
                                                    title={n.visibleToCustomer ? "Make staff-only" : "Make public"}
                                                >
                                                    {n.visibleToCustomer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </Button>
                                                <Button size="icon" variant="ghost" onClick={() => deleteNote(n.id)} title="Delete">
                                                    <Trash className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                        <p className="mt-2 text-sm whitespace-pre-wrap">{n.note}</p>
                                        <div className="mt-1 text-xs text-muted-foreground">
                                            {new Date(n.createdAt).toLocaleString()}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                </div>

                {/* Create new note */}
                <div className="space-y-3">
                    <Textarea
                        value={newNote}
                        placeholder="Add a note for this order…"
                        onChange={(e) => setNewNote(e.target.value)}
                    />
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Switch
                                id="public-note-edit"
                                checked={newNotePublic}
                                onCheckedChange={setNewNotePublic}
                            />
                            <Label htmlFor="public-note-edit" className="text-sm">
                                Visible to customer
                            </Label>
                        </div>
                        <Button onClick={createNote} disabled={!newNote.trim() || creatingNote}>
                            {creatingNote && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Add Note
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
