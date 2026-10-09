/** Browser-safe literal checks shared by source validation and the network boundary. */
function isV4(ip: string): boolean {
  const parts = ip.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)
  );
}

/** [base, prefix length]: "this" network, RFC1918, CGNAT, loopback, link-local, IETF/documentation/benchmarking, multicast, reserved. */
const V4_BLOCKS: Array<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
}

function isPrivateV4(value: number): boolean {
  return V4_BLOCKS.some(([base, bits]) => value >>> (32 - bits) === base >>> (32 - bits));
}

/** Parses an IPv6 literal (with `::`, an optional dotted-quad tail and no brackets) into eight 16-bit groups. */
function parseV6(raw: string): number[] | null {
  let text = raw.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  const tail = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (tail?.[1] && tail[2]) {
    if (!isV4(tail[2])) return null;
    const value = v4ToInt(tail[2]);
    text = `${tail[1]}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string | undefined) => (part ? part.split(":") : []);
  const head = parse(halves[0]);
  const rest = parse(halves[1]);
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill("0"),
    ...rest,
  ].map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : Number.NaN));
  return groups.length === 8 && groups.every((group) => !Number.isNaN(group)) ? groups : null;
}

function isPrivateV6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const embedded = (hi: number, lo: number) => isPrivateV4(((hi << 16) | lo) >>> 0);
  // ::/96 covers :: and ::1 (and deprecated IPv4-compatible forms); ::ffff:0:0/96 is IPv4-mapped.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    return g5 === 0xffff ? embedded(g6, g7) : g5 === 0;
  }
  if (g0 === 0x64 && g1 === 0xff9b) {
    // NAT64: 64:ff9b::/96 embeds an IPv4 address; 64:ff9b:1::/48 is local-use.
    return g2 === 1
      ? true
      : g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0
        ? embedded(g6, g7)
        : false;
  }
  if (g0 === 0x2002) return embedded(g1, g2); // 6to4
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) return true; // Teredo, documentation
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // discard-only
  return (
    (g0 & 0xfe00) === 0xfc00 ||
    (g0 & 0xffc0) === 0xfe80 ||
    (g0 & 0xffc0) === 0xfec0 ||
    (g0 & 0xff00) === 0xff00
  );
}

/** Loopback, RFC1918, CGNAT, link-local (metadata), reserved ranges and their IPv6 / mapped forms (spec §5.5). */
export function isPrivateAddress(rawIp: string): boolean {
  const ip = rawIp.replace(/^\[|\]$/g, "");
  if (isV4(ip)) return isPrivateV4(v4ToInt(ip));
  const groups = parseV6(ip);
  // Anything that is not a valid literal is refused rather than trusted.
  return groups === null ? true : isPrivateV6(groups);
}

export function isLocalhost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return normalized === "localhost" || normalized.endsWith(".localhost");
}
