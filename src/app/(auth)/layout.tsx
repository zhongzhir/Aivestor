import Footer from "@/components/Footer";

// 认证页外壳：极简、居中、大量留白，不含侧栏。底部固定 Footer（ICP 备案）。
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm">{children}</div>
      </div>
      <Footer />
    </div>
  );
}
