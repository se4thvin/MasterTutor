"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, type CSSProperties, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { TextField } from "@/components/ui/text-field.tsx";
import { authClient, authErrorCopy } from "@/lib/auth-client.ts";
import { safeNextPath } from "@/lib/auth/next-path.ts";

/** The heading's words rise in on a short stagger (word-stagger pattern; not SplitText/BlurText). */
function Words({ text }: { text: string }) {
  return text.split(" ").map((word, i) => (
    <Fragment key={i}>
      {i > 0 ? " " : null}
      <span className="word" style={{ "--i": i } as CSSProperties}>
        {word}
      </span>
    </Fragment>
  ));
}

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const signUp = mode === "sign-up";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();
    setPending(true);
    setError(null);
    try {
      const result = signUp
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(authErrorCopy(result.error, mode));
        return;
      }
    } catch {
      // A thrown request never got an answer.
      setError(authErrorCopy({ network: true }, mode));
      return;
    } finally {
      setPending(false);
    }
    // Back to where an expired session interrupted the user, if that is a safe app path.
    router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    router.refresh();
  }

  return (
    <form className="auth-card" onSubmit={onSubmit}>
      <h1 className="t-title1">
        <Words text={signUp ? "Create account" : "Sign in"} />
      </h1>
      <p className="t-callout muted">
        {signUp ? "The first account owns this workspace." : "Welcome back."}
      </p>
      <div className="auth-fields">
        {signUp ? <TextField name="name" label="Name" autoComplete="name" required /> : null}
        <TextField
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          inputMode="email"
          required
        />
        <TextField
          name="password"
          type="password"
          label="Password"
          autoComplete={signUp ? "new-password" : "current-password"}
          minLength={signUp ? 12 : undefined}
          hint={signUp ? "At least 12 characters." : undefined}
          required
        />
      </div>
      {error ? (
        <p className="tf-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {signUp ? "Create account" : "Sign in"}
      </Button>
      <p className="t-foot">
        {signUp ? (
          <>
            Have an account? <Link href="/sign-in">Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link href="/sign-up">Create an account</Link>
          </>
        )}
      </p>
    </form>
  );
}
