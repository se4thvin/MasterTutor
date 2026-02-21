"use client";

import type { VaultItemView } from "@mastertutor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { Cutaway } from "./cutaway.tsx";
import { VaultRow } from "./vault-row.tsx";

type VaultList = { items: VaultItemView[] };

export function VaultView() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isPending } = useQuery(orpc.vault.list.queryOptions({ input: {} }));
  const key = orpc.vault.list.queryKey({ input: {} });

  const signOut = async (item: VaultItemView) => {
    const previous = qc.getQueryData<VaultList>(key);
    qc.setQueryData<VaultList>(
      key,
      (old) =>
        old && {
          items: old.items.map((i) => (i.id === item.id ? { ...i, sessionSaved: false } : i)),
        },
    );
    try {
      await api.vault.forgetSession({ alias: item.alias, origin: item.origin });
      toast({ title: `Signed out of ${item.alias}`, icon: "signOut" });
    } catch {
      qc.setQueryData(key, previous);
      toast({ title: "Couldn't sign out.", icon: "needsReview", tone: "danger" });
    }
  };

  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Vault" }]} />
        <ToolbarSpacer />
        {/* Enabled when the add-sign-in sheet lands (Task 25). */}
        <Button variant="primary" icon="add" disabled>
          Add sign-in
        </Button>
      </Toolbar>
      <div className="wrap">
        <PageHead
          title="Vault"
          lede="Sign-ins the agent can use by alias. Each one is bound to a single website."
        />
        <Cutaway />
        <div className="group-h">
          <h2 className="t-title3">
            Sign-ins <span className="muted">· {data?.items.length ?? 0}</span>
          </h2>
          <span className="t-foot">Values are write-only. Replace or remove, never reveal.</span>
        </div>
        {isPending ? (
          <div className="group" role="status" aria-busy="true" aria-label="Loading sign-ins">
            <Skeleton className="m-4 h-12" />
            <Skeleton className="m-4 h-12" />
          </div>
        ) : data?.items.length ? (
          <ul className="group vlist" aria-label="Sign-ins">
            {data.items.map((item) => (
              <VaultRow key={item.id} item={item} onSignOut={(i) => void signOut(i)} />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="vault"
            title="No sign-ins yet"
            body="Add a sign-in so the agent can log in to a site without ever seeing the password."
          />
        )}
        <section className="never" aria-labelledby="never-title">
          <Icon name="hidden" size="lg" />
          <div>
            <h2 id="never-title" className="t-title3">
              Secrets are never shown.
            </h2>
            <p>
              <b>Not to the agent, and not to you after saving.</b> Passwords, authenticator keys
              and PINs are sealed the moment you save them. Codes you type during a run go straight
              to the browser; the model only learns that a code was entered. Screenshots are masked
              while a field is filled.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
