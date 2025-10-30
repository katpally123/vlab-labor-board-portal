// app.js — simplified, restored, and self-contained for the VLAB labor board.
// Provides: CSV parsing (PapaParse), STATE.badges, left unassigned stack, tile layers,
// drag & drop, presence tick, and a form submit that does not navigate away.

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('laborForm');
  const output = document.getElementById('output');

  // ===== Summary DOM refs =====
  const elDate   = document.getElementById('displayDate');
  const elDay    = document.getElementById('displayDay');
  const elShift  = document.getElementById('displayShift');
  const elType   = document.getElementById('displayShiftType');
  const elSite   = document.getElementById('displaySite');
  const elPlan   = document.getElementById('displayPlannedHC');
  const elActual = document.getElementById('displayActualHC');
  const codesBar = document.getElementById('codesBar');

  // Left panel stack
  const unassignedStack = document.getElementById('unassignedStack');
  const unassignedCountEl = document.getElementById('unassignedCount');

  // Basic constants and helpers (kept small and explicit)
  const DAY_SET   = new Set(['DA','DB','DC','DL','DN','DH']);
  const NIGHT_SET = new Set(['NA','NB','NC','NL','NN','NH']);
  const dayNames  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const shortDay  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const WEEK_ALLOWED = {
    'Sunday':    ['DA','DB','DL','DH','NA','NB','NL','NH'],
    'Monday':    ['DA','DC','DL','DH','NA','NC','NL','NH'],
    'Tuesday':   ['DA','DC','DL','DH','NA','NC','NL','NH'],
    'Wednesday': ['DA','DB','DL','DH','NB','NL','NH'],
    'Thursday':  ['DB','DC','DL','DH','NB','NC','NL','NH'],
    'Friday':    ['DB','DC','DL','DH','NB','NC','NL','NH'],
    'Saturday':  ['DB','DL','DH','NB','NL','NH']
  };

  const shiftTypeMap = {
    day:   {0:'FHD',1:'FHD',2:'FHD',3:'FHD',4:'BHD',5:'BHD',6:'BHD'},
    night: {0:'FHN',1:'FHN',2:'FHN',3:'FHN',4:'BHN',5:'BHN',6:'BHN'}
  };

  const TILES = [
    ['tile-unassigned','unassigned'],
    ['tile-cb','cb'],
    ['tile-ibws','ibws'],
    ['tile-lineloaders','lineloaders'],
    ['tile-trickle','trickle'],
    ['tile-dm','dm'],
    ['tile-idrt','idrt'],
    ['tile-pb','pb'],
    ['tile-e2s','e2s'],
    ['tile-dockws','dockws'],
    ['tile-e2sws','e2sws'],
    ['tile-tpb','tpb'],
    ['tile-tws','tws'],
    ['tile-sap','sap'],
    ['tile-ao5s','ao5s']
  ];

  // tile layers map key -> element
  const tileBadgeLayers = {};
  document.querySelectorAll('.board-card').forEach((card, idx) => {
    const layer = document.createElement('div');
    // path-box allows wrapping many badges inside process tiles
  layer.className = 'badge-layer path-box';
    card.style.position = card.style.position || 'relative';
    card.appendChild(layer);
    const pair = TILES[idx];
    if (pair){ const key = pair[1]; tileBadgeLayers[key] = layer; }
    // make the layer itself accept drops
    makeDropTarget(layer, TILES[idx] ? TILES[idx][1] : null);
  });

  // unassigned stack should accept drops too
  if (unassignedStack) makeDropTarget(unassignedStack, 'unassigned');

  // In-memory badge store
  const STATE = { badges: {} };

  // --- helpers ---
  function parseInputDate(dateStr){
    if (!dateStr) return null;
    if (dateStr.includes('/')){
      const [d,m,y] = dateStr.split('/').map(Number);
      return new Date(y, m-1, d);
    }
    return new Date(dateStr);
  }

  function toNum(x){ const n = Number(x); return Number.isFinite(n) ? n : NaN; }

  // simplistic site classifier (keeps original behaviour expectation)
  function classifySite(row){
    const d = toNum(row['Department ID'] ?? row.DepartmentID ?? row['Dept ID']);
    const a = toNum(row['Management Area ID'] ?? row.ManagementAreaID);
    // fall back to Other if unknown
    if (isFinite(d)){
      if ([1211010,1211020,1299010,1299020].includes(d)) return 'YHM2';
      if ([1211030,1211040,1299030,1299040].includes(d)) return 'YHM2';
      if ([1211070,1299070].includes(d) && a === 22) return 'YDD2';
    }
    return 'Other';
  }

  function shiftCodeOf(v){ if (!v) return ''; const s = String(v).trim(); return s.slice(0,2).toUpperCase(); }

  function getAllowedCodes(dateStr, shift){
    const d = parseInputDate(dateStr);
    if (!d) return [];
    const wk = dayNames[d.getDay()] || 'Monday';
    const base = WEEK_ALLOWED[wk] || [];
    const set = shift === 'day' ? DAY_SET : NIGHT_SET;
    return base.filter(c => set.has(c));
  }

  function parseCsv(file){
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header:true,
        skipEmptyLines:true,
        complete: res => resolve(res.data || []),
        error: err => reject(err)
      });
    });
  }

  // small helper used for diagnostics: did parse rows exist but active filter remove them all?
  function filteredPreviewNeeded(roster, activeRows){
    return Array.isArray(roster) && roster.length > 0 && Array.isArray(activeRows) && activeRows.length === 0;
  }

  function updateActualHC(){
    const count = Object.values(STATE.badges).reduce((acc,b) => acc + (b.present ? 1 : 0), 0);
    elActual.textContent = String(count);
  }

  function setCounts(){
    const counts = {};
    TILES.forEach(([id,key]) => counts[key] = 0);
    Object.values(STATE.badges).forEach(b => { counts[b.loc] = (counts[b.loc] || 0) + 1; });
    TILES.forEach(([id,key]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(counts[key] || 0);
    });
    unassignedCountEl.textContent = String(counts['unassigned'] || 0);
  }

  function makeDropTarget(container, key){
    // container is the element that will receive dropped badges (.path-box or #unassignedStack)
    container.addEventListener('dragover', (e) => { e.preventDefault(); container.classList && container.classList.add('ring','ring-indigo-300'); });
    container.addEventListener('dragleave', () => { container.classList && container.classList.remove('ring','ring-indigo-300'); });
    container.addEventListener('drop', (e) => {
      e.preventDefault(); container.classList && container.classList.remove('ring','ring-indigo-300');
      const payload = e.dataTransfer.getData('text/plain');
      if (!payload) return;
      // payload may be employee id (preferred) or DOM id
      let node = document.getElementById(payload) || document.querySelector(`.badge[data-id="${payload}"]`);
      if (!node) return; // unknown drag payload
      const badgeId = node.id;
      if (!badgeId || !STATE.badges[badgeId]) return;
      STATE.badges[badgeId].loc = key || 'unassigned';
      // move DOM node into container (append will move, not clone)
      if ((key || 'unassigned') === 'unassigned') unassignedStack.appendChild(node);
      else container.appendChild(node);
      restack(node.parentElement);
      setCounts();
    });
  }

  function restack(container){
    if (!container) return;
    const children = Array.from(container.children);
    children.forEach((c,i) => {
      const isLeft = container.id === 'unassignedStack';
      if (isLeft){ c.style.marginTop = i === 0 ? '0px' : '-18px'; c.style.display = 'block'; c.style.marginLeft = '0px'; }
      else { c.style.marginTop = '0px'; c.style.marginLeft = i === 0 ? '0px' : '-10px'; c.style.display = 'inline-block'; }
      c.style.pointerEvents = 'auto';
    });
  }

  // renderBadge: returns a DOM node for a person (name-only, data-id, data-shift, draggable)
  function renderBadge(p){
    // Card-style badge: 180x100 layout
    const wrap = document.createElement('div');
    wrap.id = p.id;
    wrap.className = `badge ${(p.scode||'').trim()}`.trim();
    wrap.setAttribute('draggable','true');
    if (p.eid) wrap.setAttribute('data-id', String(p.eid));
    if (p.scode) wrap.setAttribute('data-shift', String(p.scode));
    wrap.title = p.name || '';

    // left avatar placeholder
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = (p.name || '').split(' ').map(s => s[0]).slice(0,2).join('').toUpperCase();
    wrap.appendChild(avatar);

    // info column
    const info = document.createElement('div');
    info.className = 'info';
    const nameEl = document.createElement('div'); nameEl.className = 'name'; nameEl.textContent = p.name || '';
    const shiftEl = document.createElement('div'); shiftEl.className = 'shiftmeta';
    const sc = p.scode || '';
    const stype = sc.toUpperCase().startsWith('N') ? 'Night' : 'Day';
    shiftEl.textContent = `${sc} • ${stype}`;
    const eidEl = document.createElement('div'); eidEl.className = 'eid'; eidEl.textContent = p.eid || '';
    info.appendChild(nameEl); info.appendChild(shiftEl); info.appendChild(eidEl);
    wrap.appendChild(info);

    // presence tick (right)
    const tick = document.createElement('div'); tick.className = 'tick'; tick.textContent = '✓';
    if (!p.present) tick.style.display = 'none';
    wrap.appendChild(tick);

    // drag payload uses employee id when possible
    wrap.addEventListener('dragstart', (e) => {
      const emp = String(p.eid || p.id || '');
      try{ e.dataTransfer.setData('text/plain', emp); }catch(_){ e.dataTransfer.setData('text/plain', p.id); }
      try{
        const crt = wrap.cloneNode(true);
        crt.style.opacity = '0.9'; crt.style.position = 'absolute'; crt.style.top = '-9999px';
        document.body.appendChild(crt);
        e.dataTransfer.setDragImage(crt, 20, 20);
        setTimeout(() => document.body.removeChild(crt), 0);
      }catch(_){ }
    });

    // toggle presence on click
    wrap.addEventListener('click', (ev) => {
      // avoid toggling when starting a drag
      if (ev?.detail === 0) return;
      p.present = !p.present;
      if (p.present){ wrap.classList.add('present'); tick.style.display = ''; }
      else { wrap.classList.remove('present'); tick.style.display = 'none'; }
      updateActualHC();
    });

    return wrap;
  }

  function renderAllBadges(){
    // clear
    if (unassignedStack) unassignedStack.innerHTML = '';
    Object.values(tileBadgeLayers).forEach(layer => { if (layer) layer.innerHTML = ''; });
    Object.values(STATE.badges).forEach(b => {
      const node = renderBadge(b);
      if (b.present){ node.classList.add('present'); const t = document.createElement('div'); t.className='tick'; t.textContent='✓'; node.appendChild(t); }
      if (b.loc === 'unassigned') unassignedStack.appendChild(node);
      else tileBadgeLayers[b.loc]?.appendChild(node);
    });
    restack(unassignedStack);
    Object.values(tileBadgeLayers).forEach(restack);
    setCounts(); updateActualHC();
  }

  // change preview
  form.addEventListener('change', () => {
    const date = form.date.value;
    const shift = form.querySelector('input[name="shift"]:checked')?.value || 'day';
    const d = parseInputDate(date);
    if (!d){ elType.textContent = '-'; return; }
    elType.textContent = shiftTypeMap[shift][d.getDay()];
  });

  // submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    output.textContent = 'Processing files…';

    const rosterFile = form.roster.files[0];
    if (!rosterFile){ output.textContent = 'Roster file required.'; return; }
    const swapFile = form.swap.files[0] || null;
    const vetFile = form.vetvto.files[0] || null;
    const lsFile = form.laborshare.files[0] || null;

    Promise.all([
      parseCsv(rosterFile),
      swapFile ? parseCsv(swapFile) : Promise.resolve([]),
      vetFile ? parseCsv(vetFile) : Promise.resolve([]),
      lsFile ? parseCsv(lsFile) : Promise.resolve([]),
    ]).then(([roster, swaps, vetvto, labshare]) => {
      console.debug('[build] rosterFile=', rosterFile && rosterFile.name, 'size=', rosterFile && rosterFile.size);
      console.debug('[build] parsed roster rows=', Array.isArray(roster) ? roster.length : typeof roster, roster && roster[0]);
      const siteSel = form.site.value;
      const dateStr = form.date.value;
      const shiftSel = form.querySelector('input[name="shift"]:checked')?.value || 'day';
      const d = parseInputDate(dateStr); const dow = d?.getDay() ?? 0;
      elDate.textContent = dateStr || '-';
      elDay.textContent = d ? shortDay[dow] : '-';
      elShift.textContent = shiftSel[0].toUpperCase() + shiftSel.slice(1);
      elType.textContent = shiftTypeMap[shiftSel][dow];
      elSite.textContent = siteSel;

      const allowed = new Set(getAllowedCodes(dateStr, shiftSel));
      if (allowed.size){ codesBar.classList.remove('hidden'); codesBar.textContent = `Codes active for ${dayNames[dow]} (${elShift.textContent}): ${[...allowed].sort().join(', ')}`; }
      else { codesBar.classList.add('hidden'); codesBar.textContent = ''; }

      const activeRows = Array.isArray(roster) ? roster.filter(r => String(r['Employee Status'] ?? r.Status ?? '').toLowerCase() === 'active') : [];

      if (Array.isArray(roster) && filteredPreviewNeeded(roster, activeRows)){
        // if parsing succeeded but no "active" rows found, give immediate guidance
        const keys = roster[0] ? Object.keys(roster[0]) : [];
        output.textContent = `Parsed ${roster.length} rows. No active rows matched filters. Detected headers: ${keys.join(', ')}.`;
        console.warn('[build] no active rows after filtering; headers=', keys);
      }
  const filtered = activeRows.filter(r => {
        const site = classifySite(r);
        if (siteSel === 'YHM2' && site !== 'YHM2') return false;
        if (siteSel === 'YDD2' && site !== 'YDD2') return false;
        const sc = shiftCodeOf(r['Shift Pattern'] ?? r['ShiftCode'] ?? r['Shift Code'] ?? r['Shift'] ?? r['Pattern']);
        if (!allowed.has(sc)) return false;
        if (shiftSel === 'day' && !DAY_SET.has(sc)) return false;
        if (shiftSel === 'night' && !NIGHT_SET.has(sc)) return false;
        return true;
      });

      const swapIN  = swaps.filter(x => ((x.Direction ?? x.direction) ?? '').toString().toUpperCase() === 'IN').length;
      const swapOUT = swaps.filter(x => ((x.Direction ?? x.direction) ?? '').toString().toUpperCase() === 'OUT').length;
      const vet = vetvto.filter(x => {
        const t = ((x.Type ?? x.type) ?? '').toString().toUpperCase();
        const acc = ((x.Accepted ?? x.Status) ?? '').toString().toUpperCase();
        return t === 'VET' && (!acc || acc === 'YES' || acc === 'ACCEPTED');
      }).length;
      const vto = vetvto.filter(x => {
        const t = ((x.Type ?? x.type) ?? '').toString().toUpperCase();
        const acc = ((x.Accepted ?? x.Status) ?? '').toString().toUpperCase();
        return t === 'VTO' && (!acc || acc === 'YES' || acc === 'ACCEPTED');
      }).length;
      const lsIN  = labshare.filter(x => (x.Direction ?? x.direction ?? '').toString().toUpperCase() === 'IN').length;
      const lsOUT = labshare.filter(x => (x.Direction ?? x.direction ?? '').toString().toUpperCase() === 'OUT').length;

      const baseHC = filtered.length;
      const plannedHC = baseHC - swapOUT + swapIN + vet - vto + lsIN - lsOUT;
      elPlan.textContent = String(plannedHC); elActual.textContent = '0';

      STATE.badges = {};
      filtered.forEach((r, idx) => {
        const name = (r['Employee Name'] ?? r['Name'] ?? '').toString();
        const eid  = (r['Employee ID'] ?? r['ID'] ?? '').toString();
        const sc   = shiftCodeOf(r['Shift Pattern'] ?? r['ShiftCode'] ?? r['Shift Code'] ?? r['Shift'] ?? r['Pattern']);
        const id   = `b_${eid || idx}_${Math.random().toString(36).slice(2,8)}`;
        STATE.badges[id] = { id, name, eid, scode: sc, site: siteSel, present:false, loc:'unassigned' };
      });

      if (Object.keys(STATE.badges).length === 0){
        output.textContent = 'No badges created — check CSV headers and active status field.';
        console.warn('[build] no badges in STATE.badges');
      }
      renderAllBadges();
      setupVPH(plannedHC);
      output.textContent = '';
    }).catch(err => { console.error(err); output.textContent = 'Error processing files. Please check CSV headers and try again.'; });
  });

  function setupVPH(hc){
    const volInput = document.getElementById('plannedVolumeStub');
    if (!volInput) return;
    const id = 'vph-inline';
    let node = document.getElementById(id);
    if (!node){ node = document.createElement('div'); node.id = id; node.className = 'text-sm text-gray-600 mt-1'; document.getElementById('output').appendChild(node); }
    const update = () => { const planned = Number(volInput.value || 0); node.textContent = `Volume per Head: ${hc > 0 ? (planned / hc).toFixed(2) : '0'}`; };
    volInput.removeEventListener('input', update);
    volInput.addEventListener('input', update);
    update();
  }

  document.getElementById('exportLogBtn')?.addEventListener('click', () => {
    const payload = { date: elDate.textContent, day: elDay.textContent, shift: elShift.textContent, site: elSite.textContent, shiftType: elType.textContent, plannedHC: elPlan.textContent, actualHC: elActual.textContent, ts: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `vlab-shift-summary-${payload.date || 'NA'}.json`; a.click();
  });

});
