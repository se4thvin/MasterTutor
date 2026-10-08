import { STACK_CANARIES } from "../../security/canaries.ts";
import { GREENMAIL_USER } from "./greenmail.ts";
import { startVaultFixtures } from "./server.ts";

// The `vault-fixtures` Compose service (compose.test.yml): the login, OTP and WebAuthn fixture site
// on login.fixtures.test (tests/behaviour/constants.ts LOGIN), mailing codes to greenmail.
const fixtures = await startVaultFixtures({
  account: {
    email: STACK_CANARIES.username,
    password: STACK_CANARIES.password,
    totpSeed: STACK_CANARIES.totpSeed,
    pin: STACK_CANARIES.pin,
  },
  mail: {
    smtpHost: process.env.SMTP_HOST ?? "greenmail",
    smtpPort: 3025,
    to: GREENMAIL_USER.address,
  },
  listen: { host: process.env.HOST ?? "0.0.0.0", port: Number(process.env.PORT ?? "80") },
  fixedOtp: STACK_CANARIES.otp,
});
// The origin only: never the account.
console.log(JSON.stringify({ listening: fixtures.origin("login") }));
