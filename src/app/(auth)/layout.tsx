// 认证页外壳：极简、居中、大量留白，不含侧栏与底脚。
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
