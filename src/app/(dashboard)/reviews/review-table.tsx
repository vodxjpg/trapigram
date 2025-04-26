// File: src/app/(dashboard)/reviews/reviews-table.tsx
"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, ThumbsUp, Minus, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type Review = {
  id: string;
  orderId: string;
  text: string;
  rate: "positive" | "neutral" | "negative"; // <— renamed
  createdAt: string;
};

export function ReviewsTable() {
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalText, setModalText] = useState("");

  useEffect(() => {
    async function fetchReviews() {
      setLoading(true);
      try {
        const res = await fetch("/api/reviews");
        if (!res.ok) throw new Error("Failed to load reviews");
        const data = await res.json();
        setReviews(data.reviews);
      } catch (err: any) {
        console.error(err);
        toast.error(err.message || "Error fetching reviews");
      } finally {
        setLoading(false);
      }
    }
    fetchReviews();
  }, []);

  const renderRateIcon = (rate: Review["rate"]) => {
    switch (rate) {
      case "positive":
        return <ThumbsUp className="h-5 w-5 text-green-600" />;
      case "neutral":
        return <Minus className="h-5 w-5 text-gray-600" />;
      case "negative":
        return <ThumbsDown className="h-5 w-5 text-red-600" />;
      default:
        return null;
    }
  };

  return (
    <>
      {/* …header/search remains the same… */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Text</TableHead>
            <TableHead>Rate</TableHead> {/* header updated */}
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* …loading/empty logic… */}
          {reviews.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Link href={`/orders/${r.orderId}`} className="text-blue-600 hover:underline">
                  {r.orderId}
                </Link>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setModalText(r.text);
                    setModalOpen(true);
                  }}
                >
                  <Search className="h-5 w-5" />
                </Button>
              </TableCell>
              <TableCell>
                {renderRateIcon(r.rate)} {/* use r.rate */}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {/* Text-modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Text</DialogTitle>
          </DialogHeader>
          <DialogDescription className="whitespace-pre-wrap">
            {modalText}
          </DialogDescription>
          <DialogFooter>
            <DialogClose asChild>
              <Button>Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}