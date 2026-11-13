"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { MobileBottomNav } from "@/components/MobileBottomNav";

export function AppShell({
  children,
  hasOrganization,
}: {
  children: React.ReactNode;
  hasOrganization: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSidebar();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeSidebar, sidebarOpen]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        hasOrganization={hasOrganization}
        mobileOpen={sidebarOpen}
        onMobileClose={closeSidebar}
      />
      {sidebarOpen && (
        <button
          type="button"
          aria-label="关闭导航菜单"
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={closeSidebar}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          menuButtonRef={menuButtonRef}
          onMenuOpen={() => setSidebarOpen(true)}
        />
        <main className="min-w-0 flex-1 overflow-y-auto bg-canvas pb-20 md:pb-0">
          {children}
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
