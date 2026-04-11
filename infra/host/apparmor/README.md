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
