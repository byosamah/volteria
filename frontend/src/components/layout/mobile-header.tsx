"use client";

/**
 * Mobile Header
 *
 * Shows logo and hamburger menu button on mobile devices.
 * Hidden on desktop (md:hidden).
 *
 * Features:
 * - 44x44px touch target for hamburger button (WCAG 2.2)
 * - Triggers the mobile sidebar via context
 */

import Image from "next/image";
import { useMobileNav } from "./mobile-nav-context";
import { Button } from "@/components/ui/button";

export function MobileHeader() {
  // Get the toggle function from context to open/close sidebar
  const { toggle } = useMobileNav();

  return (
    // Only show on mobile (hidden on md and above)
    <header className="md:hidden sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-card px-4">
      {/* Logo - simplified for mobile */}
      <div className="flex items-center gap-2">
        <Image
          src="/logo.svg"
          alt="Volteria"
          width={120}
          height={30}
          className="h-8 w-auto"
        />
      </div>

      {/* Hamburger button - 44x44px minimum tap target */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        className="min-w-[44px] min-h-[44px] flex items-center justify-center"
        aria-label="Open navigation menu"
        aria-expanded={false}
      >
        {/* Hamburger icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="18" x2="20" y2="18" />
        </svg>
      </Button>
    </header>
  );
}
