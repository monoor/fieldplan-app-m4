// Customizable inputs/outputs for devices. Any device can carry port groups (e.g. "LAN" ×24 RJ45 PoE, "Uplink" ×2 SFP+,
// "12 V in" ×1). Generic devices and switches start from a sensible default and the user edits them freely.
import { z } from 'zod';

export const PORT_KINDS = ['rj45', 'sfp', 'power-in', 'power-out', 'dc-in', 'dc-out', 'usb', 'hdmi', 'serial', 'relay', 'input', 'audio', 'coax', 'fiber', 'other'] as const;
export type PortKind = (typeof PORT_KINDS)[number];
export const PORT_KIND_LABELS: Record<PortKind, string> = {
  rj45: 'RJ45 / Ethernet', sfp: 'SFP / SFP+', 'power-in': 'AC power in', 'power-out': 'AC power out', 'dc-in': 'DC power in', 'dc-out': 'DC power out',
  usb: 'USB', hdmi: 'HDMI', serial: 'Serial / RS-485', relay: 'Relay output', input: 'Dry-contact input', audio: 'Audio', coax: 'Coax', fiber: 'Fiber', other: 'Other',
};

export const PortGroup = z.object({
  id: z.string().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().max(60),
  kind: z.enum(PORT_KINDS),
  count: z.number().int().min(0).max(512),
  /** Ethernet only: ports supply PoE. */
  poe: z.boolean().optional(),
  /** Max watts per PoE port (e.g. 30 for 802.3at), or the rating of a power/DC port. */
  watts: z.number().min(0).max(100000).optional(),
  /** Voltage for DC ports; free text speed ("1G", "10G") for data ports. */
  volts: z.number().min(0).max(1000).optional(),
  speed: z.string().max(20).optional(),
});
export type PortGroup = z.infer<typeof PortGroup>;

let n = 0;
const gid = () => 'g' + (++n).toString(36) + Math.random().toString(36).slice(2, 5);
const grp = (name: string, kind: PortKind, count: number, extra: Partial<PortGroup> = {}): PortGroup => ({ id: gid(), name, kind, count, ...extra });

/** Starting port layout for a device type; `undefined` means the type has no ports by default. */
export function defaultPorts(typeId: string): PortGroup[] | undefined {
  switch (typeId) {
    case 'nswitch': return [grp('LAN', 'rj45', 24, { speed: '1G' }), grp('Uplink', 'sfp', 2, { speed: '10G' })];
    case 'poe-sw': return [grp('PoE LAN', 'rj45', 24, { poe: true, watts: 30, speed: '1G' }), grp('Uplink', 'sfp', 2, { speed: '10G' })];
    case 'generic-sw': return [grp('LAN', 'rj45', 8, { speed: '1G' })];
    case 'generic': return [grp('Input', 'input', 1)];
    case 'nvr': return [grp('LAN', 'rj45', 1, { speed: '1G' }), grp('Camera PoE', 'rj45', 8, { poe: true, watts: 15 }), grp('HDMI out', 'hdmi', 1), grp('Power', 'power-in', 1)];
    case 'router': case 'firewall': return [grp('WAN', 'rj45', 1, { speed: '1G' }), grp('LAN', 'rj45', 4, { speed: '1G' })];
    case 'patch': return [grp('Ports', 'rj45', 24)];
    case 'psu': case 'xfmr': return [grp('AC in', 'power-in', 1), grp('DC out', 'dc-out', 1, { volts: 24, watts: 100 })];
    case 'ctrl': return [grp('Readers', 'serial', 2), grp('Inputs', 'input', 4), grp('Relays', 'relay', 2), grp('LAN', 'rj45', 1)];
    default: return undefined;
  }
}

/** Total PoE budget implied by the PoE port groups, in watts (an explicit device budget overrides this in the UI). */
export const poePortWatts = (ports: readonly PortGroup[] | undefined): number => (ports ?? []).filter(p => p.poe).reduce((s, p) => s + p.count * (p.watts ?? 15), 0);
export const portCount = (ports: readonly PortGroup[] | undefined, kind?: PortKind): number => (ports ?? []).filter(p => !kind || p.kind === kind).reduce((s, p) => s + p.count, 0);
/** "24× RJ45 PoE · 2× SFP" */
export function portSummary(ports: readonly PortGroup[] | undefined): string {
  return (ports ?? []).filter(p => p.count > 0).map(p => p.count + '× ' + p.name + (p.poe ? ' (PoE)' : '')).join(' · ');
}
/** Reference to one port on a device, used by cables: "<groupId>:<1-based index>". */
export const portRef = (groupId: string, index: number) => groupId + ':' + index;
