import { GREENMAIL_USER } from "../fixtures/vault-sites/greenmail.ts";

/**
 * The secret canaries of the full test stack (spec §12): the vault-fixture site's account and the
 * greenmail mailbox password. One source of truth (X6). Only the vault-fixture bin serves them, and
 * Task 6's stack scan searches for them (P7-39). Long and distinctive, so a hit is never chance.
 * Test-only values: the stack is destroyed after every run.
 */
export const STACK_CANARIES = {
  username: "PELICAN5CANARY2@fixtures.test",
  password: "OSPREY8CANARY1LANTERN",
  totpSeed: "PELICANCANARYSEEDQ7X2KZ4MWV3RTYB",
  pin: "582614",
  imapPassword: GREENMAIL_USER.password,
} as const;
