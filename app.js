'use strict';
const $=id=>document.getElementById(id), snapshot=window.CDMA_MODE==='snapshot';
const colors=['#e76f51','#7b61ff','#c88b20','#2a9d8f','#1769aa','#8f4a78','#646e80','#c24c88','#307c79','#a06028','#658321'];
const isRevision=version=>Number.parseInt(String(version||'').split('.')[0],10)>=5;
const nf=new Intl.NumberFormat('de-DE',{maximumFractionDigits:2});
const fmt=v=>v==null||!Number.isFinite(Number(v))?'—':nf.format(Number(v));
const pct=v=>v==null?'—':fmt(100*v)+' %';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cat=null, current=null, compactMetrics=null, view='3d', activeTab='cases', requestNo=0, lastCount=-1, lastExport=0, selected=new Set();
const plotConfig={responsive:true,displaylogo:false,modeBarButtonsToRemove:['sendDataToCloud'],toImageButtonOptions:{format:'png',scale:2}};
const baseLayout={font:{family:'Segoe UI, Arial, sans-serif',size:11,color:'#53637b'},paper_bgcolor:'#fff',plot_bgcolor:'#fff',margin:{l:60,r:15,t:15,b:50},legend:{orientation:'h',y:-.22,font:{size:10}},hovermode:'closest'};
async function api(name,id){
 const url=(name==='dataset'?id:name)+'.json.gz';
 const r=await fetch(url+'?v='+Date.now(),{cache:'no-store'});
 if(!r.ok)throw Error('Daten konnten nicht geladen werden ('+r.status+').');
 const stream=r.body.pipeThrough(new DecompressionStream('gzip'));
 return JSON.parse(await new Response(stream).text());
}
function notice(message){$('notice').hidden=!message;$('notice').textContent=message||'';}
function options(el,values,label=v=>v,preferred=null){const old=el.value;el.innerHTML=values.map(v=>`<option value="${esc(v)}">${esc(label(v))}</option>`).join('');el.value=values.map(String).includes(old)?old:values.map(String).includes(String(preferred))?String(preferred):String(values[0]??'');}
function levels(rows,key){return [...new Set(rows.map(r=>r[key]))].sort((a,b)=>a-b);}
function color(name){return colors[cat.methods.indexOf(name)]||'#555';}
function validResult(r){return !!r.Success&&!!(r.Validated??r.Converged);}
function validCompact(r){return !!r[6]&&!!(r.length>9?r[9]:r[7]);}
function flagText(v){return v==null?'nicht getrennt geprüft':v?'erfüllt':'offen';}
function statusText(r){const words={'validated':'Numerische Prüfkriterien erfüllt','iteration/stationarity not certified':'Numerischer Abbruch noch nicht bestätigt','objective converged but measurement mismatch':'Numerik erfüllt; Messdatenkriterium verfehlt','parameter selection not bracketed':'Parametersuche nicht abgesichert','auxiliary constraint violation':'Nebenbedingung verletzt','execution error':'Ausführungsfehler','Legacy convergence criterion passed':'Altstand: bisheriges Abbruchkriterium erfüllt','Legacy convergence criterion not passed':'Altstand: bisheriges Abbruchkriterium nicht erfüllt'};return words[r.Status]||r.Status||'';}
function statusBadge(r){if(!r.Success)return '<span class="badge bad">Ausführungsfehler</span><div class="small muted">'+esc(r.Error||'')+'</div>';const legacy=r.DataCompatible==null&&r.ParameterSelectionValid==null;return `<span class="badge ${validResult(r)?'good':'warn'}">${validResult(r)?legacy?'Vorläufiger Altstand':'Bewertbar':'Bewertung offen'}</span><div class="small muted">Numerik: ${flagText(r.ObjectiveConverged??r.Converged)}<br>Datenpassung: ${flagText(r.DataCompatible)}<br>Parameterwahl: ${flagText(r.ParameterSelectionValid)}</div><div class="small">${esc(statusText(r))}${r.ConstraintViolation!=null?'<br>Nebenbedingungsverletzung: '+esc(Number(r.ConstraintViolation).toExponential(1)):''}</div>`;}
function plot(id,traces,layout={}){$(id).classList.remove('empty');return Plotly.react(id,traces,{...baseLayout,...layout},plotConfig);}
function empty(id,text){Plotly.purge(id);$(id).innerHTML='';const p=document.createElement('div');p.className='empty';p.textContent=text;$(id).append(p);}
function showStatus(s){
 const p=s.progress||{}, date=new Date((snapshot?s.exportedAt:s.updatedAt)*1000);
 $('state').textContent=snapshot?(p.state==='complete'?'Rechenlauf abgeschlossen':p.state==='running'?'MATLAB rechnet · lokaler Export':p.state==='paused'?'Benchmark pausiert':p.state==='stopped'?'Lauf gestoppt · gespeicherter Stand':'Gespeicherter Zwischenstand'):s.stale?'Status veraltet':p.state==='complete'?'Abgeschlossen':p.state==='running'?'MATLAB rechnet':p.state==='interrupted'?'Unterbrochen':p.state||'Unbekannt';
 $('state').className='badge '+(!snapshot&&s.stale?'warn':'');
 $('updated').textContent=(s.version?s.version+' · ':'')+(snapshot?'Export: ':'Letzte Statusmeldung: ')+date.toLocaleString('de-DE',{timeZone:'Europe/Berlin'});
 $('runs').textContent=fmt(p.completedSolverRuns);$('runTotal').textContent='von '+fmt(p.plannedSolverRuns)+' im Gesamtplan';
 $('converged').textContent=fmt(p.validated??p.converged);$('converged').parentElement.querySelector('span').textContent='Bewertbare Ergebnisse ohne Form-Fit';$('failed').textContent='Numerik: '+fmt(p.objectiveConverged??p.converged)+' inkl. Form-Fit · '+fmt(p.failed)+' Ausführungsfehler';
 const stage=(s.stages||[]).find(x=>x.Stage==='factorial27');$('nine').textContent=stage?`${stage.CompletedDatasets} / ${stage.PlannedDatasets}`:'— / 27';
 if(snapshot)$('updateExplanation').textContent='Diese Seite zeigt den oben datierten lokalen Export des ausgewählten Laufs. Neue MATLAB-Ergebnisse erscheinen nach erneuter Erstellung des Exports. GitHub-Veröffentlichung ist hiervon getrennt; diese Ansicht bestätigt keine öffentliche Veröffentlichung.';
 const summary=document.querySelector('.livebar ~ p.note');if(summary)summary.textContent=isRevision(s.version)?'Solver-Revision: Numerik, Datenpassung, Parameterwahl und Nebenbedingungen werden getrennt geprüft. Bestenauswahl und Mediane verwenden bewertbare Ergebnisse ohne Lognormal-Fit. Unabhängige Implementierungsprüfungen bestanden; eine endgültige Solverempfehlung bleibt offen.':'Altstand des gestoppten Laufs: Die ursprünglichen Konvergenzmeldungen sind methodenspezifisch und enthalten die dokumentierten numerischen Probleme. Getrennte Daten- und Parameterprüfungen fehlen für diesen Altstand. Der Lognormal-Fit bleibt aus der Bewertung ausgeschlossen.';
 if(!snapshot&&s.stale)notice('Die MATLAB-Statusmeldung ist älter als 90 Sekunden. Der letzte gespeicherte Stand bleibt sichtbar; ein laufender Prozess ist dadurch nicht bestätigt.');
}
function setupCatalog(data){cat=data;if(!selected.size)selected=new Set(cat.methods.filter(m=>m!=='Lognormal-fit'));showStatus(cat.status);$('solverChecks').innerHTML=cat.methods.map((m,i)=>`<label><input type="checkbox" data-method="${esc(m)}" ${selected.has(m)?'checked':''}><i class="dot" style="background:${colors[i]}"></i>${esc(m)}</label>`).join('');$('solverChecks').querySelectorAll('input').forEach(el=>el.onchange=()=>{el.checked?selected.add(el.dataset.method):selected.delete(el.dataset.method);renderLines();});
 $('solverTable').querySelector('thead th:nth-child(2)').textContent='Numerik, Daten & Bewertung';
 $('summaryTable').querySelector('thead').innerHTML='<tr><th>Verfahren</th><th>Gespeichert / geplant</th><th>Bewertbar</th><th>Bewertung offen</th><th>Ausführungsfehler</th><th>Median</th></tr>';
 for(const el of document.querySelectorAll('#aboutTab p'))el.textContent.includes('Ein unabhängiger Vergleich neu diskretisierter dᵥ-Gitter ist noch nicht durchgeführt.')&&(el.textContent=el.textContent.replace('Ein unabhängiger Vergleich neu diskretisierter dᵥ-Gitter ist noch nicht durchgeführt.','Ein älterer zusätzlicher Vergleich neu diskretisierter dᵥ-Gitter umfasst nur einen Fall und liefert keine allgemeine Empfehlung.'));
 document.querySelectorAll('#mapsTab .small.muted').forEach(el=>{el.textContent=el.textContent.replaceAll('konvergierter','bewertbarer').replaceAll('konvergiertes','bewertbares').replaceAll('konvergierte','bewertbare');});
 const explanation=document.querySelector('.solvercard p');if(explanation)explanation.textContent='Der Lognormal-Fit läuft weiter, ist aber aus Standardauswahl, Bestenauswahl und Mediansbewertung ausgeschlossen. Er bleibt einzeln auswählbar. Gepunktete Kurven (*) haben noch nicht alle Bewertungskriterien erfüllt; ein Optimierer-Stopp allein genügt nicht.';
 if(isRevision(cat.status.version)){const paragraphs=document.querySelectorAll('#aboutTab p');for(const el of paragraphs){if(el.textContent.startsWith('Nichtnegativität'))el.textContent='Nichtnegativität und dₛₜ ≤ dₘ gelten in allen Armen. Die Gesamtzahl wird rekonstruiert. POCS-PSS verwendet eine gewichtete Fehlerkugel; die überarbeitete POCS-CDMA-Variante nutzt konvexe simultane Einzelbänder und keine Pilotmarginalen oder nichtkonvexen Schwellen. Beide Verfahren wählen die nächste zulässige Binmassenlösung zum Nullstart.';if(el.textContent.startsWith('Optionale unabhängig'))el.textContent='Unabhängig gemessene Gesamtzahl und Randverteilungen sind als lineare Bänder für POCS-PSS, POCS-CDMA, TGV² und lsqlin implementiert und isoliert getestet. Im Hauptvergleich fehlen unabhängige Eingangsdaten; diese Bedingungen sind deaktiviert. Andere Arme dürfen mit zusätzlicher Messinformation nicht als gleichwertig ausgeführt werden.';if(el.textContent.startsWith('Das relative L2'))el.textContent='Das relative L2 integriert quadratische Dichtefehler mit zulässigen Binflächen. Numerischer Abbruch, Datenpassung, Parameterwahl und Nebenbedingungen sind separate Prüfungen. „Bestes Ergebnis“ wählt nur zur Illustration nach Soll-L2 unter bewertbaren Ergebnissen ohne Lognormal-Fit; die Parameterwahl nutzt die Sollverteilung nicht.';}}
 options($('mapCase'),['all',...cat.cases.map(x=>x.caseId)],v=>v==='all'?'Alle drei Grundfälle':v);options($('mapMethod'),cat.methods.filter(m=>m!=='Lognormal-fit'));options($('mapN'),levels(cat.datasets,'N'),fmt,1e5);options($('mapAbs'),levels(cat.datasets,'AbsoluteFraction'),pct,.03);options($('mapRel'),levels(cat.datasets,'Relative'),pct,.03);choices();
 if(Object.keys(cat.warnings||{}).length)notice('Einzelne Zwischenstände konnten noch nicht gelesen werden. Die Anzeige wird beim nächsten Aktualisieren erneut geprüft.');
}
function choices(){
 let rows=cat.datasets.filter(r=>r.Modes===Number($('modes').value)&&(!$('availableOnly').checked||r.solved>0));
 const cases=[...new Set(rows.map(r=>r.CaseId))];
 options($('caseId'),cases,v=>{const p=cat.cases.find(x=>x.caseId===v);return `${v} · ${p.anchorDm}/${p.anchorDst} nm · GSD ${p.gsdDm}/${p.gsdDst}`;});
 rows=rows.filter(r=>r.CaseId===$('caseId').value);
 options($('concentration'),levels(rows,'N'),fmt,1e5);
 rows=rows.filter(r=>r.N===Number($('concentration').value));
 options($('absolute'),levels(rows,'AbsoluteFraction'),pct,.03);
 rows=rows.filter(r=>r.AbsoluteFraction===Number($('absolute').value));
 options($('relative'),levels(rows,'Relative'),pct,.03);
 rows=rows.filter(r=>r.Relative===Number($('relative').value));
 options($('dataset'),rows.map(r=>r.Dataset),id=>{const r=cat.datasets.find(x=>x.Dataset===id);let label=`${id} · Wdh. ${r.Replicate} · ${r.solved}/${cat.methods.length}`;
 if(r.Rho)label+=` · ρ ${r.Rho}`;if(r.Offset)label+=` · Offset ${r.Offset}`;if(r.Drift)label+=` · Drift ${pct(r.Drift)}`;if(r.Forward==='fine')label+=' · feines Vorwärtsgitter';return label;});
 $('choiceHint').textContent=rows.length?`${rows.length} Datensätze für diese Auswahl. „Wiederholung“ bedeutet eine feste Rauschrealisierung.`:'Keine gespeicherten Ergebnisse für diese Auswahl. „Nur Fälle mit gespeicherten Ergebnissen“ ausschalten, um geplante Fälle zu sehen.';
 loadCase();
}
async function loadCase(){const id=$('dataset').value,n=++requestNo;if(!id){current=null;clearCase('Noch keine Ergebnisse für diese Auswahl.');return;}try{
 const meta=cat.datasets.find(r=>r.Dataset===id);
 const d=meta.solved?await api('dataset',id):{id,meta,pending:true,components:cat.cases.find(p=>p.caseId===meta.CaseId).components.map(p=>({...p,rho:meta.Rho}))};
 if(n!==requestNo)return;current=d;renderCase();
 }catch(e){if(n===requestNo){current=null;clearCase(e.message);notice(e.message);}}}
function clearCase(text){$('caseTitle').textContent=text;$('caseState').textContent='Ausstehend';$('caseDescription').textContent='';$('components').innerHTML='';$('noiseDetail').textContent='';$('surfaceNote').textContent='';$('surfaceSolver').innerHTML='';$('solverTable').querySelector('tbody').innerHTML='';for(const id of ['truthPlot','reconPlot','errorPlot','dmPlot','dstPlot','measurementPlot'])empty(id,text);}
function renderCase(){const d=current,r=d.meta;
 $('caseTitle').textContent=`${r.CaseId} · ${d.id}`;$('caseState').textContent=d.pending?'Geplant':`${d.metrics.length} / ${cat.methods.length} Solver gespeichert`;
 $('caseDescription').textContent=`${r.Modes} ${r.Modes===1?'Mode':'Moden'} · N = ${fmt(r.N)} #/cm³ · Wiederholung ${r.Replicate} · ${r.Forward==='fine'?'feineres Vorwärtsgitter (128 Bins/Dekade)':'identische Vorwärtsdiskretisierung (Konsistenztest)'}`;
 $('components').innerHTML=d.components.map((p,i)=>`<div class="component"><b>Komponente ${i+1} · ${pct(p.weight)}</b><dl><dt>GMD dₘ / dₛₜ</dt><dd>${fmt(p.gmdDm)} / ${fmt(p.gmdDst)} nm</dd><dt>GSD dₘ / dₛₜ</dt><dd>${fmt(p.gsdDm)} / ${fmt(p.gsdDst)}</dd><dt>Korrelation</dt><dd>${fmt(p.rho)}</dd></dl></div>`).join('');
 $('noiseDetail').textContent=`Absolutes σ: ${pct(r.AbsoluteFraction)} des Signalmaximums · relatives σ: ${pct(r.Relative)} · Offset: ${fmt(r.Offset)} #/cm³ · Drift: ${pct(r.Drift)} · Seed: ${r.Seed}`;
 if(d.pending){$('surfaceSolver').innerHTML='';$('surfaceNote').textContent='Geplanter Fall; es wird keine Verteilung vorgetäuscht.';for(const id of ['truthPlot','reconPlot','errorPlot','dmPlot','dstPlot','measurementPlot'])empty(id,'Noch nicht berechnet.');$('solverTable').querySelector('tbody').innerHTML='';return;}
 options($('surfaceSolver'),['best',...d.solutions.map(s=>s.method)],m=>m==='best'?'Bestes bewertbares Ergebnis ohne Form-Fit':m,'best');
 renderSurfaces();renderLines();
 $('solverTable').querySelector('tbody').innerHTML=cat.methods.map(m=>{const q=d.metrics.find(x=>x.Method===m);if(!q)return `<tr><td>${esc(m)}</td><td><span class="badge">Ausstehend</span></td><td colspan="8">Noch kein gespeichertes Ergebnis</td></tr>`;return `<tr><td><i class="dot" style="background:${color(m)}"></i> ${esc(m)}</td><td>${statusBadge(q)}</td><td>${pct(q.RelativeL2)}</td><td>${pct(q.TotalRelativeError)}</td><td>${pct(q.MeasurementRelativeL2)}</td><td>${fmt(q.ReducedChi2)}</td><td>${fmt(q.GMD_dm_nm)} / ${fmt(q.GMD_dst_nm)}</td><td>${fmt(q.GSD_dm)} / ${fmt(q.GSD_dst)}</td><td>${fmt(q.Seconds/60)} min</td><td>${fmt(q.Iterations)}</td></tr>`;}).join('');
}
function chosen(){if(!current||current.pending)return null;const name=$('surfaceSolver').value;
 if(name!=='best')return current.solutions.find(s=>s.method===name);
 return current.solutions.filter(s=>s.method!=='Lognormal-fit'&&validResult(s.metrics)).sort((a,b)=>a.metrics.RelativeL2-b.metrics.RelativeL2)[0]||null;
}
function renderSurfaces(){if(!current||current.pending)return;const d=current,s=chosen();if(!s){for(const id of ['truthPlot','reconPlot','errorPlot'])empty(id,'Noch kein bewertbares Ergebnis. Einen gespeicherten Solver gezielt auswählen.');$('surfaceNote').textContent='Automatische Bestenauswahl erfordert erfolgreiche Ausführung und erfüllte Bewertungskriterien.';return;}
 $('surfaceNote').textContent=`${s.method} · ${validResult(s.metrics)?'bewertbar':'BEWERTUNG OFFEN'} · Numerik ${flagText(s.metrics.ObjectiveConverged??s.metrics.Converged)} · Daten ${flagText(s.metrics.DataCompatible)} · Parameter ${flagText(s.metrics.ParameterSelectionValid)} · L2 ${pct(s.metrics.RelativeL2)}${$('surfaceSolver').value==='best'?' · Auswahl nach Soll-L2 nur zur Illustration; keine Parameteroptimierung.':''}`;
 const coord=$('coordinate').value;const labels=coord==='dm-dv'?['dₘ','dᵥ']:coord==='dv-dst'?['dᵥ','dₛₜ']:['dₘ','dₛₜ'];$('densityCaption').textContent='Soll, Rekonstruktion und vorzeichenbehafteter Fehler · d²N / dln('+labels[0]+') dln('+labels[1]+') [cm⁻³]';const factor=coord==='dm-dv'?1.5:coord==='dv-dst'?3:1;const t=d.truth.density.map(r=>r.map(v=>v==null?null:v*factor)),z=s.density.map(r=>r.map(v=>v==null?null:v*factor)),diff=z.map((row,j)=>row.map((v,i)=>v==null?null:v-t[j][i]));
 let peak=0,err=0;for(let j=0;j<z.length;j++)for(let i=0;i<z[j].length;i++){peak=Math.max(peak,z[j][i]||0,t[j][i]||0);err=Math.max(err,Math.abs(diff[j][i]||0));}
 peak=peak||1;err=err||1;
 [['truthPlot',t,false],['reconPlot',z,false],['errorPlot',diff,true]].forEach(([id,a,isError])=>{
 const min=isError?-err:0,max=isError?err:peak,scale=isError?'RdBu':'Viridis';
 const meshX=d.centres.map(dst=>d.centres.map(dm=>coord==='dv-dst'?Math.cbrt(dst*dst*dm):dm)),meshY=d.centres.map(dst=>d.centres.map(dm=>coord==='dm-dv'?Math.cbrt(dst*dst*dm):dst));const trace={type:view==='3d'?'surface':'heatmap',x:coord==='dm-dst'?d.centres:meshX,y:coord==='dm-dst'?d.centres:meshY,z:a,colorscale:scale,reversescale:isError,connectgaps:false,colorbar:{thickness:9,len:.7,tickformat:'.1e'},hovertemplate:'Achse 1 %{x:.1f} nm<br>Achse 2 %{y:.1f} nm<br>Dichte %{z:.3e}<extra></extra>'};
 if(view==='3d'){trace.cmin=min;trace.cmax=max;}else{trace.zmin=min;trace.zmax=max;trace.hoverongaps=false;}
 const axis={type:'log',title:{text:coord==='dv-dst'?'dᵥ [nm]':'dₘ [nm]',font:{size:11}},tickvals:[25,50,100,250,500,1000],gridcolor:'#edf1f6'};
 plot(id,[trace],{margin:{l:view==='3d'?0:55,r:25,t:5,b:view==='3d'?0:50},uirevision:d.id+view,scene:{xaxis:axis,yaxis:{...axis,title:{text:coord==='dm-dv'?'dᵥ [nm]':'dₛₜ [nm]'}},zaxis:{title:{text:'Dichte [cm⁻³]'},range:[min,max*1.03],tickformat:'.1e'},camera:{eye:{x:1.45,y:-1.6,z:1.05}},aspectratio:{x:1,y:1,z:.8}},xaxis:axis,yaxis:{...axis,title:'dₛₜ [nm]'}});
 });
}
function renderLines(){if(!current||current.pending)return;const d=current,ss=d.solutions.filter(s=>selected.has(s.method));
 for(const [id,key,title] of [['dmPlot','marginalDm','dₘ'],['dstPlot','marginalDst','dₛₜ']]){
 const traces=[{x:d.centres,y:d.truth[key],name:'Soll',mode:'lines',line:{color:'#15263e',width:3}}];
 for(const s of ss)traces.push({x:d.centres,y:s[key],name:s.method+(validResult(s.metrics)?'':' *'),mode:'lines',line:{color:color(s.method),width:1.7,dash:validResult(s.metrics)?'solid':'dot'}});
 plot(id,traces,{xaxis:{type:'log',title:title+' [nm]'},yaxis:{title:'dN / dln('+title+') [cm⁻³]',rangemode:'tozero'},uirevision:d.id});}
 const m=d.measurement,x=m.y.map((_,i)=>i+1),traces=[{x,y:m.clean,name:'Rauschfreie Erwartung',line:{color:'#1b293d',width:2}},{x,y:m.y,name:'Messdaten',mode:'markers',marker:{color:'#8995a6',size:3}}];
 for(const s of ss)traces.push({x,y:s.fitted,name:s.method+(validResult(s.metrics)?'':' *'),line:{color:color(s.method),width:1.4,dash:validResult(s.metrics)?'solid':'dot'}});
 plot('measurementPlot',traces,{xaxis:{title:'Messpunkt im gespeicherten Scan'},yaxis:{title:'Konzentration [#/cm³]'},uirevision:d.id});
}
function csvDownload(){if(!current||current.pending)return;const rows=current.metrics,keys=Object.keys(rows[0]);const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const text='\ufeff'+[keys.map(cell).join(','),...rows.map(r=>keys.map(k=>cell(r[k])).join(','))].join('\r\n');const u=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download=current.id+'_metrics.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
async function renderSummary(){if(!cat)return;try{
 if(!compactMetrics)compactMetrics=await api('metrics');
 const metric=Number($('mapMetric').value),method=cat.methods.indexOf($('mapMethod').value);
 const pp=cat.datasets.filter(r=>$('mapCase').value==='all'||r.CaseId===$('mapCase').value),ids=new Set(pp.map(r=>r.Dataset)),rr=compactMetrics.filter(r=>ids.has(r[0]));
 const val=r=>metric===3?Math.abs(r[metric]):r[metric];
 const agg=rs=>{const good=rs.filter(r=>validCompact(r)&&val(r)!=null),v=good.map(val).sort((a,b)=>a-b);return {saved:rs.length,good:good.length,non:rs.filter(r=>r[6]&&!validCompact(r)).length,fail:rs.filter(r=>!r[6]).length,median:v.length?(v[Math.floor((v.length-1)/2)]+v[Math.ceil((v.length-1)/2)])/2:null};};
 const stats=cat.methods.map((m,i)=>({...agg(rr.filter(r=>r[1]===i)),method:m})).filter(s=>s.method!=='Lognormal-fit'),format=v=>metric===5?fmt(v)+' s':pct(v);
 $('summaryTable').querySelector('tbody').innerHTML=stats.map(s=>`<tr><td>${esc(s.method)}</td><td>${s.saved} / ${pp.length}</td><td>${s.good}</td><td>${s.non}</td><td>${s.fail}</td><td>${s.median==null?'—':format(s.median)}</td></tr>`).join('');
 const vv=stats.filter(s=>s.median!=null);if(vv.length)plot('benchmarkPlot',[{type:'bar',orientation:'h',y:vv.map(s=>s.method),x:vv.map(s=>s.median*(metric===5?1:100)),marker:{color:vv.map(s=>color(s.method))},customdata:vv.map(s=>`${s.good}/${pp.length} konvergiert`),hovertemplate:'%{y}<br>%{x:.3g}'+(metric===5?' s':' %')+'<br>%{customdata}<extra></extra>'}],{margin:{l:155,r:15,t:10,b:45},xaxis:{title:metric===5?'Median [s]':'Median [%]'},yaxis:{autorange:'reversed'}});else empty('benchmarkPlot','Noch keine konvergierten Ergebnisse.');
 const levels=[0,.03,.05],z=[],text=[],labels=[];
 for(const a of levels){const zr=[],tr=[],lr=[];for(const b of levels){const cell=pp.filter(r=>r.AbsoluteFraction===a&&r.Relative===b),ci=new Set(cell.map(r=>r.Dataset)),s=agg(rr.filter(r=>r[1]===method&&ci.has(r[0])));zr.push(s.median==null?null:s.median*(metric===5?1:100));tr.push(`Absolut ${pct(a)} · relativ ${pct(b)}<br>${s.median==null?(s.saved?'Noch kein bewertbares Ergebnis':'Noch nicht berechnet'):format(s.median)}<br>${s.saved}/${cell.length} gespeichert · ${s.good} bewertbar`);lr.push(s.median==null?(s.saved?(s.fail===s.saved?'Fehler':'Prüfung<br>offen'):'ausstehend'):fmt(s.median*(metric===5?1:100))+(metric===5?' s':' %'));}z.push(zr);text.push(tr);labels.push(lr);}
 plot('mapPlot',[{type:'heatmap',x:[0,1,2],y:[0,1,2],z,text,hovertemplate:'%{text}<extra></extra>',hoverongaps:true,colorscale:'YlGnBu',colorbar:{title:metric===5?'s':'%',thickness:12},xgap:3,ygap:3}],{xaxis:{title:'Relatives Rausch-σ',tickvals:[0,1,2],ticktext:['0 %','3 %','5 %'],range:[-.5,2.5]},yaxis:{title:'Absolutes σ / max(μ)',tickvals:[0,1,2],ticktext:['0 %','3 %','5 %'],range:[-.5,2.5]},plot_bgcolor:'#eaf0f7',annotations:z.flatMap((row,j)=>row.map((v,i)=>({x:i,y:j,text:labels[j][i],showarrow:false,font:{color:'#17223a',size:12},bgcolor:'#ffffffd9'})))});
 }catch(e){notice(e.message);}}
let lastMeasurementExport=0;
async function refreshMeasurementPanel(){
 const existing=$('measurementTab');if(!existing)return;
 const payload=await api('measurementPanel');
 if(payload.exportedAt===lastMeasurementExport)return;
 const parsed=new DOMParser().parseFromString(payload.html,'text/html');
 const next=parsed.getElementById('measurementTab');if(!next)throw Error('Messpunktstand konnte nicht gelesen werden.');
 for(const detail of existing.querySelectorAll('details[id]')){
  const updated=next.querySelector('#'+detail.id);if(updated)updated.open=detail.open;
 }
 next.hidden=activeTab!=='measurement';
 for(const img of next.querySelectorAll('img'))img.src=img.getAttribute('src')+'?v='+payload.exportedAt;
 existing.replaceWith(next);lastMeasurementExport=payload.exportedAt;
}
async function refresh(full=false){try{const s=await api('status');showStatus(s);if(full||!cat||s.progress.completedSolverRuns!==lastCount||(s.exportedAt||0)!==lastExport){lastCount=s.progress.completedSolverRuns;lastExport=s.exportedAt||0;compactMetrics=null;setupCatalog(await api('catalog'));if(activeTab==='maps')await renderSummary();}await refreshMeasurementPanel();}catch(e){notice(e.message+' Der letzte geladene Stand bleibt sichtbar.');}}
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{activeTab=b.dataset.tab;document.querySelectorAll('.tab').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-selected',String(x===b));});for(const name of ['cases','maps','audit','measurement','about'])$(name+'Tab').hidden=name!==activeTab;if(activeTab==='maps')renderSummary();if(activeTab==='cases'&&current&&!current.pending){renderSurfaces();renderLines();}});
for(const id of ['modes','caseId','concentration','absolute','relative','availableOnly'])$(id).onchange=choices;
$('coordinate').onchange=()=>{view='3d';$('view3d').classList.add('selected');$('view2d').classList.remove('selected');renderSurfaces();};$('dataset').onchange=loadCase;$('surfaceSolver').onchange=renderSurfaces;
for(const kind of ['3d','2d'])$('view'+kind).onclick=()=>{if(kind==='2d')$('coordinate').value='dm-dst';view=kind;$('view3d').classList.toggle('selected',view==='3d');$('view2d').classList.toggle('selected',view==='2d');renderSurfaces();};
for(const id of ['mapCase','mapMetric','mapMethod'])$(id).onchange=renderSummary;
$('refresh').onclick=()=>refresh(true);$('download').onclick=csvDownload;
$('allSolvers').onclick=()=>{selected=new Set(cat.methods.filter(m=>m!=='Lognormal-fit'));$('solverChecks').querySelectorAll('input').forEach(x=>x.checked=x.dataset.method!=='Lognormal-fit');renderLines();};
refresh(true);setInterval(()=>{if(!document.hidden)refresh();},15000);

