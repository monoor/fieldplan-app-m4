import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { newId, type ProjectRecord, type ProjectSummary } from '@fieldplan/shared';
import { api, can, ApiError, fileUrl } from '../api';
import { loadLocal, mergeLocal, type LocalRec } from '../editor/offline';
import { useMe } from '../App';
import { EditorStore, useStoreVersion } from '../editor/store';
import { EditorCanvas, type Placement } from '../editor/EditorCanvas';
import { Palette, type Picks } from '../editor/Palette';
import { ChecksView, useChecks } from '../components/ChecksView';
import { PanelDialog } from '../editor/PanelDialog';
import { ExportMenu } from '../editor/ExportMenu';
import { CanvasDialog } from '../editor/CanvasDialog';
import { canvasOf } from '../editor/canvas';
import { Inspector, uploadUnderlay } from '../editor/Inspector';
import { useConeOptions } from '../editor/ConeControls';
import { modeOf, type Mode, type Tool } from '../editor/tools';
import type { SceneRec } from '../editor/Scene';

interface Snapshot { project: ProjectSummary; seq: number; records: ProjectRecord[] }
interface EditorSnapshot { project: ProjectSummary; seq: number; records: LocalRec[]; dirty: string[]; offline: boolean }

/** Server copy plus this device's unsent edits; if the server can't be reached, the copy kept on this device. */
async function loadSnapshot(id: string): Promise<EditorSnapshot> {
  const local = await loadLocal(id);
  try {
    const net = await api<Snapshot>('/api/projects/' + encodeURIComponent(id) + '/snapshot'), m = mergeLocal(net.records, local);
    return { project: net.project, seq: net.seq, records: m.records, dirty: m.dirty, offline: false };
  } catch (e) {
    if (e instanceof ApiError || !local?.project) throw e;
    return { project: local.project as ProjectSummary, seq: local.seq, records: local.records, dirty: local.dirty, offline: true };
  }
}

export function Editor() {
  const { id = '' } = useParams(), me = useMe().data;
  const snap = useQuery({ queryKey: ['editor-snapshot', id], queryFn: () => loadSnapshot(id), staleTime: Infinity, gcTime: 0 });
  if (snap.isLoading) return <div className="page muted">Loading…</div>;
  if (snap.isError) return <div className="page"><div className="bad">{snap.error.message}</div></div>;
  if (!can(me, 'project:write')) return <div className="page"><div className="bad">Your role can't edit plans.</div><Link to={'/p/' + id}>Back to the project</Link></div>;
  return <EditorShell key={id} id={id} snapshot={snap.data!} />;
}

function EditorShell({ id, snapshot }: { id: string; snapshot: EditorSnapshot }) {
  const nav = useNavigate(), qc = useQueryClient();
  const store = useMemo(() => { const st = new EditorStore(id, snapshot, snapshot.dirty); st.project = snapshot.project; return st; }, [id, snapshot]);
  const [, netTick] = useState(0);
  useEffect(() => { const f = () => netTick(n => n + 1); window.addEventListener('online', f); window.addEventListener('offline', f); return () => { window.removeEventListener('online', f); window.removeEventListener('offline', f); }; }, []);
  const version = useStoreVersion(store);
  const [sheetId, setSheet] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [placement, setPlacement] = useState<Placement>({ typeId: 'cam-dome' });
  const [mode, setModeState] = useState<Mode>('build');
  const [picks, setPicks] = useState<Picks>({ wall: 'stud', door: 'single', window: 'fixed', surface: 'tile', cable: 'cat6' });
  const setPick = (k: keyof Picks, v: string) => setPicks(p => ({ ...p, [k]: v }));
  const setMode = (m: Mode) => { setModeState(m); setTool(m === 'build' ? 'wall' : 'device'); setSel(new Set()); };
  const changeTool = (t: Tool) => { const m = modeOf(t); if (m) setModeState(m); setTool(t); if (t !== 'select') setSel(new Set()); };
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set());
  const [cones, setCones] = useConeOptions();
  const [panelId, setPanelId] = useState<string | null>(null), [checksOpen, setChecksOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false), [snapOn, setSnapOn] = useState(true), [msg, setMsg] = useState('');
  const fileIn = useRef<HTMLInputElement>(null);

  const sheets = store.sheets(), meta = store.meta()?.data ?? {};
  const current = sheets.find(s => s.id === sheetId) ?? sheets[0];
  const scale = Number(meta.scale) || 20, gridFt = Number(meta.gridFt) || 1, canvas = canvasOf(meta);

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

  // Keep underlay images on the device so the plan still draws with no signal.
  useEffect(() => { for (const r of store.all()) if (r.kind === 'underlay' && r.data.fileSha) void fetch(fileUrl(r.data.fileSha)).catch(() => undefined); }, [store, version]);
  const wasOffline = useRef(snapshot.offline);
  useEffect(() => {
    if (store.saveState === 'saved' && store.restored > 0) { setMsg('Sent ' + store.restored + ' edit' + (store.restored === 1 ? '' : 's') + ' made offline.'); store.restored = 0; }
    else if (store.saveState === 'saved' && wasOffline.current && !store.offline) { wasOffline.current = false; void store.refresh(); }
  }, [store.saveState, version, store]);
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
  const allRecs = useMemo(() => store.all() as never[], [store, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = useChecks(allRecs, scale).issues.filter(i => i.severity !== 'info').length;
  const pick = (rid: string) => { const r = store.get(rid); if (r?.sheetId) setSheet(r.sheetId); setSel(new Set([rid])); setChecksOpen(false); };
  const ul = current ? store.ofSheet(current.id).find(r => r.kind === 'underlay') : undefined;
  const state = store.saveState, name = String(meta.name ?? 'Project');
  const leave = async () => { await store.flush(); nav('/p/' + id); };

  return (
    <div className="editor">
      <div className="editor-bar">
        <button className="btn sm" onClick={() => void leave()}>← Done</button>
        <strong className="ename">{name}</strong>
        <select value={current?.id ?? ''} onChange={e => { setSheet(e.target.value); setSel(new Set()); }} aria-label="Sheet">{sheets.map(s => <option key={s.id} value={s.id}>{s.data.name}</option>)}</select>
        <details className="menu"><summary className="btn sm">Sheet ▾</summary><div className="popover left">
          <button className="btn sm" onClick={addSheet}>Add sheet</button><button className="btn sm" onClick={renameSheet}>Rename</button>
          {sheets.length > 1 && <button className="btn sm danger" onClick={deleteSheet}>Delete sheet</button>}
          <button className="btn sm" onClick={() => (ul ? setSel(new Set([ul.id])) : fileIn.current?.click())}>{ul ? 'Edit underlay' : 'Add underlay image'}</button>
          <button className="btn sm" onClick={() => setCanvasOpen(true)}>Canvas &amp; scale…</button>
          <label className="inline small"><input type="checkbox" checked={snapOn} onChange={e => setSnapOn(e.target.checked)} /> Snap to {gridFt}′ grid</label>
        </div></details>
        <input ref={fileIn} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addUnderlay(f); }} />
        <button className="btn sm" onClick={() => setCanvasOpen(true)} title="Canvas size and drawing scale">{canvas ? canvas.w + '′×' + canvas.h + '′' : 'Canvas'} · {scale} px/ft</button>
        <button className="btn sm" disabled={!store.canUndo} onClick={() => store.undo()} title="Undo (Ctrl+Z)">↶</button>
        <button className="btn sm" disabled={!store.canRedo} onClick={() => store.redo()} title="Redo (Ctrl+Shift+Z)">↷</button>
        <ExportMenu allSheets={() => sheets.map(sh => ({ name: String(sh.data.name), recs: store.ofSheet(sh.id) as SceneRec[] }))} recs={() => (current ? (store.ofSheet(current.id) as SceneRec[]) : [])} cones={cones} projectName={name} client={snapshot.project.client} sheetName={String(current?.data.name ?? 'Sheet')} scale={scale} canvas={canvas} />
        <button className={'btn sm' + (issues ? ' warn-btn' : '')} onClick={() => setChecksOpen(true)}>Checks{issues ? ' (' + issues + ')' : ''}</button>
        <span className="spacer" />
        {store.conflicts > 0 && <span className="warn-chip" title="Another device changed the same items; your version was kept">{store.conflicts} overwritten</span>}
        <span className={'save ' + (store.offline && state !== 'saved' ? 'error' : state)} title={store.lastError}>{store.offline ? (store.pending ? 'Offline — ' + store.pending + ' change' + (store.pending === 1 ? '' : 's') + ' saved on this device' : 'Offline') : state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : state === 'dirty' ? 'Unsaved…' : 'Not synced — ' + (store.lastError || 'offline') + ' (kept on this device, retrying)'}</span>
      </div>
      {canvasOpen && <CanvasDialog initial={{ canvas, scale, gridFt }} dims={current ? store.ofSheet(current.id).filter(r => r.kind === 'dim' && Array.isArray(r.data.points) && r.data.points.length >= 2) : []}
        onClose={() => setCanvasOpen(false)} onApply={v => store.edit(tx => tx.patch('meta', { ...v }))} />}
      {msg && <div className="ok small" onClick={() => setMsg('')}>{msg}</div>}
      {checksOpen && <div className="modal-back" onPointerDown={e => { if (e.target === e.currentTarget) setChecksOpen(false); }}><div className="modal wide"><div className="row"><h2 className="grow">Checks</h2><button className="btn" onClick={() => setChecksOpen(false)}>Done</button></div><ChecksView records={allRecs} scale={scale} projectName={name} onPick={pick} /></div></div>}
      {panelId && store.get(panelId) && <PanelDialog dev={store.get(panelId)!} devs={store.all().filter(r => r.kind === 'device')} onClose={() => setPanelId(null)} onChange={pn => store.edit(tx => tx.patch(panelId, { panel: pn }), 'panel:' + panelId)} />}
      <div className="editor-body">
        <Palette mode={mode} setMode={setMode} tool={tool} setTool={changeTool} placement={placement} setPlacement={setPlacement} picks={picks} setPick={setPick} />
        <div className="canvas-wrap">
          {current ? <EditorCanvas store={store} sheetId={current.id} scale={scale} gridFt={gridFt} canvas={canvas} tool={tool} setTool={changeTool} placement={placement} cableType={picks.cable} matId={picks.surface} wallMatId={picks.wall} doorType={picks.door} windowType={picks.window} sel={sel} setSel={setSel} cones={cones} setCones={setCones} snapOn={snapOn} /> : <div className="plan" />}
          {sel.size > 0 && <aside className="inspector float"><Inspector store={store} sel={sel} scale={scale} onSelect={ids => setSel(new Set(ids))} onOpenPanel={setPanelId} /></aside>}
        </div>
      </div>
    </div>
  );
}
