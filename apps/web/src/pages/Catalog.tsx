import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CATEGORIES, DEVICE_TYPE_KEYS, type CatalogItem, type CatalogItemInput, type ImportDraft, type Specs } from '@fieldplan/shared';
import { api, can, fileUrl } from '../api';
import { useMe } from '../App';

interface ImportStatus { claude: { configured: boolean; enabled: boolean; model: string; usedToday: number; dailyLimit: number }; allowedDomains: string[] }
interface Stored { sha256: string; mime: string; size: number }
type Category = (typeof CATEGORIES)[number];

// Spec fields shown in the editor, grouped. Kind n = number, s = text.
const GROUPS: { title: string; cats: Category[]; fields: [keyof Specs, string, 'n' | 's'][] }[] = [
  { title: 'Camera', cats: ['camera'], fields: [['hfovDeg', 'Horizontal FOV (°)', 'n'], ['vfovDeg', 'Vertical FOV (°)', 'n'], ['megapixels', 'Megapixels', 'n'], ['resolutionPx', 'Horizontal pixels', 'n'], ['irRangeFt', 'IR range (ft)', 'n'], ['lens', 'Lens', 's']] },
  { title: 'Capacity', cats: ['camera', 'electrical', 'access', 'av'], fields: [['channels', 'Channels / circuits / doors', 'n']] },
  { title: 'Network', cats: ['network', 'camera', 'access', 'av'], fields: [['ports', 'Ports', 'n'], ['poePorts', 'PoE ports', 'n'], ['sfpPorts', 'SFP ports', 'n'], ['poeBudgetW', 'PoE budget (W)', 'n'], ['poeStandard', 'PoE standard', 's'], ['wireless', 'Wireless', 's']] },
  { title: 'Power', cats: ['camera', 'network', 'access', 'electrical', 'smart', 'av', 'mech'], fields: [['maxPowerW', 'Max power (W)', 'n'], ['voltageV', 'Voltage (V)', 'n'], ['currentA', 'Current (A)', 'n'], ['va', 'VA', 'n']] },
  { title: 'Physical', cats: [], fields: [['rackUnits', 'Rack units', 'n'], ['ipRating', 'IP rating', 's'], ['ikRating', 'IK rating', 's'], ['tempMinC', 'Min temp (°C)', 'n'], ['tempMaxC', 'Max temp (°C)', 'n'], ['widthMm', 'Width (mm)', 'n'], ['heightMm', 'Height (mm)', 'n'], ['depthMm', 'Depth (mm)', 'n'], ['weightKg', 'Weight (kg)', 'n']] },
];
const NUMERIC = new Set(GROUPS.flatMap(g => g.fields.filter(f => f[2] === 'n').map(f => f[0] as string)));

interface PriceRow { source: string; price: string; currency: string; note: string; updatedAt?: string }
interface Form {
  id?: string; vendor: string; model: string; name: string; category: Category; typeKey: string; sourceUrl: string; notes: string;
  datasheetSha?: string; imageSha?: string; specs: Record<string, string>; extra: [string, string][]; prices: PriceRow[];
}
const toForm = (i: Partial<CatalogItemInput> & { id?: string }): Form => {
  const { extra, ...specs } = i.specs ?? {};
  return {
    id: i.id, vendor: i.vendor ?? '', model: i.model ?? '', name: i.name ?? '', category: i.category ?? 'other', typeKey: i.typeKey ?? '', sourceUrl: i.sourceUrl ?? '', notes: i.notes ?? '',
    datasheetSha: i.datasheetSha, imageSha: i.imageSha,
    specs: Object.fromEntries(Object.entries(specs).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)])),
    extra: Object.entries(extra ?? {}).map(([k, v]) => [k, String(v)]),
    prices: (i.prices ?? []).map(p => ({ source: p.source, price: String(p.price), currency: p.currency ?? 'USD', note: p.note ?? '', updatedAt: p.updatedAt })),
  };
};
function fromForm(f: Form): CatalogItemInput {
  const specs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f.specs)) { const t = v.trim(); if (!t) continue; specs[k] = NUMERIC.has(k) ? Number(t) : t; }
  const extra = Object.fromEntries(f.extra.filter(([k, v]) => k.trim() && v.trim()).map(([k, v]) => [k.trim().slice(0, 60), v.trim()]));
  if (Object.keys(extra).length) specs.extra = extra;
  return {
    vendor: f.vendor.trim(), model: f.model.trim(), name: f.name.trim(), category: f.category, specs: specs as Specs,
    prices: f.prices.filter(p => p.source.trim() || p.price.trim()).map(p => ({ source: p.source.trim(), price: Number(p.price), currency: (p.currency.trim() || 'USD').toUpperCase(), ...(p.note.trim() ? { note: p.note.trim() } : {}), ...(p.updatedAt ? { updatedAt: p.updatedAt } : {}) })),
    ...(f.typeKey.trim() ? { typeKey: f.typeKey.trim() } : {}), ...(f.sourceUrl.trim() ? { sourceUrl: f.sourceUrl.trim() } : {}), ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
    ...(f.datasheetSha ? { datasheetSha: f.datasheetSha } : {}), ...(f.imageSha ? { imageSha: f.imageSha } : {}),
  };
}
const money = (n: number, cur: string) => { try { return n.toLocaleString(undefined, { style: 'currency', currency: cur }); } catch { return cur + ' ' + n.toFixed(2); } };
const priceSummary = (i: CatalogItem) => {
  if (!i.prices.length) return '—';
  const low = i.prices.reduce((a, b) => (b.price < a.price ? b : a));
  return money(low.price, low.currency) + (i.prices.length > 1 ? ' · ' + i.prices.length + ' sources' : '');
};
const specSummary = (s: Specs) => [s.megapixels && s.megapixels + ' MP', s.hfovDeg && s.hfovDeg + '° H', s.ports && s.ports + ' ports', s.poeBudgetW && s.poeBudgetW + ' W PoE', s.maxPowerW && s.maxPowerW + ' W', s.rackUnits && s.rackUnits + 'U', s.ipRating].filter(Boolean).join(' · ');
const upload = (file: File) => { const fd = new FormData(); fd.append('file', file); return api<Stored>('/api/files', { method: 'POST', body: fd }); };

/** How old the newest price is; prices older than 30 days are flagged. */
function priceAge(i: CatalogItem) {
  const at = i.prices.map(p => Date.parse(p.updatedAt ?? '')).filter(Number.isFinite); if (!at.length) return null;
  const days = Math.floor((Date.now() - Math.max(...at)) / 86400000);
  return <div className={days > 30 ? 'warn' : 'muted'} style={{ fontSize: 10.5 }}>{days <= 0 ? 'updated today' : days + 'd old'}</div>;
}

export function Catalog() {
  const me = useMe().data, qc = useQueryClient();
  const [q, setQ] = useState(''), [cat, setCat] = useState<string>('');
  const items = useQuery({ queryKey: ['catalog'], queryFn: () => api<CatalogItem[]>('/api/catalog') });
  const status = useQuery({ queryKey: ['import-status'], queryFn: () => api<ImportStatus>('/api/import/status') });
  const [open, setOpen] = useState<{ form: Form; draft?: ImportDraft } | null>(null);
  const [url, setUrl] = useState(''), [useClaude, setUseClaude] = useState(true), [err, setErr] = useState('');
  const writer = can(me, 'catalog:write'), importer = can(me, 'import:run'), claude = status.data?.claude;

  const [refreshed, setRefreshed] = useState<{ id: string; name: string; changes: string[]; error?: string }[] | null>(null);
  const refreshAll = useMutation({
    mutationFn: () => api<{ results: { id: string; name: string; changes: string[]; error?: string }[] }>('/api/catalog/refresh-all', { method: 'POST' }),
    onSuccess: r => { setRefreshed(r.results); setErr(''); qc.invalidateQueries({ queryKey: ['catalog'] }); }, onError: e => setErr(e.message),
  });
  const imp = useMutation({
    mutationFn: () => api<ImportDraft>('/api/import/page', { method: 'POST', json: { url: url.trim(), useClaude: !!claude?.enabled && useClaude } }),
    onSuccess: d => { setErr(''); setOpen({ form: toForm(d.item), draft: d }); qc.invalidateQueries({ queryKey: ['import-status'] }); },
    onError: e => setErr(e.message),
  });

  const rows = useMemo(() => (items.data ?? []).filter(i => (!cat || i.category === cat) && (!q || [i.vendor, i.model, i.name, i.typeKey].join(' ').toLowerCase().includes(q.toLowerCase()))), [items.data, q, cat]);

  return (
    <div className="page wide">
      <div className="page-head">
        <h1>Catalog</h1>
        <input className="search" placeholder="Search vendor, model, name" value={q} onChange={e => setQ(e.target.value)} />
        <select value={cat} onChange={e => setCat(e.target.value)}><option value="">All categories</option>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
        {importer && writer && <button className="btn" disabled={refreshAll.isPending} title="Re-read every item's source page for current prices" onClick={() => refreshAll.mutate()}>{refreshAll.isPending ? 'Refreshing…' : 'Refresh prices'}</button>}
        {writer && <button className="btn primary" onClick={() => setOpen({ form: toForm({}) })}>New item</button>}
      </div>
      {refreshed && <div className="card"><div className="row"><b className="grow">Price refresh: {refreshed.filter(r => r.changes.length && !r.error).length} updated, {refreshed.filter(r => r.error).length} failed, {refreshed.length} checked</b><button className="btn sm" onClick={() => setRefreshed(null)}>Dismiss</button></div>
        <ul className="issues">{refreshed.filter(r => r.error || r.changes.some(c => !/^No price/.test(c))).map(r => <li key={r.id} className={r.error ? 'error' : 'info'}><span>{r.error ? '●' : '○'}</span><b style={{ minWidth: 160 }}>{r.name}</b><span className="grow">{r.error ?? r.changes.join(' · ')}</span></li>)}</ul></div>}

      {importer && writer && (
        <form className="card row wrap" onSubmit={e => { e.preventDefault(); if (url.trim()) imp.mutate(); }}>
          <input className="grow" type="url" placeholder="Paste a product page or datasheet PDF link" value={url} onChange={e => setUrl(e.target.value)} required />
          {claude?.enabled && <label className="inline small" title={'Model ' + claude.model + ' · ' + claude.usedToday + ' of ' + claude.dailyLimit + ' calls used today'}><input type="checkbox" checked={useClaude} onChange={e => setUseClaude(e.target.checked)} /> Read with Claude</label>}
          <button className="btn primary" disabled={imp.isPending}>{imp.isPending ? 'Reading page…' : 'Import'}</button>
          <div className="muted small full">
            {claude?.enabled ? 'Published product data is read first; Claude fills in the rest. You review everything before it is saved.'
              : claude?.configured ? 'Claude import is turned off in Settings — only published product data (JSON-LD/OpenGraph) is read.'
              : 'Reads published product data (JSON-LD/OpenGraph). Add an Anthropic API key to have Claude read pages and datasheets.'}
            {!!status.data?.allowedDomains.length && ' Allowed sites: ' + status.data.allowedDomains.join(', ') + '.'}
          </div>
        </form>
      )}
      {err && <div className="bad">{err}</div>}

      {items.isLoading ? <p className="muted">Loading…</p> : items.isError ? <div className="bad">{items.error.message}</div> : !rows.length ? (
        <p className="muted">{items.data?.length ? 'Nothing matches.' : 'The catalog is empty. Import a product page or add an item by hand.'}</p>
      ) : (
        <table className="table hover">
          <thead><tr><th /><th>Vendor</th><th>Model</th><th>Name</th><th>Category</th><th>Specs</th><th>Price</th><th>Datasheet</th></tr></thead>
          <tbody>{rows.map(i => (
            <tr key={i.id} onClick={() => setOpen({ form: toForm(i) })}>
              <td className="thumb">{i.imageSha && <img src={fileUrl(i.imageSha)} alt="" loading="lazy" />}</td>
              <td>{i.vendor}</td><td className="mono">{i.model}</td><td>{i.name}</td><td><span className={'dot cat-' + i.category} />{i.category}</td>
              <td className="small muted">{specSummary(i.specs)}</td><td className="mono small">{priceSummary(i)}{priceAge(i)}</td>
              <td>{i.datasheetSha && <a href={fileUrl(i.datasheetSha)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>PDF</a>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}

      {open && <ItemEditor key={open.form.id ?? 'new'} initial={open.form} draft={open.draft} readOnly={!writer} canImport={importer} claudeOn={!!claude?.enabled}
        onClose={() => setOpen(null)} onSaved={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['catalog'] }); }} />}
    </div>
  );
}

function ItemEditor({ initial, draft, readOnly, canImport, claudeOn, onClose, onSaved }: { initial: Form; draft?: ImportDraft; readOnly: boolean; canImport: boolean; claudeOn: boolean; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(initial), [err, setErr] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState('');
  const [fileUrlIn, setFileUrlIn] = useState('');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(prev => ({ ...prev, [k]: v }));
  const spec = (k: string, v: string) => setF(prev => ({ ...prev, specs: { ...prev.specs, [k]: v } }));

  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); setErr(''); setNote(''); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); } };
  const attach = (s: Stored) => {
    if (s.mime === 'application/pdf') { set('datasheetSha', s.sha256); setNote('Datasheet attached.'); }
    else { set('imageSha', s.sha256); setNote('Photo attached.'); }
  };
  const saveFromUrl = (u: string) => run('Downloading…', async () => attach(await api<Stored>('/api/import/file', { method: 'POST', json: { url: u } })));
  const readDatasheet = () => run('Claude is reading the datasheet…', async () => {
    const d = await api<ImportDraft>('/api/import/datasheet', { method: 'POST', json: { sha256: f.datasheetSha } });
    qc.invalidateQueries({ queryKey: ['import-status'] });
    const got = toForm(d.item); let filled = 0, kept = 0;
    setF(prev => {
      const next = { ...prev, specs: { ...prev.specs } };
      for (const k of ['vendor', 'model', 'name', 'typeKey'] as const) if (!next[k] && got[k]) next[k] = got[k];
      if (next.category === 'other' && got.category !== 'other') next.category = got.category;
      for (const [k, v] of Object.entries(got.specs)) { if (!next.specs[k]?.trim()) { next.specs[k] = v; filled++; } else if (next.specs[k] !== v) kept++; }
      const have = new Set(next.extra.map(([k]) => k));
      next.extra = [...next.extra, ...got.extra.filter(([k]) => !have.has(k))];
      return next;
    });
    setNote('Filled ' + filled + ' empty field(s)' + (kept ? '; ' + kept + ' differed from what you had — kept yours' : '') + '.' + (d.warnings.length ? ' ' + d.warnings.join(' ') : ''));
  });
  const save = () => run('Saving…', async () => {
    const body = fromForm(f);
    if (body.prices.some(p => !p.source || !Number.isFinite(p.price))) throw new Error('Each price needs a source and a number');
    for (const [k, v] of Object.entries(body.specs)) if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(k + ' must be a number');
    await api(f.id ? '/api/catalog/' + f.id : '/api/catalog', { method: f.id ? 'PUT' : 'POST', json: body });
    onSaved();
  });
  const remove = () => { if (confirm('Delete ' + f.vendor + ' ' + f.model + ' from the catalog?')) void run('Deleting…', async () => { await api('/api/catalog/' + f.id, { method: 'DELETE' }); onSaved(); }); };
  const refreshItem = () => run('Reading source page…', async () => { const r = await api<{ changes: string[] }>('/api/catalog/' + f.id + '/refresh', { method: 'POST' }); alert(r.changes.join('\n') || 'Nothing changed.'); onSaved(); });
  const today = () => new Date().toISOString().slice(0, 10);
  const setPrice = (i: number, patch: Partial<PriceRow>) => set('prices', f.prices.map((p, j) => (j === i ? { ...p, ...patch, updatedAt: today() } : p)));

  return (
    <div className="drawer-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer" role="dialog" aria-label="Catalog item">
        <div className="drawer-head">
          <h2>{f.id ? f.vendor + ' ' + f.model : draft ? 'Review import' : 'New catalog item'}</h2>
          <span className="spacer" /><button className="btn sm" onClick={onClose}>Close</button>
        </div>
        {draft && (
          <div className="card small">
            <div>From <a href={draft.sourceUrl} target="_blank" rel="noopener noreferrer">{draft.sourceUrl}</a></div>
            <div className="muted">Read via {draft.via.length ? draft.via.join(' + ') : 'nothing structured'} — check every field before saving.</div>
            {draft.warnings.map((w, i) => <div key={i} className="warn">{w}</div>)}
          </div>
        )}
        <fieldset disabled={readOnly || !!busy} className="form">
          <div className="grid2">
            <label>Vendor<input value={f.vendor} onChange={e => set('vendor', e.target.value)} maxLength={80} required /></label>
            <label>Model<input value={f.model} onChange={e => set('model', e.target.value)} maxLength={120} required /></label>
            <label className="span2">Name<input value={f.name} onChange={e => set('name', e.target.value)} maxLength={200} /></label>
            <label>Category<select value={f.category} onChange={e => set('category', e.target.value as Category)}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
            <label>Plan type<input list="typekeys" value={f.typeKey} onChange={e => set('typeKey', e.target.value)} maxLength={60} placeholder="e.g. cam-dome" /></label>
            <label className="span2">Product page<input type="url" value={f.sourceUrl} onChange={e => set('sourceUrl', e.target.value)} maxLength={2000} /></label>
          </div>
          <datalist id="typekeys">{DEVICE_TYPE_KEYS.map(k => <option key={k} value={k} />)}</datalist>

          <h3>Prices</h3>
          <p className="muted small">Add one row per source — distributor, retailer, quote. Prices are never pulled automatically.</p>
          {f.prices.map((p, i) => (
            <div key={i} className="price-row">
              <input placeholder="Source" value={p.source} onChange={e => setPrice(i, { source: e.target.value })} maxLength={120} />
              <input placeholder="0.00" inputMode="decimal" value={p.price} onChange={e => setPrice(i, { price: e.target.value })} />
              <input placeholder="USD" value={p.currency} onChange={e => setPrice(i, { currency: e.target.value })} maxLength={3} className="cur" />
              <input placeholder="Note (qty break, quote #)" value={p.note} onChange={e => setPrice(i, { note: e.target.value })} maxLength={300} />
              <span className="muted small mono">{p.updatedAt?.slice(0, 10) ?? ''}</span>
              <button type="button" className="btn sm" onClick={() => set('prices', f.prices.filter((_, j) => j !== i))} aria-label="Remove price">✕</button>
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => set('prices', [...f.prices, { source: '', price: '', currency: f.prices[0]?.currency ?? 'USD', note: '', updatedAt: today() }])}>+ Price</button>

          <h3>Specifications</h3>
          {GROUPS.map(g => {
            const relevant = !g.cats.length || g.cats.includes(f.category) || g.fields.some(([k]) => f.specs[k]);
            return (
              <details key={g.title} open={relevant}>
                <summary>{g.title}</summary>
                <div className="grid3">{g.fields.map(([k, label, kind]) => (
                  <label key={g.title + k}>{label}<input value={f.specs[k] ?? ''} onChange={e => spec(k, e.target.value)} inputMode={kind === 'n' ? 'decimal' : 'text'} maxLength={80} /></label>
                ))}</div>
              </details>
            );
          })}
          <details open={f.extra.length > 0}>
            <summary>Other specs ({f.extra.length})</summary>
            {f.extra.map(([k, v], i) => (
              <div key={i} className="row">
                <input placeholder="Name" value={k} onChange={e => set('extra', f.extra.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} maxLength={60} />
                <input className="grow" placeholder="Value" value={v} onChange={e => set('extra', f.extra.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} maxLength={300} />
                <button type="button" className="btn sm" onClick={() => set('extra', f.extra.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
              </div>
            ))}
            <button type="button" className="btn sm" onClick={() => set('extra', [...f.extra, ['', '']])}>+ Spec</button>
          </details>

          <h3>Datasheet &amp; photo</h3>
          <div className="media">
            <div className="media-box">
              {f.datasheetSha ? (<>
                <a href={fileUrl(f.datasheetSha)} target="_blank" rel="noopener noreferrer">Open datasheet (PDF)</a>
                <div className="row wrap">
                  {canImport && claudeOn && <button type="button" className="btn sm" onClick={readDatasheet}>Read specs with Claude</button>}
                  <button type="button" className="btn sm" onClick={() => set('datasheetSha', undefined)}>Remove</button>
                </div>
              </>) : <span className="muted small">No datasheet</span>}
            </div>
            <div className="media-box">
              {f.imageSha ? (<><img src={fileUrl(f.imageSha)} alt="" /><button type="button" className="btn sm" onClick={() => set('imageSha', undefined)}>Remove</button></>) : <span className="muted small">No photo</span>}
            </div>
          </div>
          {canImport && (<>
            {!!draft?.datasheets.length && <div className="cands"><span className="small muted">Datasheets found:</span>{draft.datasheets.slice(0, 6).map(u => <button type="button" key={u} className="chip" title={u} onClick={() => saveFromUrl(u)}>{decodeURIComponent(u.split('/').pop() || u).slice(0, 48)}</button>)}</div>}
            {!!draft?.images.length && <div className="cands"><span className="small muted">Photos found:</span>{draft.images.slice(0, 6).map(u => <button type="button" key={u} className="chip" title={u} onClick={() => saveFromUrl(u)}>{decodeURIComponent(u.split('/').pop()?.split('?')[0] || u).slice(0, 40)}</button>)}</div>}
            <div className="row wrap">
              <input className="grow" type="url" placeholder="Datasheet PDF or photo link" value={fileUrlIn} onChange={e => setFileUrlIn(e.target.value)} />
              <button type="button" className="btn sm" disabled={!fileUrlIn.trim()} onClick={() => { void saveFromUrl(fileUrlIn.trim()); setFileUrlIn(''); }}>Download</button>
              <label className="btn sm">Upload file…<input type="file" accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run('Uploading…', async () => attach(await upload(file))); }} /></label>
            </div>
          </>)}

          <h3>Notes</h3>
          <textarea rows={3} value={f.notes} onChange={e => set('notes', e.target.value)} maxLength={5000} />
        </fieldset>

        {busy && <div className="muted">{busy}</div>}
        {note && <div className="ok">{note}</div>}
        {err && <div className="bad">{err}</div>}
        {!readOnly && (
          <div className="drawer-foot">
            {f.id && f.sourceUrl && canImport && <button className="btn" onClick={refreshItem} disabled={!!busy} title="Re-read the source page for current price and missing specs">Refresh from source</button>}
            {f.id && <button className="btn danger" onClick={remove} disabled={!!busy}>Delete</button>}
            <span className="spacer" />
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={!!busy || !f.vendor.trim() || !f.model.trim()}>{f.id ? 'Save changes' : 'Add to catalog'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
