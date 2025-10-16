"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Search } from "lucide-react";

type Props = {
    disabled?: boolean;
    clientsLoading: boolean;
    filteredClients: any[];
    searchResults: any[];
    searching: boolean;
    searchTerm: string;
    setSearchTerm: (v: string) => void;
    selectedClient: string;
    pickClient: (id: string, obj: any) => void;
};

export function ClientSelect(props: Props) {
    const {
        disabled, clientsLoading, filteredClients, searchResults, searching,
        searchTerm, setSearchTerm, selectedClient, pickClient,
    } = props;

    return (
        <div>
            <Label>Select Client</Label>
            <Select
                value={selectedClient}
                onValueChange={(val) => {
                    const obj = [...filteredClients, ...searchResults].find(c => c.id === val);
                    if (obj) pickClient(val, obj);
                }}
                disabled={disabled || clientsLoading}
            >
                <SelectTrigger><SelectValue placeholder={clientsLoading ? "Loading…" : "Select or search client"} /></SelectTrigger>
                <SelectContent className="w-[450px]">
                    <div className="p-3 border-b flex items-center gap-2">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        <Input value={searchTerm} onChange={(e) => props.setSearchTerm(e.target.value)} placeholder="Search (min 3 chars)" className="h-8" />
                    </div>
                    <ScrollArea className="max-h-72">
                        {filteredClients.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName} — {c.username} ({c.email})</SelectItem>
                        ))}
                        {searchResults.length > 0 && <Separator className="my-2" />}
                        {searchResults.filter(c => !filteredClients.some(lc => lc.id === c.id)).map(c => (
                            <SelectItem key={c.id} value={c.id}>
                                {c.firstName} {c.lastName} — {c.username} ({c.email})
                                <span className="ml-1 text-xs text-muted-foreground">(remote)</span>
                            </SelectItem>
                        ))}
                        {searching && <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>}
                        {!searching && searchTerm && searchResults.length === 0 && (
                            <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
                        )}
                    </ScrollArea>
                </SelectContent>
            </Select>
        </div>
    );
}
