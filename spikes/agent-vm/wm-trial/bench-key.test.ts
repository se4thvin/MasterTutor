import assert from "node:assert/strict";
import test from "node:test";
import { authorizedKey } from "./bench-key.ts";
const fixture = () => ({ State: { Running:true }, Config: { Labels: { "com.docker.compose.service":"agent", "com.docker.compose.project":"mastertutor-bench" }, Env:["OTHER_SECRET=not-selected", "OPENAI_API_KEY=fake-test-key-123456789012345"] } });
test("select only the explicitly authorized running bench agent", () => {
  assert.equal(authorizedKey(fixture()), "fake-test-key-123456789012345");
  const stopped=fixture(); stopped.State.Running=false; assert.throws(()=>authorizedKey(stopped));
  const production=fixture(); production.Config.Labels["com.docker.compose.project"]="production"; assert.throws(()=>authorizedKey(production));
  const worker=fixture(); worker.Config.Labels["com.docker.compose.service"]="web"; assert.throws(()=>authorizedKey(worker));
  const absent=fixture(); absent.Config.Env=[]; assert.throws(()=>authorizedKey(absent));
});
