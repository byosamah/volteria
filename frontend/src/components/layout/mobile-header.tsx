"use client";

/**
 * Mobile Header
 *
 * Shows logo, notification bell, and hamburger menu button on mobile devices.
 * Hidden on desktop (md:hidden).
 *
 * Features:
 * - 44x44px touch target for all buttons (WCAG 2.2)
 * - Notification bell with unread count
 * - Triggers the mobile sidebar via context
 */

import Image from "next/image";
import Link from "next/link";
import { useMobileNav } from "./mobile-nav-context";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notifications/notification-bell";

interface MobileHeaderProps {
  userId?: string;
}

export function MobileHeader({ userId }: MobileHeaderProps) {
  // Get the toggle function and open state from context
  const { isOpen, toggle } = useMobileNav();

  return (
    // Only show on mobile (hidden on md and above)
    <header className="md:hidden sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-card px-4">
      {/* Logo - clickable to dashboard */}
      <Link href="/" className="flex items-center gap-2">
        <Image
          src="/logo.svg"
          alt="Volteria"
          width={120}
          height={30}
          className="h-8 w-auto"
        />
      </Link>

      {/* Right side actions */}
      <div className="flex items-center gap-1">
        {/* Notification Bell - only show if user is logged in */}
        {userId && <NotificationBell userId={userId} />}

        {/* Hamburger button - 44x44px minimum tap target */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Open navigation menu"
          aria-expanded={isOpen}
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
      </div>
    </header>
  );
}
