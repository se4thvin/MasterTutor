import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form.tsx";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}
