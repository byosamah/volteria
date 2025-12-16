"use client";

/**
 * Site Test Button Component
 *
 * Client component wrapper that renders the test button and manages the modal state.
 * Used in the site dashboard header (which is a server component).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SiteTestModal } from "./site-test-modal";
import { Play } from "lucide-react";

interface SiteTestButtonProps {
  siteId: string;
  siteName: string;
}

export function SiteTestButton({ siteId, siteName }: SiteTestButtonProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setModalOpen(true)}
        className="w-full sm:w-auto min-h-[44px]"
      >
        <Play className="h-4 w-4 mr-2" />
        Run Test
      </Button>

      <SiteTestModal
        siteId={siteId}
        siteName={siteName}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  );
}
