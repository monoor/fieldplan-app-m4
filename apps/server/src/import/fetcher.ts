// Fetches web pages and files for import without letting a URL reach the server's own network (SSRF):
// only http/https on default ports, every DNS answer must be a public unicast address (checked at connect time, so DNS
// rebinding can't slip through), redirects are followed by hand and re-checked, and size/time are capped.
import { Agent, fetch } from 'undici';
import dns from 'node:dns';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import { HttpError } from '../http.js';

export function isPublicIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let a = ipaddr.parse(ip);
  if (a.kind() === 'ipv6' && (a as ipaddr.IPv6).isIPv4MappedAddress()) a = (a as ipaddr.IPv6).toIPv4Address();
  return a.range() === 'unicast';
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;
function safeLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb) {
  dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addrs) => {
    if (err) return cb(err, '');
    const bad = addrs.find(a => !isPublicIp(a.address));
    if (bad || !addrs.length) { const e: NodeJS.ErrnoException = new Error(hostname + ' resolves to a private or reserved address'); e.code = 'EBLOCKED'; return cb(e, ''); }
    if (options.all) return cb(null, addrs);
    cb(null, addrs[0]!.address, addrs[0]!.family);
  });
}
const agent = new Agent({ connect: { lookup: safeLookup as unknown as net.LookupFunction, timeout: 10_000 }, headersTimeout: 20_000, bodyTimeout: 30_000 });

export interface Fetched { url: string; contentType: string; body: Buffer }
export interface FetchOpts { maxBytes: number; accept: string; allowedDomains: string[]; timeoutMs?: number }

export function checkUrl(raw: string, allowedDomains: string[]): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'Not a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'Only http and https links can be imported');
  if (u.username || u.password) throw new HttpError(400, 'Links with credentials are not allowed');
  if (u.port && u.port !== '80' && u.port !== '443') throw new HttpError(400, 'Only standard ports (80/443) are allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(host) && !isPublicIp(host)) throw new HttpError(400, 'That address is on a private or reserved network');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) throw new HttpError(400, 'Local hostnames are not allowed');
  if (allowedDomains.length && !allowedDomains.some(d => host === d || host.endsWith('.' + d))) throw new HttpError(400, host + ' is not in the allowed import domains');
  return u;
}

export async function fetchSafe(raw: string, o: FetchOpts): Promise<Fetched> {
  let url = checkUrl(raw, o.allowedDomains);
  const deadline = AbortSignal.timeout(o.timeoutMs ?? 30_000);
  for (let hop = 0; hop <= 5; hop++) {
    let res;
    try {
      res = await fetch(url, { dispatcher: agent, redirect: 'manual', signal: deadline,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; FieldplanImport/1.0; self-hosted)', accept: o.accept, 'accept-language': 'en-US,en;q=0.8' } });
    } catch (e) {
      const err = e as { cause?: { code?: string; message?: string }; name?: string };
      if (err.cause?.code === 'EBLOCKED') throw new HttpError(400, err.cause.message ?? 'Blocked address');
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new HttpError(504, 'The site took too long to answer');
      throw new HttpError(502, 'Could not reach ' + url.hostname + (err.cause?.code ? ' (' + err.cause.code + ')' : ''));
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location'); await res.body?.cancel();
      if (!loc) throw new HttpError(502, 'Redirect without a location');
      url = checkUrl(new URL(loc, url).toString(), o.allowedDomains); continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw new HttpError(502, url.hostname + ' answered ' + res.status); }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > o.maxBytes) { await res.body?.cancel(); throw new HttpError(413, 'File is larger than ' + Math.round(o.maxBytes / 1048576) + ' MB'); }
    const chunks: Buffer[] = []; let total = 0;
    if (res.body) for await (const c of res.body) {
      total += c.length;
      if (total > o.maxBytes) throw new HttpError(413, 'File is larger than ' + Math.round(o.maxBytes / 1048576) + ' MB');
      chunks.push(Buffer.from(c));
    }
    return { url: url.toString(), contentType: res.headers.get('content-type') ?? '', body: Buffer.concat(chunks) };
  }
  throw new HttpError(502, 'Too many redirects');
}
