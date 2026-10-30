import React, { useState, useEffect } from 'react';
import { graphState, subscribeGraph, loadRoadArea } from './client';
export default function GraphDiagnostics({ iso = 'en' }: {
    iso?: string;
}) {
    const [state, setState] = useState(graphState);
    useEffect(() => subscribeGraph(() => setState(graphState())), []);
    const base = iso.toLowerCase().split(/[-_]/)[0], copy = base === 'ru' ? ['Проверить граф дорог', 'Граф дорог', 'загрузка', 'ошибка', 'Источник', 'Узлов', 'В worker', 'JSON', 'Построение', 'Подключение в UI', 'Кеш сохранён'] : base === 'fr' ? ['Vérifier le graphe routier', 'Graphe routier', 'chargement', 'erreur', 'Source', 'Nœuds', 'Worker', 'JSON', 'Préparation', 'Connexion UI', 'Cache enregistré'] : base === 'ar' ? ['فحص شبكة الطرق', 'شبكة الطرق', 'تحميل', 'خطأ', 'المصدر', 'العقد', 'العامل', 'JSON', 'التحضير', 'ربط الواجهة', 'تم حفظ الذاكرة'] : ['Check road graph', 'Road graph', 'loading', 'error', 'Source', 'Nodes', 'Worker', 'JSON', 'Prepare', 'Attach to UI', 'Cache stored'];
    const m = state.metrics;
    return <div className="graph-diagnostics" style={{ padding: 12, maxWidth: 260, fontSize: 12, lineHeight: 1.6 }}>
  <button type="button" className="menu__button" disabled={state.status === 'loading'} onClick={() => { void loadRoadArea().catch(() => { }); }}>{copy[0]}</button>
  <div role="status" data-testid="road-graph-status">{copy[1]}: {state.status === 'loading' ? copy[2] : state.status === 'error' ? copy[3] : state.status}</div>
  {m && <dl data-testid="road-graph-metrics" style={{ margin: 0 }}>{[[copy[4], m.source], [copy[5], m.nodes], [copy[6], `${m.workerMs.toFixed(1)} ms`], [copy[7], `${m.jsonMs.toFixed(1)} ms`], [copy[8], `${m.prepareMs.toFixed(1)} ms`], [copy[9], `${(m.mainAttachMs || 0).toFixed(1)} ms`], [copy[10], String(m.cacheStored ?? m.source !== 'network')]].map(([label, value]) => <React.Fragment key={label}><dt style={{ display: 'inline' }}>{label}: </dt><dd style={{ display: 'inline', margin: 0 }}>{value}<br /></dd></React.Fragment>)}</dl>}
  {state.error && <p role="alert">{state.error}</p>}
 </div>;
}
