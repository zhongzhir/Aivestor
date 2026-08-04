import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { RegisterForm } from "@/components/auth/RegisterForm";

export const metadata: Metadata = { title: `注册 · ${BRAND.shortProductName}` };

export default function RegisterPage() {
  return <RegisterForm />;
}
