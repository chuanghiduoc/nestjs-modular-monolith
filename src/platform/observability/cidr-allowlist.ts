import type { IPv4 } from 'ipaddr.js';
import { IPv6, isValid, parse, parseCIDR } from 'ipaddr.js';

type IpAddress = IPv4 | IPv6;

export type CidrAllowList = readonly (readonly [IpAddress, number])[];

export function parseCidrAllowList(cidrs: readonly string[]): CidrAllowList {
  return cidrs.map((entry) => {
    const cidr = entry.trim();
    try {
      return parseCIDR(cidr);
    } catch (error) {
      throw new Error(`Metrics allow-list entry is not a valid CIDR: "${entry}"`, { cause: error });
    }
  });
}

export function isAddressAllowed(
  remoteAddress: string | undefined,
  allowList: CidrAllowList,
): boolean {
  if (allowList.length === 0) {
    return false;
  }

  const address = parseRemoteAddress(remoteAddress);
  if (address === undefined) {
    return false;
  }

  return allowList.some(([network, prefixLength]) => matches(address, network, prefixLength));
}

function parseRemoteAddress(value: string | undefined): IpAddress | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }

  const [address = ''] = value.split('%');
  if (!isValid(address)) {
    return undefined;
  }

  const parsed = parse(address);

  if (parsed instanceof IPv6 && parsed.isIPv4MappedAddress()) {
    return parsed.toIPv4Address();
  }

  return parsed;
}

function matches(address: IpAddress, network: IpAddress, prefixLength: number): boolean {
  if (address.kind() !== network.kind()) {
    return false;
  }

  return address.match(network, prefixLength);
}
