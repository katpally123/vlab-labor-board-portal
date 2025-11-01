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
    // Codes active per calendar day (union of day & night codes for that weekday)
    'Sunday':    ['DA','DL','DN','DH','NA','NL','NN'],
    'Monday':    ['DA','DC','DL','DH','NA','NC','NL','NH'],
    'Tuesday':   ['DA','DC','DL','NA','NC','NL'],
    'Wednesday': ['DA','DB','NA','NB'],
    'Thursday':  ['DB','DC','DN','NB','NC','NN','NH'],
    'Friday':    ['DB','DC','DN','DH','NB','NC','NN','NH'],
    'Saturday':  ['DB','DL','DN','DH','NB','NL','NN','NH']
  };

  const shiftTypeMap = {
    day:   {0:'FHD',1:'FHD',2:'FHD',3:'FHD',4:'BHD',5:'BHD',6:'BHD'},
    night: {0:'FHN',1:'FHN',2:'FHN',3:'FHN',4:'BHN',5:'BHN',6:'BHN'}
  };

  // Tiles order matches DOM `board-card` order: process tiles only (WS tiles removed)
  const TILES = [
    // Process tiles
    ['tile-unassigned','unassigned'], ['tile-cb','cb'], ['tile-ibws','ibws'], ['tile-lineloaders','lineloaders'], ['tile-trickle','trickle'],
    ['tile-dm','dm'], ['tile-idrt','idrt'], ['tile-pb','pb'], ['tile-e2s','e2s'], ['tile-dockws','dockws'],
    ['tile-e2sws','e2sws'], ['tile-tpb','tpb'], ['tile-tws','tws'], ['tile-sap','sap'], ['tile-ao5s','ao5s']
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



  // wire up count inputs for each tile (allow numeric input to assign random badges)
  function assignRandomToTile(key, n){
    // Update STATE only: pick `n` random unassigned badges and set their loc to the tile key.
    const unassigned = Object.values(STATE.badges).filter(b => b.loc === 'unassigned');
    if (unassigned.length === 0) return 0;
    const take = Math.min(n, unassigned.length);
    for (let i = 0; i < take; i++){
      const idx = Math.floor(Math.random() * unassigned.length);
      const b = unassigned.splice(idx,1)[0];
      b.loc = key;
    }
    // After mutating STATE, re-render the board to avoid DOM duplication and keep layering consistent.
    try{ renderAllBadges(); }catch(_){ }
    try{ setCounts(); }catch(_){ }
    return take;
  }

  function unassignFromTile(key, n){
    // Update STATE only: move up to `n` badges from the tile back to unassigned.
    const inTile = Object.values(STATE.badges).filter(b => b.loc === key);
    const take = Math.min(n, inTile.length);
    for (let i = 0; i < take; i++){
      // remove from the end of the list (recently-rendered) — deterministic and simple
      const b = inTile[inTile.length - 1 - i];
      if (!b) break;
      b.loc = 'unassigned';
    }
    try{ renderAllBadges(); }catch(_){ }
    try{ setCounts(); }catch(_){ }
    return take;
  }

  // attach listeners to inputs
  TILES.forEach(([id,key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    // if it's an input
    if (el.tagName === 'INPUT'){
      // set initial properties
      if (key === 'unassigned') el.readOnly = true;
      el.addEventListener('change', (ev) => {
        const desired = Number(el.value) || 0;
        const countsNow = Object.values(STATE.badges).filter(b => b.loc === key).length;
        if (desired > countsNow){
          const toAdd = desired - countsNow;
          const added = assignRandomToTile(key, toAdd);
          if (added < toAdd) alert(`Only ${added} could be assigned (not enough unassigned).`);
        } else if (desired < countsNow){
          const toRemove = countsNow - desired;
          unassignFromTile(key, toRemove);
        }
        setCounts();
      });
    }
  });

  // unassigned stack should accept drops too
  if (unassignedStack) makeDropTarget(unassignedStack, 'unassigned');

  // Unassigned dropdown overlay handling
  const toggleUnassignedBtn = document.getElementById('toggleUnassignedBtn');
  const leftPanelEl = document.getElementById('leftPanel');
  let overlayEl = null;
  let _savedBodyOverflow = null;
  let _savedLeftPanelOverflow = null;
  let _overlayRepositionHandler = null;

  function openUnassignedOverlay(){
    if (overlayEl) return;
    // create overlay
    overlayEl = document.createElement('div'); overlayEl.className = 'unassigned-overlay'; overlayEl.id = 'unassignedOverlay';
    const hdr = document.createElement('div'); hdr.style.display='flex'; hdr.style.justifyContent='space-between'; hdr.style.alignItems='center'; hdr.style.marginBottom='6px';
    const title = document.createElement('strong'); title.textContent = 'Unassigned'; hdr.appendChild(title);
    const closeBtn = document.createElement('button'); closeBtn.className = 'text-sm text-gray-600 border rounded p-1'; closeBtn.textContent='✕'; closeBtn.addEventListener('click', closeUnassignedOverlay);
    hdr.appendChild(closeBtn);
    overlayEl.appendChild(hdr);

  // append overlay to body first so measurements work, then position it relative to leftPanel
  document.body.appendChild(overlayEl);
  // prevent page scroll and leftPanel scroll while overlay is open to avoid duplicate scrollbars
  try{ _savedBodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }catch(_){}
  try{ _savedLeftPanelOverflow = leftPanelEl.style.overflow; leftPanelEl.style.overflow = 'hidden'; }catch(_){}
    // position overlay to align with leftPanel
    function repositionOverlay(){
      if (!overlayEl) return;
      const rect = leftPanelEl.getBoundingClientRect();
      // place overlay aligned to leftPanel, but slightly inset
      overlayEl.style.position = 'fixed';
      overlayEl.style.left = (rect.left + window.scrollX) + 'px';
      overlayEl.style.top = (rect.top + window.scrollY) + 'px';
      overlayEl.style.width = Math.max(280, rect.width) + 'px';
      overlayEl.style.maxHeight = Math.max(200, window.innerHeight - (rect.top + 40)) + 'px';
    }
    repositionOverlay();
    // move stack into overlay after positioning to avoid layout shifts
    overlayEl.appendChild(unassignedStack);
    leftPanelEl && leftPanelEl.classList.add('collapsed');
    toggleUnassignedBtn && toggleUnassignedBtn.setAttribute('aria-expanded','true');
    // close when clicking outside
    setTimeout(()=>{ document.addEventListener('click', outsideClickHandler); }, 10);
    // re-render so the overlay shows the full unassigned list
    try{ renderAllBadges(); }catch(_){ }
    // keep overlay positioned on resize/scroll
    _overlayRepositionHandler = () => repositionOverlay();
    window.addEventListener('resize', _overlayRepositionHandler);
    window.addEventListener('scroll', _overlayRepositionHandler, true);
  }

  function closeUnassignedOverlay(){
    if (!overlayEl) return;
    // move stack back into leftPanel
    leftPanelEl.appendChild(unassignedStack);
    if (overlayEl.parentElement) overlayEl.parentElement.removeChild(overlayEl);
    overlayEl = null;
    leftPanelEl && leftPanelEl.classList.remove('collapsed');
    toggleUnassignedBtn && toggleUnassignedBtn.setAttribute('aria-expanded','false');
    document.removeEventListener('click', outsideClickHandler);
    // re-render so left panel shows compact preview again
    try{ renderAllBadges(); }catch(_){ }
    // restore scrolling/state
    try{ if (_savedBodyOverflow !== null) document.body.style.overflow = _savedBodyOverflow; }catch(_){ }
    try{ if (_savedLeftPanelOverflow !== null) leftPanelEl.style.overflow = _savedLeftPanelOverflow; }catch(_){ }
    // remove reposition handlers
    try{ if (_overlayRepositionHandler) { window.removeEventListener('resize', _overlayRepositionHandler); window.removeEventListener('scroll', _overlayRepositionHandler, true); _overlayRepositionHandler = null; } }catch(_){ }
  }

  function outsideClickHandler(e){
    if (!overlayEl) return;
    if (overlayEl.contains(e.target) || toggleUnassignedBtn.contains(e.target)) return;
    closeUnassignedOverlay();
  }

  toggleUnassignedBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (overlayEl) closeUnassignedOverlay(); else openUnassignedOverlay();
  });
  // ESC closes overlay
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlayEl) closeUnassignedOverlay(); });

  // In-memory badge store
  const STATE = { badges: {} };

  // --- helpers ---
  function parseInputDate(dateStr){
    if (!dateStr) return null;
    // accept dd/mm/yyyy
    if (dateStr.includes('/')){
      const parts = dateStr.split('/').map(Number);
      if (parts.length === 3){
        const [d,m,y] = parts;
        return new Date(y, m-1, d);
      }
    }
    // accept ISO yyyy-mm-dd (from <input type=date>) without timezone shift
    // avoid using new Date(string) which can be parsed as UTC and shift day in some timezones
    const isoMatch = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(dateStr);
    if (isoMatch){
      const y = Number(isoMatch[1]);
      const m = Number(isoMatch[2]);
      const d = Number(isoMatch[3]);
      return new Date(y, m-1, d);
    }
    // fallback
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
      if (el){
        if (el.tagName === 'INPUT') el.value = String(counts[key] || 0);
        else el.textContent = String(counts[key] || 0);
      }
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
      let badgeId = node && node.id;
      // if no DOM badge exists yet, try to find the badge in STATE by eid and create a badge node
      if (!node){
        const found = Object.values(STATE.badges).find(b => String(b.eid) === String(payload));
        if (found){
          node = renderBadge(found);
          badgeId = found.id;
          // append into container (will be moved again below)
          document.body.appendChild(node);
        }
      }
      if (!node) return; // unknown drag payload
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
      if (isLeft){
        // stacked overlapping list on the left panel
        c.style.marginTop = i === 0 ? '0px' : '-18px';
        c.style.display = 'block';
        c.style.marginLeft = '0px';
      } else {
        // in tiles, use grid layout; clear any previous overlap/inline styles
        c.style.marginTop = '0px';
        c.style.marginLeft = '0px';
        c.style.display = 'block';
      }
      c.style.pointerEvents = 'auto';
    });
  }

  // renderBadge: returns a DOM node for a person (name-only, data-id, data-shift, draggable)
  function renderBadge(p){
    // Card-style badge: compact layout
    const wrap = document.createElement('div');
    wrap.id = p.id;
    wrap.className = `badge ${(p.scode||'').trim()}`.trim();
    wrap.setAttribute('draggable','true');
    if (p.eid) wrap.setAttribute('data-id', String(p.eid));
    if (p.scode) wrap.setAttribute('data-shift', String(p.scode));
    wrap.title = p.name || '';
    // accessibility: make badges focusable/clickable via keyboard
    wrap.setAttribute('role','button');
    wrap.setAttribute('tabindex','0');
    wrap.setAttribute('aria-pressed', p.present ? 'true' : 'false');

    // left avatar placeholder
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    // show photo thumbnail when available, otherwise initials
    if (p.photo){
      const img = document.createElement('img');
      img.src = p.photo;
      img.alt = p.name || '';
      img.className = 'avatar-photo';
      // loading & decoding hints for better UX
      img.loading = 'lazy';
      img.decoding = 'async';
      avatar.appendChild(img);
    } else {
      avatar.textContent = (p.name || '').split(' ').map(s => s[0] || '').slice(0,2).join('').toUpperCase();
    }
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

    // alias / handle (smaller, optional)
    if (p.handle){ const h = document.createElement('div'); h.className = 'alias'; h.textContent = p.handle; info.appendChild(h); }

    // barcode / handle area (ID card style)
    if (p.barcode){
      const bcWrap = document.createElement('div'); bcWrap.className = 'barcodeWrap';
      const bcImg = document.createElement('div'); bcImg.className = 'barcode';
      // show barcode text as fallback inside mock bars; real barcode images can replace this later
      bcImg.textContent = p.barcode;
      const bcText = document.createElement('div'); bcText.className = 'barcodeText'; bcText.textContent = p.handle || '';
      bcWrap.appendChild(bcImg); bcWrap.appendChild(bcText);
      info.appendChild(bcWrap);
    }

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

    // toggle presence on click (and update aria state)
    function togglePresent(){
      p.present = !p.present;
      if (p.present){ wrap.classList.add('present'); tick.style.display = ''; }
      else { wrap.classList.remove('present'); tick.style.display = 'none'; }
      wrap.setAttribute('aria-pressed', p.present ? 'true' : 'false');
      updateActualHC();
    }

    wrap.addEventListener('click', (ev) => {
      // avoid toggling when starting a drag
      if (ev?.detail === 0) return;
      togglePresent();
    });

    // keyboard accessibility: Enter or Space toggles presence
    wrap.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar'){
        ev.preventDefault(); togglePresent();
      }
    });

    return wrap;
  }

  function renderAllBadges(){
    // clear
    if (unassignedStack) unassignedStack.innerHTML = '';
    Object.values(tileBadgeLayers).forEach(layer => { if (layer) layer.innerHTML = ''; });

    // Render unassigned as a compact list in the left panel (preview), and full list in overlay when open.
    const overlayOpen = !!document.getElementById('unassignedOverlay');
    const unassigned = Object.values(STATE.badges).filter(b => b.loc === 'unassigned');
    const previewCount = overlayOpen ? Infinity : 6;
    let rendered = 0;

    Object.values(STATE.badges).forEach(b => {
      if (b.loc === 'unassigned'){
        if (rendered < previewCount){
          const item = document.createElement('div');
          item.className = 'unassigned-item';
          item.setAttribute('draggable','true');
          item.setAttribute('data-eid', String(b.eid));
          item.textContent = b.name || b.eid || '';
          item.addEventListener('dragstart', (e) => { try{ e.dataTransfer.setData('text/plain', String(b.eid || b.id)); }catch(_){ e.dataTransfer.setData('text/plain', String(b.eid || b.id)); } });
          unassignedStack.appendChild(item);
          rendered++;
        }
        // otherwise skip rendering in preview mode; overlay will render full list when open
      } else {
        const node = renderBadge(b);
        if (b.present){ node.classList.add('present'); const t = document.createElement('div'); t.className='tick'; t.textContent='✓'; node.appendChild(t); }
        tileBadgeLayers[b.loc]?.appendChild(node);
      }
    });

    // If there are more unassigned than previewCount and overlay is closed, show a "Show all" control
    if (!overlayOpen && unassigned.length > previewCount){
      const more = document.createElement('button'); more.className = 'more-link'; more.textContent = `Show all (${unassigned.length})`;
      more.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (typeof openUnassignedOverlay === 'function') openUnassignedOverlay(); else toggleUnassignedBtn && toggleUnassignedBtn.click(); });
      unassignedStack.appendChild(more);
    }
    restack(unassignedStack);
    Object.values(tileBadgeLayers).forEach(restack);
    // tiles use CSS grid by default; ensure any legacy grid-mode class is removed
    try{ Object.values(tileBadgeLayers).forEach(layer => layer && layer.classList.remove('grid-mode')); }catch(_){ }
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
        const name = String(r['Employee Name'] ?? r['Name'] ?? r['Full Name'] ?? '').trim();
        const eid  = String(r['Employee ID'] ?? r['ID'] ?? r['EID'] ?? r['Employee Number'] ?? '').trim();
        const sc   = shiftCodeOf(r['Shift Pattern'] ?? r['ShiftCode'] ?? r['Shift Code'] ?? r['Shift'] ?? r['Pattern']);
        const barcode = String(r['Barcode'] ?? r['Badge'] ?? r['Employee Login'] ?? r['Username'] ?? '').trim();
        const handle = String(r['Handle'] ?? r['Employee Handle'] ?? r['Login'] ?? '').trim();
        const photo = String(r['Photo'] ?? r['Photo URL'] ?? r['Image'] ?? '').trim();
        const id   = `b_${eid || idx}_${Math.random().toString(36).slice(2,8)}`;
        STATE.badges[id] = { id, name, eid, scode: sc, site: siteSel, present:false, loc:'unassigned', barcode, handle, photo };
      });

      if (Object.keys(STATE.badges).length === 0){
        output.textContent = 'No badges created — check CSV headers and active status field.';
        console.warn('[build] no badges in STATE.badges');
      }
      renderAllBadges();
      setupVPH(plannedHC);
      output.textContent = '';

      // persist compact snapshot so user can reload without re-uploading CSV
      try{
        const snap = { badges: STATE.badges, meta: { date: dateStr, shift: shiftSel, site: siteSel, plannedHC } };
        localStorage.setItem('vlab:lastRoster', JSON.stringify(snap));
        console.debug('[save] saved roster snapshot to localStorage (vlab:lastRoster)');
      }catch(_){ /* ignore storage failures */ }
    }).catch(err => { console.error(err); output.textContent = 'Error processing files. Please check CSV headers and try again.'; });
  });

  // Load last roster from localStorage without uploading CSV
  const loadLastBtn = document.getElementById('loadLastBtn');
  const clearSavedBtn = document.getElementById('clearSavedBtn');
  loadLastBtn?.addEventListener('click', () => {
    try{
      const raw = localStorage.getItem('vlab:lastRoster');
      if (!raw){ alert('No saved roster found. Build a board once to save the roster.'); return; }
      const snap = JSON.parse(raw);
      if (!snap || !snap.badges){ alert('Saved roster is invalid.'); return; }
      STATE.badges = snap.badges;
      // apply meta back to form/UI if available
      if (snap.meta){
        if (snap.meta.date) document.getElementById('date').value = snap.meta.date;
        if (snap.meta.shift) { const r = document.querySelector(`input[name="shift"][value="${snap.meta.shift}"]`); if (r) r.checked = true; }
        if (snap.meta.site) document.getElementById('site').value = snap.meta.site;
        if (snap.meta.plannedHC) document.getElementById('plannedVolumeStub').value = snap.meta.plannedHC;
      }
      renderAllBadges();
      setupVPH(Number((snap.meta && snap.meta.plannedHC) || 0));
      output.textContent = '';
    }catch(err){ console.error(err); alert('Failed to load saved roster. See console for details.'); }
  });

  clearSavedBtn?.addEventListener('click', () => {
    if (!confirm('Clear saved roster from local storage?')) return;
    localStorage.removeItem('vlab:lastRoster');
    alert('Saved roster cleared.');
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

  // Publish / Unpublish flow: show assignments-only fullscreen view
  const publishBtn = document.getElementById('publishBtn');
  const exitPublishBtn = document.getElementById('exitPublishBtn');
  function enterPublish(){
    // If an unassigned overlay is open, close it and ensure the unassigned stack lives in the left panel
    try{ if (typeof closeUnassignedOverlay === 'function') closeUnassignedOverlay(); }catch(_){ }
    try{ const lp = document.getElementById('leftPanel'); if (lp && unassignedStack && unassignedStack.parentElement !== lp) lp.appendChild(unassignedStack); }catch(_){ }
    document.body.classList.add('published');
    if (publishBtn) publishBtn.classList.add('hidden');
    if (exitPublishBtn) exitPublishBtn.classList.remove('hidden');
    // focus the exit button for accessibility
    exitPublishBtn && exitPublishBtn.focus();
  }
  function exitPublish(){
    document.body.classList.remove('published');
    if (publishBtn) publishBtn.classList.remove('hidden');
    if (exitPublishBtn) exitPublishBtn.classList.add('hidden');
    publishBtn && publishBtn.focus();
  }
  publishBtn?.addEventListener('click', (ev) => {
    // quick confirmation to avoid accidental publish
    if (!confirm('Publish assignments: this will hide controls and show a fullscreen assignments-only view. Proceed?')) return;
    enterPublish();
  });
  exitPublishBtn?.addEventListener('click', (ev) => { exitPublish(); });

  // ESC key exits publish mode
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('published')) exitPublish(); });

});
