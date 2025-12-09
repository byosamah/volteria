"use client";

/**
 * Dashboard Layout
 *
 * Wraps all authenticated pages with:
 * - Desktop: Sidebar + main content
 * - Mobile: Header with hamburger + Sheet drawer sidebar
 *
 * MOBILE-FRIENDLY CHANGES:
 * - Uses MobileNavProvider for menu state
 * - Shows MobileHeader on mobile (md:hidden)
 * - Shows MobileSidebar (Sheet drawer) on mobile
 * - Desktop sidebar hidden on mobile (hidden md:flex)
 * - Uses min-h-screen instead of h-screen for better mobile viewport handling
 */

import { MobileNavProvider } from "./mobile-nav-context";
import { MobileHeader } from "./mobile-header";
import { MobileSidebar } from "./mobile-sidebar";
import { Sidebar } from "./sidebar";

interface DashboardLayoutProps {
  children: React.ReactNode;
  user?: {
    email?: string;
    full_name?: string;
    role?: string;
    avatar_url?: string;  // Profile picture URL from Supabase Storage
    enterprise_id?: string;  // Enterprise ID for showing My Controllers nav
  };
}

export function DashboardLayout({ children, user }: DashboardLayoutProps) {
  return (
    // Wrap everything in MobileNavProvider for shared menu state
    <MobileNavProvider>
      {/*
        Main container:
        - flex-col on mobile (header on top, content below)
        - flex-row on desktop (sidebar on left, content on right)
        - min-h-screen instead of h-screen to avoid mobile viewport issues
      */}
      <div className="flex flex-col md:flex-row min-h-screen">
        {/* Mobile Header - only visible on mobile (hidden on md and up) */}
        <MobileHeader />

        {/* Mobile Sidebar - Sheet drawer for mobile navigation */}
        <MobileSidebar user={user} />

        {/* Desktop Sidebar - hidden on mobile, visible on md and up */}
        <div className="hidden md:block">
          <Sidebar user={user} />
        </div>

        {/* Main content area - with safe area padding for mobile devices */}
        <main className="flex-1 overflow-auto bg-muted/30 pb-safe">
          {children}
        </main>
      </div>
    </MobileNavProvider>
  );
}
