"use client";

import type { ApprovalMode } from "@mastertutor/contracts";
import { useId, useState } from "react";
import { BypassConsent } from "@/components/approval-mode/bypass-consent.tsx";
import {
  APPROVAL_MODE_ITEMS,
  APPROVAL_MODE_SHORT,
  APPROVAL_MODE_TEXT,
} from "@/components/approval-mode/modes.ts";
import { Button } from "@/components/ui/button.tsx";
import { Icon } from "@/components/ui/icon.tsx";
import { Menu, MenuPanel } from "@/components/ui/menu.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { modeTriggerProps } from "./mode-trigger.tsx";

/**
 * The run's approval mode, changeable while it runs (run-mode): a toolbar menu of the three modes.
 * Bypass first shows New task's warning and needs the same acknowledgement (D44). Disabled once
 * the run has finished.
 */
export function ModeControl({
  mode,
  disabled,
  onChange,
}: {
  mode: ApprovalMode;
  disabled: boolean;
  onChange(mode: ApprovalMode): void;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const choose = (next: ApprovalMode) => {
    if (next === mode) return;
    if (next !== "bypass") return onChange(next);
    // A fresh acknowledgement every time, never remembered (as on New task).
    setAcknowledged(false);
    setConfirming(true);
  };
  return (
    <>
      <Menu.Root>
        <Menu.Trigger {...modeTriggerProps(mode, disabled)} />
        <MenuPanel className="run-mode-menu">
          <Menu.Group>
            <Menu.GroupLabel className="eyebrow run-mode-heading">Approvals</Menu.GroupLabel>
            <Menu.RadioGroup value={mode} onValueChange={(next) => choose(next as ApprovalMode)}>
              {APPROVAL_MODE_ITEMS.map((item) => (
                <Menu.RadioItem
                  key={item.value}
                  value={item.value}
                  closeOnClick
                  className="menu-item run-mode-item"
                >
                  <span className="run-mode-check" aria-hidden="true">
                    <Menu.RadioItemIndicator>
                      <Icon name="check" size="sm" />
                    </Menu.RadioItemIndicator>
                  </span>
                  <span className="run-mode-text">
                    <span>{item.label}</span>
                    <span className="run-mode-desc">{APPROVAL_MODE_TEXT[item.value]}</span>
                  </span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Group>
        </MenuPanel>
      </Menu.Root>
      <Sheet
        open={confirming}
        onOpenChange={setConfirming}
        title="Switch this run to Bypass?"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Keep {APPROVAL_MODE_SHORT[mode]}</Button>
            <Button
              variant="danger"
              disabled={!acknowledged}
              onClick={() => {
                setConfirming(false);
                onChange("bypass");
              }}
            >
              Switch to Bypass
            </Button>
          </>
        }
      >
        <BypassConsent
          id={`${id}-bypass`}
          checked={acknowledged}
          onChange={setAcknowledged}
          label="I understand. Switch this run to bypass mode."
        />
      </Sheet>
    </>
  );
}
