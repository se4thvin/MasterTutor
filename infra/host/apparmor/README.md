# mastertutor-slot AppArmor profile

The CI host keeps `kernel.apparmor_restrict_unprivileged_userns=1`, so containers under Docker's
default profile cannot create the user namespaces Chromium's sandbox needs. `mastertutor-slot` is
docker-default plus `userns,`. Only containers that opt in with
`security_opt: apparmor=mastertutor-slot` get it: the behaviour suite's slots, through
`tests/behaviour/compose.remote.yml`. Nothing else on the host changes.

## Install (once, on the host, with sudo)

From the synced repo (`scripts/remote-test.sh` puts it at `~/mt-ci/<worktree-name>/`):

```sh
sudo install -m 0644 -o root -g root ~/mt-ci/houndshark-remote/infra/host/apparmor/mastertutor-slot /etc/apparmor.d/mastertutor-slot
sudo apparmor_parser -r /etc/apparmor.d/mastertutor-slot
```

The profile in `/etc/apparmor.d/` is reloaded at boot. After editing it, repeat both commands.

## Verify

```sh
sudo aa-status | grep -w mastertutor-slot
```

`scripts/remote-test.sh behaviour` refuses to run until the profile is loaded.

## Remove

```sh
sudo apparmor_parser -R /etc/apparmor.d/mastertutor-slot && sudo rm /etc/apparmor.d/mastertutor-slot
```

## Production slots

`compose.prod.yml` runs every production slot with `security_opt: apparmor=mastertutor-slot`.
The Dokploy host is the same machine as the CI host (D45), so the profile installed above also
serves production. Loading or changing it is an operator step that needs the user's approval
(infra/deploy-runbook.md). The host sysctl `kernel.apparmor_restrict_unprivileged_userns` stays
at its default; nothing here changes it.

Docker Desktop (the Mac bench stack, D47) has no such profile: its local override drops the
`apparmor=` entry, which `tests/compose/prod-overlay.int.test.ts` proves works.

**P9-31 is blocked on the user:** whether production slots start under the profile can be checked
only after the user loads it with sudo (deploy runbook §0.4). Until then there is no result.
