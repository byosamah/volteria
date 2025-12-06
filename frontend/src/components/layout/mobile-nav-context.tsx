"use client";

/**
 * Mobile Navigation Context
 *
 * Provides global state for mobile menu open/close.
 * Used by MobileHeader (hamburger) and MobileSidebar (Sheet drawer).
 */

import { createContext, useContext, useState, ReactNode } from "react";

// Define the shape of our context
interface MobileNavContextType {
  isOpen: boolean;        // Is the mobile sidebar open?
  setIsOpen: (open: boolean) => void;  // Function to set open state
  toggle: () => void;     // Toggle open/closed
}

// Create the context with undefined as default (will be set by provider)
const MobileNavContext = createContext<MobileNavContextType | undefined>(undefined);

// Provider component that wraps parts of the app that need mobile nav state
export function MobileNavProvider({ children }: { children: ReactNode }) {
  // State to track if mobile sidebar is open
  const [isOpen, setIsOpen] = useState(false);

  // Toggle function for convenience
  const toggle = () => setIsOpen((prev) => !prev);

  return (
    <MobileNavContext.Provider value={{ isOpen, setIsOpen, toggle }}>
      {children}
    </MobileNavContext.Provider>
  );
}

// Custom hook to use the mobile nav context
// Throws error if used outside of MobileNavProvider
export function useMobileNav() {
  const context = useContext(MobileNavContext);

  if (context === undefined) {
    throw new Error("useMobileNav must be used within a MobileNavProvider");
  }

  return context;
}
