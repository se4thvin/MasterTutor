// Runs inside the running agent container, fed on stdin by stack-canary.ts:
//   docker compose exec -T -w /app/packages/storage agent node --input-type=module-typescript -
// From there @aws-sdk/client-s3 resolves and the agent's own S3_* env applies. Writes one JSON
// line per Garage object ({"key", "body": base64}) to stdout; nothing is written in the container.
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const env = process.env;
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION ?? "garage",
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
  },
});
const bucket = env.S3_BUCKET ?? "mastertutor";
let token: string | undefined;
do {
  const page = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
  );
  for (const item of page.Contents ?? []) {
    if (!item.Key) continue;
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: item.Key }));
    const body = Buffer.from((await object.Body?.transformToByteArray()) ?? []);
    process.stdout.write(`${JSON.stringify({ key: item.Key, body: body.toString("base64") })}\n`);
  }
  token = page.NextContinuationToken;
} while (token);
