// components/CountInfo.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type InventoryData = {
    id: string;
    reference: string;
    name: string;
    countType: "all" | "specific";
    createdAt: string;
    username: string;
    email: string;
    isCompleted: boolean;
    isCounted: boolean;
};

export interface CountInfoProps {
    inventory: InventoryData;
}

export default function CountInfo({ inventory }: CountInfoProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg font-medium text-black">Count info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <div className="flex justify-between items-center py-2">
                            <span className="text-sm font-medium text-gray-900">Created by</span>
                            <span className="text-sm text-gray-600">
                                {inventory.username} - {inventory.email}
                            </span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                            <span className="text-sm font-medium text-gray-900">Warehouse</span>
                            <span className="text-sm text-gray-600">{inventory.name}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                            <span className="text-sm font-medium text-gray-900">Reference</span>
                            <span className="text-sm text-gray-600">{inventory.reference}</span>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center py-2">
                            <span className="text-sm font-medium text-gray-900">Count type</span>
                            <span className="text-sm text-gray-600">{inventory.countType}</span>
                        </div>
                        <div className="flex justify-between items-center py-2">
                            <span className="text-sm font-medium text-gray-900">Count started on</span>
                            <span className="text-sm text-gray-600">
                                {new Date(inventory.createdAt).toLocaleString()}
                            </span>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
