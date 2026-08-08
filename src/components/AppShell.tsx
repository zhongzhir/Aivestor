"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

export function AppShell({
  children,
  hasOrganization,
}: {
  children: React.ReactNode;
  hasOrganization: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        hasOrganization={hasOrganization}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen && (
        <button
          type="button"
          aria-label="关闭导航菜单"
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenuOpen={() => setSidebarOpen(true)} />
        <main className="min-w-0 flex-1 overflow-y-auto bg-canvas">{children}</main>
      </div>
    </div>
  );
}
