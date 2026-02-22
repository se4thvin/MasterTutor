"use client";

import type { VaultItemView } from "@mastertutor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/toast/toast-provider.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/ui/confirm-dialog.tsx";
import { EmptyState } from "@/components/ui/empty-state.tsx";
import { LoadError } from "@/components/ui/load-error.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { PageHead } from "@/components/ui/page-head.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Crumbs, Toolbar, ToolbarSpacer } from "@/components/ui/toolbar.tsx";
import { api, orpc } from "@/lib/api/client.ts";
import { AddSignInSheet } from "./add-sign-in-sheet.tsx";
import { Cutaway } from "./cutaway.tsx";
import { SecretSheet } from "./secret-sheet.tsx";
import { VaultRow } from "./vault-row.tsx";

type VaultList = { items: VaultItemView[] };

export function VaultView() {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery(orpc.vault.list.queryOptions({ input: {} }));
  const { data, isPending } = list;
  const key = orpc.vault.list.queryKey({ input: {} });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<VaultItemView | null>(null);
  // The item outlives the dialog's open state so its title stays put while it animates out.
  const [deleting, setDeleting] = useState<VaultItemView | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const askDelete = (item: VaultItemView) => {
    setDeleting(item);
    setConfirmingDelete(true);
  };

  const setSessionSaved = (itemId: string, sessionSaved: boolean) =>
    qc.setQueryData<VaultList>(
      key,
      (old) =>
        old && { items: old.items.map((i) => (i.id === itemId ? { ...i, sessionSaved } : i)) },
    );

  const signOut = async (item: VaultItemView) => {
    // A refetch in flight would overwrite the optimistic row with the old session state.
    await qc.cancelQueries({ queryKey: key });
    setSessionSaved(item.id, false);
    try {
      await api.vault.forgetSession({ alias: item.alias, origin: item.origin });
      toast({ title: `Signed out of ${item.alias}`, icon: "signOut" });
    } catch {
      // Restore only this row, so a concurrent change to another sign-in survives.
      setSessionSaved(item.id, item.sessionSaved);
      toast({ title: "Couldn't sign out.", icon: "needsReview", tone: "danger" });
    }
  };

  const deleteItem = async (item: VaultItemView) => {
    await qc.cancelQueries({ queryKey: key });
    const index = qc.getQueryData<VaultList>(key)?.items.findIndex((i) => i.id === item.id) ?? -1;
    qc.setQueryData<VaultList>(
      key,
      (old) => old && { items: old.items.filter((i) => i.id !== item.id) },
    );
    try {
      await api.vault.delete({ itemId: item.id });
      toast({ title: `Deleted ${item.alias}`, icon: "delete" });
    } catch {
      // Put back only this row, where it was, so concurrent changes to other sign-ins survive.
      qc.setQueryData<VaultList>(key, (old) => {
        if (!old || old.items.some((i) => i.id === item.id)) return old;
        const items = [...old.items];
        items.splice(index < 0 ? items.length : Math.min(index, items.length), 0, item);
        return { items };
      });
      toast({ title: "Couldn't delete the sign-in.", icon: "needsReview", tone: "danger" });
    }
  };

  return (
    <>
      <Toolbar>
        <Crumbs items={[{ label: "Vault" }]} />
        <ToolbarSpacer />
        <Button variant="primary" icon="add" onClick={() => setAdding(true)}>
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
            Sign-ins{data ? <span className="muted"> · {data.items.length}</span> : null}
          </h2>
          <span className="t-foot">Values are write-only. Replace or remove, never reveal.</span>
        </div>
        {list.isError && !data ? (
          <LoadError
            title="Couldn't load your sign-ins."
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
          />
        ) : isPending ? (
          <div className="group" role="status" aria-busy="true" aria-label="Loading sign-ins">
            <Skeleton className="m-4 h-12" />
            <Skeleton className="m-4 h-12" />
          </div>
        ) : data?.items.length ? (
          <ul className="group vlist" aria-label="Sign-ins">
            {data.items.map((item) => (
              <VaultRow
                key={item.id}
                item={item}
                onSignOut={(i) => void signOut(i)}
                onReplace={setEditing}
                onDelete={askDelete}
              />
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
      <AddSignInSheet open={adding} onOpenChange={setAdding} />
      <SecretSheet item={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete “${deleting?.label ?? ""}”?`}
        description="The agent loses this sign-in and its saved session. The audit history stays."
        confirmLabel="Delete Sign-in"
        destructive
        onConfirm={() => deleting && void deleteItem(deleting)}
      />
    </>
  );
}
