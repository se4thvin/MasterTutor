// Preloaded (node --import) into every Vitest process on the shared CI host by run-on-host.sh.
// Testcontainers publishes ports on all interfaces and cannot label containers globally; on a
// shared server both matter. Every container a test starts is therefore published on 127.0.0.1
// only and carries the CI labels, so run-on-host.sh can remove exactly this run's containers.
import { GenericContainer } from "testcontainers";

type PortBindings = Record<string, Array<{ HostIp?: string }>>;

const runId = process.env["MT_CI_RUN_ID"];
if (!runId) throw new Error("testcontainers-ci: MT_CI_RUN_ID is not set");

const start = GenericContainer.prototype.start;
GenericContainer.prototype.start = function (this: GenericContainer) {
  const { hostConfig } = this as unknown as { hostConfig: { PortBindings?: PortBindings } };
  for (const bindings of Object.values(hostConfig.PortBindings ?? {}))
    for (const binding of bindings) binding.HostIp = "127.0.0.1";
  this.withLabels({ "mastertutor.ci": "1", "mastertutor.ci.run": runId });
  return start.call(this);
};
