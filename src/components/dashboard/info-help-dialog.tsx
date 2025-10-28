"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogTrigger,
    DialogClose,
} from "@/components/ui/dialog";
import {
    Tooltip,
    TooltipProvider,
    TooltipTrigger,
    TooltipContent,
} from "@/components/ui/tooltip";

export type InfoHelpDialogProps = {
    /** Small tooltip that appears on hover/focus of the icon button */
    tooltip?: string;
    /** Dialog title */
    title: string;
    /**
     * Dialog body passed as a prop. Can be string or rich JSX (paragraphs, lists, etc.).
     * If provided, this takes precedence over `children`.
     */
    content?: React.ReactNode;
    /** Dialog body as children (kept for backward compatibility if `content` is not provided). */
    children?: React.ReactNode;
    /** Optional aria-label for the icon button */
    ariaLabel?: string;
    /** Optional className for the trigger button */
    className?: string;
    /** Optional: pass additional props to DialogContent (e.g., className="sm:max-w-lg") */
    contentClassName?: string;
    /**
     * Optional: customize trigger (defaults to Info icon button).
     * If provided, we still wrap it with Tooltip + DialogTrigger.
     */
    trigger?: React.ReactElement;
};

/**
 * Reusable “info tooltip + dialog” helper.
 * Renders a small Info icon button with a tooltip; clicking opens a dialog with a title and body.
 */
export default function InfoHelpDialog({
    tooltip,
    title,
    content,
    children,
    ariaLabel = "More information",
    className,
    contentClassName,
    trigger,
}: InfoHelpDialogProps) {
    const body = content ?? children;

    return (
        <Dialog>
            <TooltipProvider>
                <Tooltip>
                    <DialogTrigger asChild>
                        <TooltipTrigger asChild>
                            {trigger ? (
                                React.cloneElement(trigger, {
                                    "aria-label": ariaLabel,
                                })
                            ) : (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className={["h-6 w-6 p-0", className].filter(Boolean).join(" ")}
                                    aria-label={ariaLabel}
                                >
                                    <Info className="h-4 w-4" />
                                </Button>
                            )}
                        </TooltipTrigger>
                    </DialogTrigger>
                    <TooltipContent>{tooltip ?? title}</TooltipContent>
                </Tooltip>
            </TooltipProvider>

            <DialogContent className={contentClassName}>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                {/* Body: supports either `content` prop or `children` fallback */}
                <div className="text-sm space-y-3">{body}</div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button">Got it</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
