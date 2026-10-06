import { createElement as h, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";

/** A React-controlled login: the submit sends React state, so it only works if onChange fired. */
function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setStatus(response.ok ? "Signed in" : "Wrong credentials");
  }
  return h(
    "form",
    { onSubmit: submit },
    h("label", { htmlFor: "r-email" }, "Email"),
    h("input", {
      id: "r-email",
      type: "email",
      autoComplete: "username",
      value: email,
      onChange: (e: { currentTarget: HTMLInputElement }) => setEmail(e.currentTarget.value),
    }),
    h("label", { htmlFor: "r-password" }, "Password"),
    h("input", {
      id: "r-password",
      type: "password",
      autoComplete: "current-password",
      value: password,
      onChange: (e: { currentTarget: HTMLInputElement }) => setPassword(e.currentTarget.value),
    }),
    h(
      "button",
      { id: "r-submit", type: "submit", disabled: email === "" || password === "" },
      "Sign in",
    ),
    h("p", { id: "status" }, status),
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(h(App));
