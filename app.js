// app.js — VLAB board: roster logic, optional files, dd/mm/yyyy date fix,
// unassigned left panel with solitaire-style stacked badges, drag & drop into tiles,
// presence tick on click (no flipping).

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

  // ===== Board/Grid & Unassigned (we’ll build a left panel dynamically) =====
  const boardGrid = document.querySelector('.grid.grid-cols-5');
  // Wrap grid with a flex container and add a left sidebar
  const wrapper = document.createElement('div');
  wrapper.className = 'flex gap-4 mt-6';
  boardGrid.parentNode.insertBefore(wrapper, boardGrid);
  const leftPanel = document.createElement('aside');
  leftPanel.id = 'leftPanel';
  leftPanel.className = 'w-64 bg-white border border-gray-200 rounded-xl p-3 h-[72vh] overflow-auto';
  leftPanel.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <h2 class="text-sm font-semibold">Unassigned</h2>
      <span class="text-xs text-gray-600" id="unassignedCount">0</span>
    </div>
    <div id="unassignedStack" class="relative"></div>
  `;
  const rightPane = document.createElement('div');
  rightPane.className = 'flex-1';
  wrapper.appendChild(leftPanel);
  wrapper.appendChild(rightPane);
  // Create a right-side Process Paths panel to surface common targets
  const rightPanel = document.createElement('aside');
  rightPanel.id = 'rightPanel';
  rightPanel.className = 'w-64 bg-white border border-gray-200 rounded-xl p-3 h-[72vh] overflow-auto';
  rightPanel.innerHTML = `
    <div class="flex items-center justify-between mb-2">
      <h2 class="text-sm font-semibold">Process Paths</h2>
      <span class="text-xs text-gray-600">Drop targets</span>
    </div>
    <div id="processPaths" class="space-y-3">
      <div class="proc-card" id="process-cb"><span class="font-semibold">CB</span><span class="proc-count" id="proc-count-cb">0</span></div>
      <div class="proc-card" id="process-sort"><span class="font-semibold">Sort</span><span class="proc-count" id="proc-count-sort">0</span></div>
      <div class="proc-card" id="process-dock"><span class="font-semibold">Dock</span><span class="proc-count" id="proc-count-dock">0</span></div>
    </div>
  `;
  wrapper.appendChild(rightPanel);
  rightPane.appendChild(boardGrid);

  const unassignedCountEl = document.getElementById('unassignedCount');
  const unassignedStack = document.getElementById('unassignedStack');

  // A badge state store so we can re-render anywhere
  /** @type {Record<string,{id:string,name:string,eid:string,scode:string,site:string,present:boolean,loc:string}>} */
  const STATE = { badges: {} };

  // ===== Foundation: site & dept mapping =====
  const YHM2_INB  = [1211010,1211020,1299010,1299020];
  const YHM2_OUTB = [1211030,1211040,1299030,1299040];
  const YDD2      = [1211070,1299070];

  // ===== Shift logic =====
  const DAY_SET   = new Set(['DA','DB','DC','DL','DN','DH']);
  const NIGHT_SET = new Set(['NA','NB','NC','NL','NN','NH']);
  const dayNames  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const shortDay  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Allowed codes per weekday (incl. night)
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

  // ===== Tiles config (DOM id, key) — keep your existing cards =====
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
    ['tile-ao5s','ao5s'],
  ];

  // For each board-card, add a hidden badge layer for drop targets
  const tileBadgeLayers = {};
  document.querySelectorAll('.board-card').forEach((card, idx) => {
    const layer = document.createElement('div');
    layer.className = 'absolute inset-x-2 bottom-2 pointer-events-none'; // keep visible but ignore clicks
    // Use relative on parent
    card.style.position = 'relative';
    card.appendChild(layer);
    const [countId, key] = TILES[idx] || [];
    if (key) {
      // allow multiple layers per logical key (array) while keeping backwards compatibility
      if (!tileBadgeLayers[key]) tileBadgeLayers[key] = layer;
      else if (tileBadgeLayers[key] instanceof HTMLElement) tileBadgeLayers[key] = [tileBadgeLayers[key], layer];
      else tileBadgeLayers[key].push(layer);
    }
    makeDropTarget(card, key);
  });

  // Wire up the Process Paths cards we added to the rightPanel. Map them to existing tile keys.
  // process-cb -> 'cb', process-sort -> 'e2s' (Each to Sort), process-dock -> 'dockws'
  const PROCESS_MAPPINGS = [ ['process-cb','cb'], ['process-sort','e2s'], ['process-dock','dockws'] ];
  PROCESS_MAPPINGS.forEach(([cardId, key]) => {
    const card = document.getElementById(cardId);
    if (!card) return;
    const layer = document.createElement('div');
    layer.className = 'absolute inset-x-2 bottom-2 pointer-events-none';
    card.style.position = 'relative';
    card.appendChild(layer);
    if (!tileBadgeLayers[key]) tileBadgeLayers[key] = layer;
    else if (tileBadgeLayers[key] instanceof HTMLElement) tileBadgeLayers[key] = [tileBadgeLayers[key], layer];
    else tileBadgeLayers[key].push(layer);
    makeDropTarget(card, key);
  });

  // ===== Helpers =====
  function parseInputDate(dateStr){
    // Accept "yyyy-mm-dd" (native date input) or "dd/mm/yyyy"
    if (!dateStr) return null;
    if (dateStr.includes('/')){
      const [d,m,y] = dateStr.split('/').map(Number);
      return new Date(y, m-1, d);
    }
    return new Date(dateStr);
  }

  function classifySite(row){
    const d = toNum(row['Department ID'] ?? row.DepartmentID ?? row['Dept ID']);
    const a = toNum(row['Management Area ID'] ?? row.ManagementAreaID);
    if (YHM2_INB.includes(d) || YHM2_OUTB.includes(d)) return 'YHM2';
    if (YDD2.includes(d) && a === 22) return 'YDD2';
    if (YDD2.includes(d) && a === 27) return 'Shared-ICQA';
    return 'Other';
  }

  function toNum(x){ const n = Number(x); return Number.isFinite(n) ? n : NaN; }

  function shiftCodeOf(v){
    if (!v) return '';
    const s = String(v).trim();
    return s.slice(0,2).toUpperCase();
  }

  function getAllowedCodes(dateStr, shift){
    const d = parseInputDate(dateStr);
    if (!d) return [];
    const wk = dayNames[d.getDay()];
    const base = WEEK_ALLOWED[wk] || [];
    const set  = (shift === 'day') ? DAY_SET : NIGHT_SET;
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

  function updateActualHC(){
    const count = Object.values(STATE.badges).reduce((acc,b) => acc + (b.present ? 1 : 0), 0);
    elActual.textContent = String(count);
  }

  function setCounts(){
    // Reset all tile counts to 0, then sum from STATE
    const counts = {};
    TILES.forEach(([id, key]) => counts[key] = 0);
    Object.values(STATE.badges).forEach(b => {
      counts[b.loc] = (counts[b.loc] || 0) + 1;
    });
    TILES.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(counts[key] || 0);
    });
    unassignedCountEl.textContent = String(counts['unassigned'] || 0);
    // Update Process Paths counts if present
    try{
      document.getElementById('proc-count-cb').textContent = String(counts['cb'] || 0);
      // process-sort maps to 'e2s' (Each to Sort)
      document.getElementById('proc-count-sort').textContent = String(counts['e2s'] || 0);
      // process-dock maps to 'dockws'
      document.getElementById('proc-count-dock').textContent = String(counts['dockws'] || 0);
    }catch(_){/* ignore missing elements */}
  }

  // Make any card a drop target for badges
  function makeDropTarget(card, key){
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('ring','ring-indigo-300');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('ring','ring-indigo-300');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('ring','ring-indigo-300');
      const badgeId = e.dataTransfer.getData('text/plain');
      if (!badgeId || !STATE.badges[badgeId]) return;
      STATE.badges[badgeId].loc = key || 'unassigned';
      // Move DOM node into correct layer
      const node = document.getElementById(badgeId);
      if (node){
        if ((key || 'unassigned') === 'unassigned'){
          unassignedStack.appendChild(node);
        }else{
          // Prefer the drop-target's own overlay layer when available
          const targetLayer = (e.currentTarget && e.currentTarget.querySelector && e.currentTarget.querySelector('.pointer-events-none')) || null;
          if (targetLayer) targetLayer.appendChild(node);
          else {
            // fallback: append to the primary layer for the key (support array or single element)
            const layers = tileBadgeLayers[key];
            if (Array.isArray(layers)) layers[0].appendChild(node);
            else if (layers instanceof HTMLElement) layers.appendChild(node);
          }
        }
        restack(node.parentElement); // re-apply overlap
      }
      setCounts();
    });
  }

  // Apply solitaire-style overlap for children of a container (vertical if column, else small horizontal)
  function restack(container){
    if (!container) return;
    const children = Array.from(container.children);
    children.forEach((c, i) => {
      // tight vertical stack in left panel; subtle horizontal in tiles
      const isLeft = container.id === 'unassignedStack';
      if (isLeft){
        c.style.marginTop = i === 0 ? '0px' : '-14px';
        c.style.marginLeft = '0px';
        c.style.display = 'block';
      }else{
        c.style.marginTop = '0px';
        c.style.marginLeft = i === 0 ? '0px' : '-10px';
        c.style.display = 'inline-block';
      }
      c.style.pointerEvents = 'auto';
    });
  }

  // Build a single badge DOM node
  function createBadge(b){
    const div = document.createElement('div');
    div.id = b.id;
    div.className = `badge ${b.scode}`;
    div.draggable = true;
    div.title = `${b.name} • ${b.eid} • ${b.scode}`;
    div.textContent = b.name;
    div.style.userSelect = 'none';

    // drag handlers
    div.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', b.id);
      // ghost image smaller
      try{
        const crt = div.cloneNode(true);
        crt.style.opacity = '0.8';
        crt.style.transform = 'scale(.9)';
        document.body.appendChild(crt);
        e.dataTransfer.setDragImage(crt, 10, 10);
        setTimeout(() => document.body.removeChild(crt), 0);
      }catch(_){}
    });

    // presence tick on click
    div.addEventListener('click', () => {
      b.present = !b.present;
      if (b.present){
        div.classList.add('present');
        if (!div.querySelector('.tick')){
          const t = document.createElement('div');
          t.className = 'tick';
          t.textContent = '✓';
          div.appendChild(t);
        }
      }else{
        div.classList.remove('present');
        const t = div.querySelector('.tick'); if (t) t.remove();
      }
      updateActualHC();
    });

    return div;
  }

  function renderAllBadges(){
    // Clear all layers
    unassignedStack.innerHTML = '';
    Object.values(tileBadgeLayers).forEach(layer => layer.innerHTML = '');

    Object.values(STATE.badges).forEach(b => {
      const node = createBadge(b);
      if (b.present){
        node.classList.add('present');
        const t = document.createElement('div');
        t.className = 'tick'; t.textContent = '✓';
        node.appendChild(t);
      }
      if (b.loc === 'unassigned'){
        unassignedStack.appendChild(node);
      }else{
        const layers = tileBadgeLayers[b.loc];
        if (Array.isArray(layers)) layers[0].appendChild(node);
        else if (layers instanceof HTMLElement) layers.appendChild(node);
        // if no layer exists for this key, badge will not be attached to any tile (keep in STATE)
      }
    });

    // Restack containers
    restack(unassignedStack);
    Object.values(tileBadgeLayers).forEach(restack);

    setCounts();
    updateActualHC();
  }

  // ===== Live shift-type preview on control changes =====
  form.addEventListener('change', () => {
    const date = form.date.value;
    const shift = form.querySelector('input[name="shift"]:checked')?.value || 'day';
    const d = parseInputDate(date);
    if (!d){ elType.textContent = '-'; return; }
    elType.textContent = shiftTypeMap[shift][d.getDay()];
  });

  // ===== Submit → process files and render =====
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    output.textContent = 'Processing files…';

    const rosterFile = form.roster.files[0];
    if (!rosterFile){ output.textContent = 'Roster file required.'; return; }

    const swapFile = form.swap.files[0] || null;
    const vetFile  = form.vetvto.files[0] || null;
    const lsFile   = form.laborshare.files[0] || null;

    Promise.all([
      parseCsv(rosterFile),
      swapFile ? parseCsv(swapFile) : Promise.resolve([]),
      vetFile  ? parseCsv(vetFile)  : Promise.resolve([]),
      lsFile   ? parseCsv(lsFile)   : Promise.resolve([]),
    ]).then(([roster, swaps, vetvto, labshare]) => {
      // Inputs
      const siteSel  = form.site.value;
      const dateStr  = form.date.value;
      const shiftSel = form.querySelector('input[name="shift"]:checked')?.value || 'day';
      const d = parseInputDate(dateStr);
      const dow = d?.getDay() ?? 0;

      // Summary header
      elDate.textContent   = dateStr || '-';
      elDay.textContent    = d ? shortDay[dow] : '-';
      elShift.textContent  = shiftSel[0].toUpperCase() + shiftSel.slice(1);
      elType.textContent   = shiftTypeMap[shiftSel][dow];
      elSite.textContent   = siteSel;

      // Codes bar
      const allowed = new Set(getAllowedCodes(dateStr, shiftSel));
      if (allowed.size){
        codesBar.classList.remove('hidden');
        codesBar.textContent = `Codes active for ${dayNames[dow]} (${elShift.textContent}): ${[...allowed].sort().join(', ')}`;
      }else{
        codesBar.classList.add('hidden'); codesBar.textContent = '';
      }

      // Filter roster per site + shift codes + Active
      const activeRows = roster.filter(r => String(r['Employee Status'] ?? r.Status ?? '').toLowerCase() === 'active');

      const filtered = activeRows.filter(r => {
        const site = classifySite(r);
        if (siteSel === 'YHM2' && site !== 'YHM2') return false;
        if (siteSel === 'YDD2' && site !== 'YDD2') return false;

        const sc = shiftCodeOf(r['Shift Pattern'] ?? r['ShiftCode'] ?? r['Shift Code'] ?? r['Shift'] ?? r['Pattern']);
        if (!allowed.has(sc)) return false;
        if (shiftSel === 'day'   && !DAY_SET.has(sc))   return false;
        if (shiftSel === 'night' && !NIGHT_SET.has(sc)) return false;
        return true;
      });

      // Optional adjustments
      const swapIN  = swaps.filter(x => (x.Direction ?? x.direction ?? '').toString().toUpperCase() === 'IN').length;
      const swapOUT = swaps.filter(x => (x.Direction ?? x.direction ?? '').toString().toUpperCase() === 'OUT').length;

      const vet = vetvto.filter(x => {
        const t = (x.Type ?? x.type ?? '').toString().toUpperCase();
        const acc = (x.Accepted ?? x.Status ?? '').toString().toUpperCase();
        return t === 'VET' && (!acc || acc === 'YES' || acc === 'ACCEPTED');
      }).length;

      const vto = vetvto.filter(x => {
        const t = (x.Type ?? x.type ?? '').toString().toUpperCase();
        const acc = (x.Accepted ?? x.Status ?? '').toString().toUpperCase();
        return t === 'VTO' && (!acc || acc === 'YES' || acc === 'ACCEPTED');
      }).length;

      const lsIN  = labshare.filter(x => (x.Direction ?? x.direction ?? '').toString().toUpperCase() === 'IN').length;
      const lsOUT = labshare.filter(x => (x.Direction ?? x.direction ?? '').toString().toUpperCase() === 'OUT').length;

      const baseHC   = filtered.length;
      const plannedHC = baseHC - swapOUT + swapIN + vet - vto + lsIN - lsOUT;

      elPlan.textContent = String(plannedHC);
      elActual.textContent = '0';

      // Build badge state
      STATE.badges = {};
      filtered.forEach((r, idx) => {
        const name = (r['Employee Name'] ?? r['Name'] ?? '').toString();
        const eid  = (r['Employee ID']   ?? r['ID']   ?? '').toString();
        const sc   = shiftCodeOf(r['Shift Pattern'] ?? r['ShiftCode'] ?? r['Shift Code'] ?? r['Shift'] ?? r['Pattern']);
        const id   = `b_${eid || idx}_${Math.random().toString(36).slice(2,8)}`;
        STATE.badges[id] = { id, name, eid, scode: sc, site: siteSel, present:false, loc:'unassigned' };
      });

      // Render badges into left panel stack; clear any tile layers
      renderAllBadges();

      // Inline VPH helper
      setupVPH(plannedHC);

      output.textContent = '';
    }).catch(err => {
      console.error(err);
      output.textContent = 'Error processing files. Please check CSV headers and try again.';
    });
  });

  function setupVPH(hc){
    const volInput = document.getElementById('plannedVolumeStub');
    const id = 'vph-inline';
    let node = document.getElementById(id);
    if (!node){
      node = document.createElement('div');
      node.id = id;
      node.className = 'text-sm text-gray-600 mt-1';
      document.getElementById('output').appendChild(node);
    }
    const update = () => {
      const planned = Number(volInput.value || 0);
      node.textContent = `Volume per Head: ${hc > 0 ? (planned / hc).toFixed(2) : '0'}`;
    };
    volInput.removeEventListener('input', update);
    volInput.addEventListener('input', update);
    update();
  }

  // Export summary JSON
  document.getElementById('exportLogBtn')?.addEventListener('click', () => {
    const payload = {
      date: elDate.textContent, day: elDay.textContent, shift: elShift.textContent,
      site: elSite.textContent, shiftType: elType.textContent,
      plannedHC: elPlan.textContent, actualHC: elActual.textContent,
      ts: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vlab-shift-summary-${payload.date || 'NA'}.json`;
    a.click();
  });
});
