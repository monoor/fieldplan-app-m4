import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { newId, type ProjectRecord, type ProjectSummary } from '@fieldplan/shared';
import { api, can } from '../api';
import { useMe } from '../App';
import { EditorStore, useStoreVersion } from '../editor/store';
import { EditorCanvas, type Placement } from '../editor/EditorCanvas';
import { Palette } from '../editor/Palette';
import { Inspector, uploadUnderlay } from '../editor/Inspector';
import { useConeOptions } from '../editor/ConeControls';
import type { Tool } from '../editor/tools';

interface Snapshot { project: ProjectSummary; seq: number; records: ProjectRecord[] }

export function Editor() {
  const { id = '' } = useParams(), me = useMe().data;
  const snap = useQuery({ queryKey: ['editor-snapshot', id], queryFn: () => api<Snapshot>('/api/projects/' + encodeURIComponent(id) + '/snapshot'), staleTime: Infinity, gcTime: 0 });
  if (snap.isLoading) return <div className="page muted">Loading…</div>;
  if (snap.isError) return <div className="page"><div className="bad">{snap.error.message}</div></div>;
  if (!can(me, 'project:write')) return <div className="page"><div className="bad">Your role can't edit plans.</div><Link to={'/p/' + id}>Back to the project</Link></div>;
  return <EditorShell key={id} id={id} snapshot={snap.data!} />;
}

function EditorShell({ id, snapshot }: { id: string; snapshot: Snapshot }) {
  const nav = useNavigate(), qc = useQueryClient();
  const store = useMemo(() => new EditorStore(id, snapshot), [id, snapshot]);
  const version = useStoreVersion(store);
  const [sheetId, setSheet] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [placement, setPlacement] = useState<Placement>({ typeId: 'cam-dome' });
  const [cableType, setCableType] = useState('cat6'), [matId, setMatId] = useState('floor');
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const [cones, setCones] = useConeOptions();
  const [snapOn, setSnapOn] = useState(true), [msg, setMsg] = useState('');
  const fileIn = useRef<HTMLInputElement>(null);

  const sheets = store.sheets(), meta = store.meta()?.data ?? {};
  const current = sheets.find(s => s.id === sheetId) ?? sheets[0];
  const scale = Number(meta.scale) || 20, gridFt = Number(meta.gridFt) || 1;

  // Make sure there is always a sheet to draw on.
  useEffect(() => { if (!store.sheets().length) store.edit(tx => tx.put({ id: newId(), kind: 'sheet', sheetId: null, data: { name: 'Floor 1', order: 0 } })); }, [store]);
  // Pick up edits from other devices, save on the way out, warn if something is unsaved.
  useEffect(() => {
    const t = setInterval(() => void store.refresh(), 15000);
    const warn = (e: BeforeUnloadEvent) => { if (store.unsaved) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { clearInterval(t); window.removeEventListener('beforeunload', warn); void store.flush().finally(() => { store.dispose(); void qc.invalidateQueries({ queryKey: ['project', id] }); void qc.invalidateQueries({ queryKey: ['projects'] }); }); };
  }, [store, qc, id]);
  useEffect(() => { setSel(prev => new Set([...prev].filter(i => store.get(i)))); }, [version, store]);

  const addSheet = () => { const sid = newId(); store.edit(tx => tx.put({ id: sid, kind: 'sheet', sheetId: null, data: { name: 'Floor ' + (sheets.length + 1), order: sheets.length } })); setSheet(sid); };
  const renameSheet = () => { if (!current) return; const n = prompt('Sheet name', current.data.name)?.trim(); if (n) store.edit(tx => tx.patch(current.id, { name: n.slice(0, 120) })); };
  const deleteSheet = () => { if (!current || sheets.length < 2) return; if (confirm('Delete “' + current.data.name + '” and everything on it?')) { store.edit(tx => tx.del(current.id)); setSheet(null); setSel(new Set()); } };
  const addUnderlay = async (f: File) => {
    if (!current) return; setMsg('');
    try {
      const up = await uploadUnderlay(f);
      if (!up.mime.startsWith('image/')) throw new Error('Underlays must be images (PNG/JPEG/WebP). Export the PDF page as an image first.');
      const img = new Image(); img.src = '/api/files/' + up.sha256; await img.decode();
      const w = scale * 60, h = (w * img.naturalHeight) / img.naturalWidth, uid = newId();
      store.edit(tx => tx.put({ id: uid, kind: 'underlay', sheetId: current.id, data: { fileSha: up.sha256, x: 0, y: 0, w, h, opacity: 0.5, name: f.name.slice(0, 100) } }));
      setSel(new Set([uid])); setTool('select'); setMsg('Underlay added at 60 ft wide — set its real width in the panel on the right.');
    } catch (e) { setMsg((e as Error).message); }
  };
  const ul = current ? store.ofSheet(current.id).find(r => r.kind === 'underlay') : undefined;
  const state = store.saveState, name = String(meta.name ?? 'Project');
  const leave = async () => { await store.flush(); nav('/p/' + id); };

  return (
    <div className="editor">
      <div className="editor-bar">
        <button className="btn sm" onClick={() => void leave()}>← Done</button>
        <strong className="ename">{name}</strong>
        <select value={current?.id ?? ''} onChange={e => { setSheet(e.target.value); setSel(new Set()); }} aria-label="Sheet">{sheets.map(s => <option key={s.id} value={s.id}>{s.data.name}</option>)}</select>
        <button className="btn sm" onClick={addSheet} title="Add a sheet (floor)">+ Sheet</button>
        <button className="btn sm" onClick={renameSheet}>Rename</button>
        {sheets.length > 1 && <button className="btn sm" onClick={deleteSheet}>Delete sheet</button>}
        <span className="sep" />
        <button className="btn sm" disabled={!store.canUndo} onClick={() => store.undo()} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button className="btn sm" disabled={!store.canRedo} onClick={() => store.redo()} title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
        <label className="inline small"><input type="checkbox" checked={snapOn} onChange={e => setSnapOn(e.target.checked)} /> Snap {gridFt}′</label>
        <button className="btn sm" onClick={() => (ul ? setSel(new Set([ul.id])) : fileIn.current?.click())}>{ul ? 'Underlay' : '+ Underlay'}</button>
        <input ref={fileIn} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addUnderlay(f); }} />
        <span className="spacer" />
        {store.conflicts > 0 && <span className="warn-chip" title="Another device changed the same items; your version was kept">{store.conflicts} overwritten</span>}
        <span className={'save ' + state} title={store.lastError}>{state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : state === 'dirty' ? 'Unsaved…' : 'Not saved — ' + (store.lastError || 'offline') + ' (retrying)'}</span>
      </div>
      {msg && <div className="ok small" onClick={() => setMsg('')}>{msg}</div>}
      <div className="editor-body">
        <Palette tool={tool} setTool={t => { setTool(t); if (t !== 'select') setSel(new Set()); }} placement={placement} setPlacement={setPlacement} cableType={cableType} setCableType={setCableType} matId={matId} setMatId={setMatId} />
        {current ? <EditorCanvas store={store} sheetId={current.id} scale={scale} gridFt={gridFt} tool={tool} setTool={setTool} placement={placement} cableType={cableType} matId={matId} sel={sel} setSel={setSel} cones={cones} setCones={setCones} snapOn={snapOn} /> : <div className="plan" />}
        <Inspector store={store} sel={sel} scale={scale} onSelect={ids => setSel(new Set(ids))} />
      </div>
    </div>
  );
}
