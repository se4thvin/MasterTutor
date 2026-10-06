import net from "node:net";

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** A minimal SMTP client (no auth, no TLS) for greenmail; test-only. */
export async function sendMail(host: string, port: number, message: MailMessage): Promise<void> {
  const socket = net.connect({ host, port });
  socket.setEncoding("utf8");
  const ready: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (let end = buffer.indexOf("\r\n"); end >= 0; end = buffer.indexOf("\r\n")) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!/^\d{3} /.test(line)) continue; // "250-..." continuation lines
      const next = waiting.shift();
      if (next) next(line);
      else ready.push(line);
    }
  });
  const reply = () =>
    new Promise<string>((resolve) => {
      const line = ready.shift();
      if (line === undefined) waiting.push(resolve);
      else resolve(line);
    });
  const expectCode = async (code: string) => {
    const line = await reply();
    if (!line.startsWith(code)) throw new Error(`SMTP expected ${code}, got ${line.slice(0, 3)}`);
  };
  const write = (line: string) => socket.write(`${line}\r\n`);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    await expectCode("220");
    write("EHLO fixtures.test");
    await expectCode("250");
    write(`MAIL FROM:<${message.from}>`);
    await expectCode("250");
    write(`RCPT TO:<${message.to}>`);
    await expectCode("250");
    write("DATA");
    await expectCode("354");
    write(
      [
        `From: ${message.from}`,
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        `Date: ${new Date().toUTCString()}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        message.text.replace(/^\./gm, ".."),
        ".",
      ].join("\r\n"),
    );
    await expectCode("250");
    write("QUIT");
  } finally {
    socket.end();
  }
}
