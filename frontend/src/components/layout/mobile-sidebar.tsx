"use client";

/**
 * Mobile Sidebar
 *
 * Slide-in navigation drawer for mobile devices.
 * Uses shadcn Sheet component with "left" side positioning.
 *
 * Features:
 * - 44px minimum tap targets for all navigation items (WCAG 2.2)
 * - Same navigation items as desktop sidebar
 * - Closes when clicking a link
 * - User menu at bottom
 * - Admin section (for super_admin and backend_admin)
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useMobileNav } from "./mobile-nav-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";

// Navigation items (same as desktop sidebar)
// hideFromViewer: true means the item is hidden from viewer role users
const navItems = [
  {
    title: "Dashboard",
    href: "/",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect width="7" height="9" x="3" y="3" rx="1" />
        <rect width="7" height="5" x="14" y="3" rx="1" />
        <rect width="7" height="9" x="14" y="12" rx="1" />
        <rect width="7" height="5" x="3" y="16" rx="1" />
      </svg>
    ),
  },
  {
    title: "Projects",
    href: "/projects",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
      </svg>
    ),
  },
  {
    title: "Alarms",
    href: "/alarms",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    ),
  },
  {
    title: "Historical Data",
    href: "/historical-data",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M3 3v18h18" />
        <path d="M18 17V9" />
        <path d="M13 17V5" />
        <path d="M8 17v-3" />
      </svg>
    ),
  },
  {
    title: "My Controllers",
    href: "/controllers",
    hideFromViewer: true,  // Viewers cannot access controllers
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <line x1="8" x2="16" y1="21" y2="21" />
        <line x1="12" x2="12" y1="17" y2="21" />
      </svg>
    ),
  },
  {
    title: "Device Templates",
    href: "/devices",
    hideFromViewer: true,  // Viewers cannot access device templates
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M12 12h.01" />
        <path d="M17 12h.01" />
        <path d="M7 12h.01" />
      </svg>
    ),
  },
  {
    title: "System Settings",
    href: "/settings",
    hideFromViewer: true,  // Viewers cannot access system settings
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

// Admin navigation items - visible to super_admin, backend_admin, and enterprise_admin
const adminNavItems = [
  {
    title: "Enterprises",
    href: "/admin/enterprises",
    roles: ["super_admin"],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M3 21h18" />
        <path d="M9 8h1" />
        <path d="M9 12h1" />
        <path d="M9 16h1" />
        <path d="M14 8h1" />
        <path d="M14 12h1" />
        <path d="M14 16h1" />
        <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
      </svg>
    ),
  },
  {
    title: "Users",
    href: "/admin/users",
    // super_admin, backend_admin see all users; enterprise_admin sees their enterprise users
    roles: ["super_admin", "backend_admin", "enterprise_admin"],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    title: "Controllers",
    href: "/admin/controllers",
    roles: ["super_admin", "backend_admin"],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <line x1="8" x2="16" y1="21" y2="21" />
        <line x1="12" x2="12" y1="17" y2="21" />
      </svg>
    ),
  },
  {
    title: "Hardware",
    href: "/admin/hardware",
    roles: ["super_admin", "backend_admin"],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M9 1v3" />
        <path d="M15 1v3" />
        <path d="M9 20v3" />
        <path d="M15 20v3" />
        <path d="M20 9h3" />
        <path d="M20 14h3" />
        <path d="M1 9h3" />
        <path d="M1 14h3" />
      </svg>
    ),
  },
  {
    title: "Data Usage",
    href: "/admin/data-usage",
    // Only super_admin and backend_admin can view data usage analytics
    roles: ["super_admin", "backend_admin"],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5V19A9 3 0 0 0 21 19V5" />
        <path d="M3 12A9 3 0 0 0 21 12" />
      </svg>
    ),
  },
  {
    title: "Audit Logs",
    href: "/admin/audit-logs",
    // Only super_admin, backend_admin, and admin can view audit logs
    roles: ["super_admin", "backend_admin", "admin"],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
        <path d="M12 8v4l3 3" />
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
  },
];

interface MobileSidebarProps {
  user?: {
    email?: string;
    full_name?: string;
    role?: string;
    avatar_url?: string;  // Profile picture URL from Supabase Storage
    enterprise_id?: string;  // Enterprise ID for showing My Controllers nav
  };
}

export function MobileSidebar({ user }: MobileSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  // Get mobile nav state from context
  const { isOpen, setIsOpen } = useMobileNav();

  // Track fetched role and enterprise_id (only used if props not provided)
  const [fetchedRole, setFetchedRole] = useState<string | undefined>(undefined);
  const [fetchedEnterpriseId, setFetchedEnterpriseId] = useState<string | undefined>(undefined);

  // Derive role and enterprise_id from props OR fetched values
  // Using props directly avoids flash - props are available immediately on server render
  const userRole = user?.role || fetchedRole;
  const userEnterpriseId = user?.enterprise_id || fetchedEnterpriseId;

  // Fetch user role and enterprise_id only if not provided via props
  useEffect(() => {
    // If user is empty object (loading state), skip fetch
    // The actual page will provide full user data when it renders
    if (!user || Object.keys(user).length === 0) {
      return;
    }

    // If both are already provided via props, no need to fetch
    if (user?.role && user?.enterprise_id !== undefined) {
      return;
    }

    const fetchUserData = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser?.id) {
        const { data: userData } = await supabase
          .from("users")
          .select("role, enterprise_id")
          .eq("id", authUser.id)
          .single();
        if (userData?.role && !user?.role) {
          setFetchedRole(userData.role);
        }
        if (userData?.enterprise_id && !user?.enterprise_id) {
          setFetchedEnterpriseId(userData.enterprise_id);
        }
      }
    };

    fetchUserData();
  }, [user?.role, user?.enterprise_id, supabase]);

  // Handle logout
  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Logged out successfully");
    setIsOpen(false); // Close sidebar
    router.push("/login");
    router.refresh();
  };

  // Get user initials for avatar
  const userInitials = user?.full_name
    ? user.full_name.split(" ").map((n) => n[0]).join("").toUpperCase()
    : user?.email?.charAt(0).toUpperCase() || "U";

  // Format display name as "J. Smith" (first initial + last name)
  // Falls back to email if no full_name available
  const formatDisplayName = () => {
    if (user?.full_name) {
      const parts = user.full_name.trim().split(" ");
      if (parts.length >= 2) {
        const firstInitial = parts[0].charAt(0).toUpperCase();
        const lastName = parts[parts.length - 1];
        return `${firstInitial}. ${lastName}`;
      }
      return user.full_name; // Single name, just return it
    }
    return user?.email || "User";
  };

  // Close sidebar when clicking a link
  const handleLinkClick = () => {
    setIsOpen(false);
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent side="left" className="w-[280px] p-0 flex flex-col">
        {/* Header with logo */}
        <SheetHeader className="p-4 pb-0">
          <SheetTitle className="flex items-center gap-2">
            <Image
              src="/logo.svg"
              alt="Volteria"
              width={140}
              height={35}
              className="h-9 w-auto"
            />
          </SheetTitle>
          <p className="text-sm text-muted-foreground">Energy Management</p>
        </SheetHeader>

        <Separator className="my-4" />

        {/* Navigation - 44px minimum tap targets */}
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems
            // Filter out items hidden from viewers
            .filter((item) => !item.hideFromViewer || userRole !== "viewer")
            .map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleLinkClick}
                className={cn(
                  // Base styles with 44px min-height for touch targets
                  "flex items-center gap-3 rounded-lg px-4 min-h-[44px] text-base transition-colors",
                  // Active state styling
                  isActive
                    ? "bg-[#6baf4f] text-white"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {item.icon}
                {item.title}
              </Link>
            );
          })}

          {/* Admin section - shown to super_admin, backend_admin, and enterprise_admin */}
          {userRole && (userRole === "super_admin" || userRole === "backend_admin" || userRole === "enterprise_admin") && (
            <>
              <div className="pt-4 pb-2">
                <span className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Admin
                </span>
              </div>
              {adminNavItems
                .filter((item) => item.roles.includes(userRole))
                .map((item) => {
                  const isActive = pathname === item.href ||
                    pathname.startsWith(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={handleLinkClick}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-4 min-h-[44px] text-base transition-colors",
                        isActive
                          ? "bg-[#6baf4f] text-white"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {item.icon}
                      {item.title}
                    </Link>
                  );
                })}
            </>
          )}
        </nav>

        <Separator />

        {/* User section at bottom */}
        <div className="p-4 mt-auto">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-10 w-10">
              {/* Show profile picture if available, otherwise show initials */}
              <AvatarImage src={user?.avatar_url} alt="Profile picture" />
              <AvatarFallback className="bg-primary text-primary-foreground">
                {userInitials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0">
              <span className="font-medium text-sm truncate">
                {formatDisplayName()}
              </span>
              {/* Show email as secondary text if user has full_name */}
              {user?.full_name && user?.email && (
                <span className="text-xs text-muted-foreground truncate">
                  {user.email}
                </span>
              )}
            </div>
          </div>

          {/* Logout button - 44px height */}
          <Button
            variant="outline"
            onClick={handleLogout}
            className="w-full min-h-[44px] text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            Log out
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
