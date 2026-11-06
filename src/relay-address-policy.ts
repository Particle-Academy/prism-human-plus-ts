import { BlockList, isIP } from 'node:net';

// Shared explicit relay range policy; classify embedded IPv4 before IPv6 ranges.
const NON_PUBLIC_V4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) NON_PUBLIC_V4.addSubnet(address, prefix, 'ipv4');
const NON_PUBLIC_V6 = new BlockList();
for (const [address, prefix] of [
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 32], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10],
  ['fec0::', 10], ['ff00::', 8],
] as const) NON_PUBLIC_V6.addSubnet(address, prefix, 'ipv6');

// NAT64 and 6to4 carry an IPv4 address inside an IPv6 one, and the packet goes to the embedded address, so that is
// what is judged. Not refused outright: a DNS64 network gives public sites 64:ff9b:: addresses.
// [prefix, bits, byte offset of the embedded IPv4]
const EMBEDDING: readonly (readonly [string, number, number])[] = [
  ['::ffff:0:0', 96, 12],
  ['64:ff9b::', 96, 12],
  ['2002::', 16, 2],
];

export function isNonPublicAddress(address: string): boolean {
  if (address.includes('%')) return true;
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    for (const [prefix, bits, offset] of EMBEDDING) {
      const range = new BlockList();
      range.addSubnet(prefix, bits, 'ipv6');
      if (range.check(address, 'ipv6')) return isNonPublicAddress(ipv6Bytes(address).slice(offset, offset + 4).join('.'));
    }
    return NON_PUBLIC_V6.check(address, 'ipv6');
  }
  return NON_PUBLIC_V4.check(address, 'ipv4');
}

/** The sixteen bytes of a valid IPv6 address, including a dotted IPv4 tail. */
function ipv6Bytes(address: string): number[] {
  let text = address;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted !== null) {
    const [a, b, c, d] = dotted[1]!.split('.').map(Number) as [number, number, number, number];
    text = text.slice(0, -dotted[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  return groups.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}
