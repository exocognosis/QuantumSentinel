import net from "node:net";

export const LOCAL_NETWORK_DISCOVERY_MODE = "local-network";
export const LOCAL_NETWORK_SERVICE_GROUPS = Object.freeze([
  Object.freeze({
    id: "web-apps",
    label: "Websites and business applications",
    ports: Object.freeze([80, 443, 8080, 8443, 9443]),
  }),
  Object.freeze({
    id: "email",
    label: "Email and communications",
    ports: Object.freeze([25, 465, 587, 993, 995]),
  }),
  Object.freeze({
    id: "identity-files",
    label: "Sign-in and file access",
    ports: Object.freeze([389, 445, 636]),
  }),
  Object.freeze({
    id: "remote-network",
    label: "Remote access and network services",
    ports: Object.freeze([22, 53, 853, 3389]),
  }),
]);
export const LOCAL_NETWORK_PORTS = Object.freeze(LOCAL_NETWORK_SERVICE_GROUPS.flatMap((group) => group.ports));
export const LOCAL_NETWORK_MAX_HOSTS = 254;
export const LOCAL_NETWORK_MAX_OBSERVATIONS = 400;
export const LOCAL_NETWORK_TIMEOUT_MS = 300;
export const LOCAL_NETWORK_CONCURRENCY = 32;

function ipv4Octets(value) {
  if (net.isIP(value) !== 4) return null;
  return value.split(".").map(Number);
}

export function isRfc1918Ipv4(value) {
  const octets = ipv4Octets(value);
  if (!octets) return false;
  const [first, second] = octets;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

export function privateSlash24FromAddress(address) {
  const octets = ipv4Octets(address);
  if (!octets || !isRfc1918Ipv4(address)) {
    throw new Error("a private IPv4 address is required");
  }
  const prefix = octets.slice(0, 3).join(".");
  return {
    address,
    cidr: `${prefix}.0/24`,
    hosts: Array.from({ length: LOCAL_NETWORK_MAX_HOSTS }, (_, index) => `${prefix}.${index + 1}`),
  };
}

export function parsePrivateSlash24(cidr) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.0\/24$/.exec(String(cidr ?? "").trim());
  if (!match) return null;
  const networkAddress = `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}.0`;
  if (!isRfc1918Ipv4(networkAddress.replace(/\.0$/, ".1"))) return null;
  if (match.slice(1).some((part) => Number(part) > 255)) return null;
  return `${networkAddress}/24`;
}

export function isAddressInPrivateSlash24(address, cidr) {
  const normalizedCidr = parsePrivateSlash24(cidr);
  const octets = ipv4Octets(address);
  if (!normalizedCidr || !octets || !isRfc1918Ipv4(address)) return false;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24` === normalizedCidr
    && octets[3] >= 1
    && octets[3] <= 254;
}
