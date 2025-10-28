// components/orders/ClientSelect.tsx
"use client";

import { JSX } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

/**
 * ClientSelect now renders its own Card and the "Generate Order" button,
 * so the parent can just place <ClientSelect …/> like ProductSelect.
 */
export interface ClientSelectProps {
    /** Current selected client id */
    selectedClient: string;
    /** True while initial clients list is loading */
    clientsLoading: boolean;
    /** When true, the select is disabled (same as original when order is generated) */
    orderGenerated: boolean;

    /** Full local clients list (used to exclude dupes from remote results in the UI) */
    clients: any[];
    /** Locally filtered clients based on searchTerm (same list you already compute) */
    filteredClients: any[];
    /** Remote search results list */
    searchResults: any[];
    /** Search input value */
    searchTerm: string;
    /** True while remote search is in-flight (for "Searching…" row) */
    searching: boolean;

    /** Called when the select value changes; this component will resolve the object and call pickClient */
    pickClient: (id: string, obj: any) => void;

    /** Called when user types in the search box */
    setSearchTerm: (v: string) => void;

    /** Click handler for "Generate Order" */
    onGenerateOrder?: () => void;
}

export default function ClientSelect(props: ClientSelectProps): JSX.Element {
    const {
        selectedClient,
        clientsLoading,
        orderGenerated,
        clients,
        filteredClients,
        searchResults,
        searching,
        searchTerm,
        setSearchTerm,
        pickClient,
        onGenerateOrder,
    } = props;

    return (
        <div className="flex items-end gap-4">
            <div className="flex-1">
                <Label>Select Client</Label>
                <Select
                    value={selectedClient}
                    onValueChange={(val) => {
                        // Find the object from local list or remote results, then delegate
                        const obj = [...clients, ...searchResults].find((c) => c.id === val);
                        if (obj) pickClient(val, obj);
                    }}
                    disabled={clientsLoading || orderGenerated}
                >
                    <SelectTrigger>
                        <SelectValue
                            placeholder={clientsLoading ? "Loading…" : "Select or search client"}
                        />
                    </SelectTrigger>

                    <SelectContent className="w-[450px]">
                        {/* Search bar */}
                        <div className="p-3 border-b flex items-center gap-2">
                            <Search className="h-4 w-4 text-muted-foreground" />
                            <Input
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search (min 3 chars)"
                                className="h-8"
                            />
                        </div>

                        <ScrollArea className="max-h-72">
                            {/* Local clients first */}
                            {filteredClients.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                    {c.firstName} {c.lastName} — {c.username} ({c.email})
                                </SelectItem>
                            ))}

                            {/* Divider only if we have results */}
                            {searchResults.length > 0 && <Separator className="my-2" />}

                            {/* Remote search results (exclude already-listed ids) */}
                            {searchResults
                                .filter((c) => !clients.some((lc) => lc.id === c.id))
                                .map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                        {c.firstName} {c.lastName} — {c.username} ({c.email})
                                        <span className="ml-1 text-xs text-muted-foreground">(remote)</span>
                                    </SelectItem>
                                ))}

                            {searching && (
                                <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
                            )}
                            {!searching && searchTerm && searchResults.length === 0 && (
                                <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
                            )}
                        </ScrollArea>
                    </SelectContent>
                </Select>
            </div>

            {/* Button sits on the same row, right side */}
            <Button
                onClick={onGenerateOrder}
                disabled={!selectedClient || orderGenerated || !onGenerateOrder}
                className="whitespace-nowrap"
            >
                Generate Order
            </Button>
        </div>
    );
}
