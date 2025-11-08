// app.js — simplified, restored, and self-contained for the VLAB labor board.
// Provides: CSV parsing (PapaParse), STATE.badges, left unassigned stack, tile layers,
// drag & drop, presence tick, and a form submit that does not navigate away.

document.addEventListener('DOMContentLoaded', () => {
  console.log('[DEBUG] DOM Content Loaded - Initializing VLAB');
  
  const form = document.getElementById('laborForm');
  const output = document.getElementById('output');
  
  // Check if required elements exist
  if (!form) {
    console.error('[DEBUG] Form element not found!');
    return;
  }
  if (!output) {
    console.error('[DEBUG] Output element not found!');
    return;
  }
  
  console.log('[DEBUG] Form and output elements found successfully');
  console.log('[DEBUG] Form has roster input:', !!form.roster);
  console.log('[DEBUG] Form has missing input:', !!form.missing);
  
  console.log('[DEBUG] Core elements found, continuing initialization...');

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
  const quarterSelect = document.getElementById('quarter');

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

  // Tiles order matches DOM `board-card` order: process tiles only (no Unassigned tile here)
  const TILES = [
    // Process tiles
    ['tile-cb','cb'], ['tile-ibws','ibws'], ['tile-lineloaders','lineloaders'], ['tile-trickle','trickle'],
    ['tile-dm','dm'], ['tile-idrt','idrt'], ['tile-pb','pb'], ['tile-e2s','e2s'], ['tile-dockws','dockws'],
    ['tile-e2sws','e2sws'], ['tile-tpb','tpb'], ['tile-tws','tws'], ['tile-sap','sap'], ['tile-ao5s','ao5s'],
    ['tile-pa','pa'], ['tile-ps','ps'], ['tile-laborshare','laborshare']
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

    // Add an expand button to each tile header to open a pop-out view
    try {
      const pair2 = TILES[idx];
      const tileKey = pair2 ? pair2[1] : null;
      const hdr = card.querySelector('.tile-header');
      if (hdr && tileKey) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Expand tile';
        btn.textContent = '⤢';
        btn.style.marginLeft = '8px';
        btn.style.border = '1px solid #374151';
        btn.style.borderRadius = '6px';
        btn.style.padding = '2px 6px';
        btn.style.background = '#ffffff';
        btn.style.color = '#1f2937';
        btn.style.fontSize = '12px';
        btn.addEventListener('click', () => {
          const titleEl = hdr.querySelector('.font-semibold');
          const title = titleEl ? titleEl.textContent : tileKey.toUpperCase();
          openTileOverlay(tileKey, title);
        });
        hdr.appendChild(btn);
      }
    } catch (_){ }
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
    try{ if (typeof snapshotCurrentQuarter === 'function') snapshotCurrentQuarter(); }catch(_){ }
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
    try{ if (typeof snapshotCurrentQuarter === 'function') snapshotCurrentQuarter(); }catch(_){ }
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
        // If quarter locked, confirm override
        let doOverride = false;
        if (STATE.quarterLocks && STATE.quarterLocks[STATE.currentQuarter]){
          const ok = confirm(`Quarter ${STATE.currentQuarter} is locked. Override previous assignments with this change?`);
          if (!ok){
            const countsNowLocked = Object.values(STATE.badges).filter(b => b.loc === key).length;
            el.value = String(countsNowLocked);
            return;
          }
          doOverride = true;
        }
        // Track before-state for override logging
        const beforeInTile = new Set(Object.values(STATE.badges).filter(b => b.loc === key).map(b => b.id));
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
        // Snapshot the quarter after changes
        try{ if (typeof snapshotCurrentQuarter === 'function') snapshotCurrentQuarter(); }catch(_){ }
        // Log overrides for moved badges when applicable
        if (doOverride){
          const afterInTile = new Set(Object.values(STATE.badges).filter(b => b.loc === key).map(b => b.id));
          // Added to tile: ids in after not in before
          Object.values(STATE.badges).forEach(b => {
            if (afterInTile.has(b.id) && !beforeInTile.has(b.id)){
              addOverrideLog(b.id, 'unassigned', key);
            }
            if (beforeInTile.has(b.id) && !afterInTile.has(b.id)){
              addOverrideLog(b.id, key, 'unassigned');
            }
          });
        }
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

    // Add search bar for unassigned list
    const searchWrap = document.createElement('div');
    searchWrap.style.margin = '6px 0 8px 0';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.id = 'unassignedSearch';
    searchInput.placeholder = 'Search unassigned by name or ID...';
    searchInput.setAttribute('aria-label','Search unassigned');
    searchInput.style.width = '100%';
    searchInput.style.border = '1px solid #d1d5db';
    searchInput.style.borderRadius = '8px';
    searchInput.style.padding = '8px 10px';
    searchInput.style.fontSize = '13px';
    searchWrap.appendChild(searchInput);
    overlayEl.appendChild(searchWrap);

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
    // Hook up search filtering
    try{
      const searchInput = overlayEl.querySelector('#unassignedSearch');
      if (searchInput){
        const filter = () => {
          const q = (searchInput.value || '').toLowerCase();
          const items = Array.from(unassignedStack.querySelectorAll('.unassigned-item'));
          items.forEach(el => {
            const text = (el.textContent || '').toLowerCase();
            const eid = (el.getAttribute('data-eid') || '').toLowerCase();
            el.style.display = (!q || text.includes(q) || eid.includes(q)) ? '' : 'none';
          });
        };
        searchInput.addEventListener('input', filter);
        // initial no-op filter
        filter();
      }
    }catch(_){ }
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

  // --- Tile pop-out overlay ---
  let tileOverlayEl = null;
  function openTileOverlay(tileKey, title){
    if (tileOverlayEl) closeTileOverlay();
    tileOverlayEl = document.createElement('div');
    tileOverlayEl.id = 'tileOverlay_'+tileKey;
    tileOverlayEl.style.position = 'fixed';
    tileOverlayEl.style.top = '50%';
    tileOverlayEl.style.left = '50%';
    tileOverlayEl.style.transform = 'translate(-50%, -50%)';
    tileOverlayEl.style.width = '720px';
    tileOverlayEl.style.maxWidth = '95vw';
    tileOverlayEl.style.maxHeight = '80vh';
    tileOverlayEl.style.background = '#fff';
    tileOverlayEl.style.border = '2px solid #374151';
    tileOverlayEl.style.borderRadius = '12px';
    tileOverlayEl.style.boxShadow = '0 20px 40px rgba(0,0,0,0.25)';
    tileOverlayEl.style.zIndex = '1100';
    tileOverlayEl.style.display = 'flex';
    tileOverlayEl.style.flexDirection = 'column';

    // header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.background = '#1f2937';
    header.style.color = '#fff';
    header.style.padding = '12px 16px';
    header.style.borderTopLeftRadius = '10px';
    header.style.borderTopRightRadius = '10px';
    const hTitle = document.createElement('div'); hTitle.textContent = title || tileKey.toUpperCase(); hTitle.style.fontWeight = '800';
    const controls = document.createElement('div');
    const search = document.createElement('input');
    search.type = 'text'; search.placeholder = 'Search...';
    search.style.marginRight = '8px'; search.style.padding = '6px 8px'; search.style.borderRadius = '6px'; search.style.border = '1px solid #d1d5db';
    const closeBtn = document.createElement('button'); closeBtn.textContent = '✕'; closeBtn.title = 'Close';
    closeBtn.style.padding = '4px 8px'; closeBtn.style.borderRadius = '6px'; closeBtn.style.border = '1px solid #374151'; closeBtn.style.background = '#fff'; closeBtn.style.color = '#1f2937';
    closeBtn.addEventListener('click', closeTileOverlay);
    controls.appendChild(search); controls.appendChild(closeBtn);
    header.appendChild(hTitle); header.appendChild(controls);
    tileOverlayEl.appendChild(header);

    // content
    const content = document.createElement('div');
    content.style.padding = '12px';
    content.style.overflow = 'auto';
    content.style.flex = '1 1 auto';
    const layer = document.createElement('div');
    layer.className = 'badge-layer path-box';
    layer.style.minHeight = '300px';
    content.appendChild(layer);
    tileOverlayEl.appendChild(content);
    document.body.appendChild(tileOverlayEl);

    // Make it a drop target for the tile
    makeDropTarget(layer, tileKey);

    // Render badges currently in this tile
    try{
      Object.values(STATE.badges).forEach(b => {
        if (b.loc === tileKey){
          const node = renderBadge(b);
          if (b.present){ node.classList.add('present'); }
          layer.appendChild(node);
        }
      });
    }catch(_){ }

    // Simple search filter
    const doFilter = () => {
      const q = (search.value || '').toLowerCase();
      Array.from(layer.children).forEach(el => {
        if (!el.classList || !el.classList.contains('badge')) return;
        const text = (el.textContent || '').toLowerCase();
        const eid = (el.getAttribute('data-id') || '').toLowerCase();
        el.style.display = (!q || text.includes(q) || eid.includes(q)) ? '' : 'none';
      });
    };
    search.addEventListener('input', doFilter);
    doFilter();

    // backdrop (click outside to close)
    const backdrop = document.createElement('div');
    backdrop.style.position = 'fixed'; backdrop.style.left = '0'; backdrop.style.top = '0'; backdrop.style.right = '0'; backdrop.style.bottom = '0';
    backdrop.style.background = 'rgba(0,0,0,0.35)'; backdrop.style.zIndex = '1099';
    backdrop.addEventListener('click', closeTileOverlay);
    document.body.appendChild(backdrop);
    tileOverlayEl._backdrop = backdrop;

    // Prevent body scroll while open
    try{ document.body.style.overflow = 'hidden'; }catch(_){ }
  }

  function closeTileOverlay(){
    if (!tileOverlayEl) return;
    if (tileOverlayEl._backdrop && tileOverlayEl._backdrop.parentElement) tileOverlayEl._backdrop.parentElement.removeChild(tileOverlayEl._backdrop);
    if (tileOverlayEl.parentElement) tileOverlayEl.parentElement.removeChild(tileOverlayEl);
    tileOverlayEl = null;
    try{ document.body.style.overflow = ''; }catch(_){ }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tileOverlayEl) closeTileOverlay(); });

  // In-memory badge store with analytics tracking and multi-site support
  const STATE = { 
    badges: {},
    analytics: {
      history: [], // Assignment history log
      sessions: [], // Work sessions data
      performance: {}, // Employee performance metrics
      patterns: {} // Assignment pattern analysis
    },
    currentQuarter: 'Q1',
    quarterAssignments: { Q1: {}, Q2: {}, Q3: {} },
    quarterLocks: { Q1: false, Q2: false, Q3: false },
    // Multi-site support
    currentSite: 'YDD2', // Active site being viewed
    suppressAnalytics: false, // Flag to prevent analytics during internal operations
    sites: {
      YDD2: { 
        assignments: {},  // badgeId -> location mapping for this site
        processes: ['cb','ibws','lineloaders','trickle','dm','idrt','pb','e2s','dockws','e2sws','tpb','tws','sap','ao5s','pa','ps','laborshare']
      },
      YDD4: { 
        assignments: {},  // badgeId -> location mapping for this site
        processes: ['cb','ibws','lineloaders','trickle','dm','idrt','pb','e2s','dockws','e2sws','tpb','tws','sap','ao5s','pa','ps','laborshare']
      },
      YHM2: { 
        assignments: {},  // badgeId -> location mapping for this site
        processes: ['cb','ibws','lineloaders','trickle','dm','idrt','pb','e2s','dockws','e2sws','tpb','tws','sap','ao5s','pa','ps','laborshare']
      }
    }
  };

  // Multi-Site Management Functions
  const MULTISITE = {
    // Ensure current site is synchronized with form
    ensureCurrentSiteSync: function() {
      const formSite = document.getElementById('site')?.value;
      const headerSite = document.getElementById('headerSiteSelector')?.value;
      
      if (formSite && formSite !== STATE.currentSite) {
        console.log(`[MULTISITE] Syncing currentSite from form: ${STATE.currentSite} -> ${formSite}`);
        STATE.currentSite = formSite;
      } else if (headerSite && headerSite !== STATE.currentSite) {
        console.log(`[MULTISITE] Syncing currentSite from header: ${STATE.currentSite} -> ${headerSite}`);
        STATE.currentSite = headerSite;
      }
      
      return STATE.currentSite;
    },
    // Switch to a different site view
    switchToSite: function(siteCode) {
      if (!STATE.sites[siteCode]) {
        console.warn('[MULTISITE] Unknown site:', siteCode);
        return false;
      }
      
      // Save current site assignments before switching (for site-specific assignments)
      this.saveCurrentSiteAssignments();
      
      // Update current site
      const oldSite = STATE.currentSite;
      STATE.currentSite = siteCode;
      console.log(`[MULTISITE] Updated STATE.currentSite from ${oldSite} to ${siteCode}`);
      
      // Clear current tile displays
      this.clearAllTiles();
      
      // Apply site filtering without changing assignments - preserve ALL assignments
      Object.values(STATE.badges).forEach(badge => {
        const belongsToCurrentSite = this.badgeBelongsToSite(badge, siteCode);
        if (!belongsToCurrentSite) {
          // Badge doesn't belong to this site - hide it but preserve its assignment
          badge.hidden = true;
        } else {
          // Badge belongs to this site - show it
          badge.hidden = false;
          
          // For YDD2/YDD4: Use site-specific assignments
          // For other sites: Keep existing assignments
          if ((siteCode === 'YDD2' || siteCode === 'YDD4') && STATE.sites[siteCode].assignments[badge.id]) {
            badge.loc = STATE.sites[siteCode].assignments[badge.id];
          } else if (siteCode !== 'YDD2' && siteCode !== 'YDD4') {
            // For non-YDD sites, preserve the existing assignment
            // badge.loc stays as is
          } else if ((siteCode === 'YDD2' || siteCode === 'YDD4') && !STATE.sites[siteCode].assignments[badge.id]) {
            // YDD2/YDD4 badge with no assignment in current site - show as unassigned
            badge.loc = 'unassigned';
          }
        }
      });
      
      // Update header display
      const headerSelector = document.getElementById('headerSiteSelector');
      if (headerSelector) headerSelector.value = siteCode;
      
      // Update form site selector to match
      const formSelector = document.getElementById('site');
      if (formSelector) formSelector.value = siteCode;
      
      // Update site display
      const elSite = document.getElementById('displaySite');
      if (elSite) elSite.textContent = siteCode;
      
      // Re-render all badges (unassigned + site assignments)
      renderAllBadges();
      
      // Save complete state to ensure all assignments persist across refreshes
      try {
        const snap = {
          badges: STATE.badges,
          sites: STATE.sites,
          currentSite: STATE.currentSite,
          meta: {
            date: document.getElementById('date')?.value || '',
            shift: document.querySelector('input[name="shift"]:checked')?.value || 'day',
            site: STATE.currentSite,
            quarter: STATE.currentQuarter || 'Q1'
          }
        };
        localStorage.setItem('vlab:lastRoster', JSON.stringify(snap));
        console.log('[SITE-SWITCH] Saved complete state after site switch');
      } catch (saveError) {
        console.warn('[SITE-SWITCH] Failed to save complete state:', saveError);
      }
      
      console.log(`[MULTISITE] Switched from ${oldSite} to ${siteCode}`);
      
      // Log the site switch
      ANALYTICS.logAssignment(null, `Site Switch: ${oldSite}`, `Site Switch: ${siteCode}`);
      
      return true;
    },
    
    // Save current assignments to the current site
    saveCurrentSiteAssignments: function() {
      const currentSite = STATE.currentSite;
      if (!STATE.sites[currentSite]) return;
      
      // Clear existing assignments for this site
      STATE.sites[currentSite].assignments = {};
      
      // Save only assignments for badges that belong to current site AND are currently visible
      Object.values(STATE.badges).forEach(badge => {
        if (badge.loc !== 'unassigned' && 
            badge.loc !== 'hidden' && 
            badge.loc !== 'assigned-elsewhere' &&
            this.badgeBelongsToSite(badge, currentSite)) {
          STATE.sites[currentSite].assignments[badge.id] = badge.loc;
          
          // Special debugging for YDD4 saves
          if (currentSite === 'YDD4') {
            console.log(`[YDD4-SAVE] Saving ${badge.name} → ${badge.loc} to YDD4 assignments`);
          }
        }
      });
      
      console.log(`[MULTISITE] Saved ${Object.keys(STATE.sites[currentSite].assignments).length} assignments for ${currentSite}`);
      
      // Special debugging for YDD4 saves
      if (currentSite === 'YDD4') {
        console.log(`[YDD4-SAVE] Final YDD4 assignments:`, STATE.sites[currentSite].assignments);
      }
    },
    
    // Check if a badge belongs to the current site based on classification
    badgeBelongsToSite: function(badge, targetSite) {
      const badgeSite = badge.site; // This is the classified site from when badge was created
      
      // YHM2 is separate - only YHM2 badges show in YHM2  
      if (targetSite === 'YHM2') {
        return badgeSite === 'YHM2';
      }
      
      // YDD2 and YDD4 share the same associate pool (YDD_SHARED badges can appear in both)
      // but have separate assignments
      if (targetSite === 'YDD2' || targetSite === 'YDD4') {
        return badgeSite === 'YDD2' || badgeSite === 'YDD4' || badgeSite === 'YDD_SHARED';
      }
      
      // Exact match for other sites
      return badgeSite === targetSite;
    },
    
    // Load assignments for a specific site with proper badge filtering
    loadSiteAssignments: function(siteCode) {
      if (!STATE.sites[siteCode]) return;
      
      // Suppress analytics during internal site loading
      const oldSuppressFlag = STATE.suppressAnalytics;
      STATE.suppressAnalytics = true;
      
      const siteAssignments = STATE.sites[siteCode].assignments || {};
      
      // Filter and set badge states based on site classification
      let visibleBadges = 0;
      let hiddenBadges = 0;
      let restoredAssignments = 0;
      
      Object.values(STATE.badges).forEach(badge => {
        const belongsToCurrentSite = this.badgeBelongsToSite(badge, siteCode);
        
        if (!belongsToCurrentSite) {
          // Badge doesn't belong to this site - hide it completely
          badge.loc = 'hidden';
          hiddenBadges++;
          return;
        }
        
        visibleBadges++;
        
        // Badge belongs to this site - preserve existing assignment if it exists
        const savedAssignmentLocation = badge.loc; // This is the assignment from saved state
        const isAssignedInCurrentSite = siteAssignments[badge.id];
        const isAssignedInOtherSites = Object.keys(STATE.sites).some(otherSite => 
          otherSite !== siteCode && 
          STATE.sites[otherSite].assignments && 
          STATE.sites[otherSite].assignments[badge.id]
        );
        
        // For YDD2/YDD4 sites: use site-specific assignments only
        // For other sites: prefer saved badge location if it's a valid process assignment
        if ((siteCode === 'YDD2' || siteCode === 'YDD4') && isAssignedInCurrentSite) {
          // YDD2/YDD4: Use site-specific assignment data only
          badge.loc = siteAssignments[badge.id];
          restoredAssignments++;
        } else if ((siteCode === 'YDD2' || siteCode === 'YDD4') && !isAssignedInCurrentSite) {
          // YDD2/YDD4: No assignment for this site - show as unassigned
          badge.loc = 'unassigned';
        } else if (savedAssignmentLocation && 
            savedAssignmentLocation !== 'unassigned' && 
            savedAssignmentLocation !== 'assigned-elsewhere' && 
            savedAssignmentLocation !== 'hidden') {
          // Other sites: Keep the saved assignment
          badge.loc = savedAssignmentLocation;
          restoredAssignments++;
        } else if (isAssignedInCurrentSite) {
          // Other sites: Use site assignment data
          badge.loc = siteAssignments[badge.id];
          restoredAssignments++;
        } else if (isAssignedInOtherSites) {
          // Assigned in another site but belongs to current site - show as assigned elsewhere
          badge.loc = 'assigned-elsewhere';
        } else {
          // Not assigned anywhere - show as unassigned
          badge.loc = 'unassigned';
        }
      });
      
      // Restore previous suppress flag
      STATE.suppressAnalytics = oldSuppressFlag;
      
      console.log(`[MULTISITE] Loaded site ${siteCode}: ${visibleBadges} visible badges, ${hiddenBadges} hidden, ${restoredAssignments} assignments restored`);
    },
    
    // Clear all tile displays
    clearAllTiles: function() {
      Object.values(tileBadgeLayers).forEach(layer => {
        if (layer) layer.innerHTML = '';
      });
    },
    
    // Move badge between sites
    moveBadgeToSite: function(badgeId, targetSite, targetLocation) {
      const badge = STATE.badges[badgeId];
      if (!badge || !STATE.sites[targetSite]) return false;
      
      // Remove from current site assignments
      Object.keys(STATE.sites).forEach(siteCode => {
        delete STATE.sites[siteCode].assignments[badgeId];
      });
      
      // Add to target site
      STATE.sites[targetSite].assignments[badgeId] = targetLocation;
      
      // If target site is current site, update badge location
      if (targetSite === STATE.currentSite) {
        badge.loc = targetLocation;
      }
      
      console.log(`[MULTISITE] Moved badge ${badgeId} to ${targetSite}/${targetLocation}`);
      return true;
    },
    
    // Sync current badge locations to multi-site assignments
    syncCurrentAssignments: function() {
      console.log('[MULTISITE] Syncing current badge locations to multi-site system...');
      
      // Clear all existing assignments
      Object.keys(STATE.sites).forEach(siteCode => {
        STATE.sites[siteCode].assignments = {};
      });
      
      // Rebuild assignments from current badge locations
      Object.values(STATE.badges).forEach(badge => {
        if (badge.loc && badge.loc !== 'unassigned' && badge.loc !== 'assigned-elsewhere') {
          // Assign to current site
          const currentSite = STATE.currentSite;
          STATE.sites[currentSite].assignments[badge.id] = badge.loc;
          console.log(`[MULTISITE] Synced: ${badge.name} -> ${currentSite}/${badge.loc}`);
        }
      });
      
      console.log('[MULTISITE] Sync complete. STATE.sites:', STATE.sites);
    },
    
    // Get which site a badge is currently assigned to
    getBadgeAssignmentSite: function(badgeId) {
      for (const [siteCode, siteData] of Object.entries(STATE.sites)) {
        if (siteData.assignments && siteData.assignments[badgeId]) {
          return siteCode;
        }
      }
      return null; // Not assigned to any site
    },
    
    // Get current assignment info for a badge
    getBadgeAssignmentInfo: function(badgeId) {
      for (const [siteCode, siteData] of Object.entries(STATE.sites)) {
        if (siteData.assignments && siteData.assignments[badgeId]) {
          return {
            site: siteCode,
            location: siteData.assignments[badgeId]
          };
        }
      }
      return null; // Not assigned anywhere
    },
    
    // Save current multi-site state to localStorage
    saveToStorage: function() {
      try {
        const raw = localStorage.getItem('vlab:lastRoster');
        if (raw) {
          const snap = JSON.parse(raw);
          
          // Update multi-site data
          snap.sites = STATE.sites;
          snap.currentSite = STATE.currentSite;
          
          // Update badge states (assignments)
          snap.badges = STATE.badges;
          
          localStorage.setItem('vlab:lastRoster', JSON.stringify(snap));
          
          // Debug: Count assignments being saved
          const assignedCount = Object.values(STATE.badges).filter(b => b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere').length;
          console.debug('[MULTISITE] Saved multi-site state with', assignedCount, 'assigned badges to localStorage');
          
          // Specific YDD4 debugging
          if (STATE.sites.YDD4) {
            const ydd4AssignmentCount = Object.keys(STATE.sites.YDD4.assignments || {}).length;
            console.log('[YDD4-SAVE] Saved YDD4 assignments:', ydd4AssignmentCount);
            console.log('[YDD4-SAVE] YDD4 assignments data:', STATE.sites.YDD4.assignments);
          }
        } else {
          console.warn('[MULTISITE] No existing roster snapshot found to update');
        }
      } catch(e) {
        console.warn('[MULTISITE] Failed to save to localStorage:', e);
      }
    }
  };

  // Analytics and Data Collection System
  const ANALYTICS = {
    // Track assignment changes
    logAssignment: function(badgeId, fromLoc, toLoc, timestamp = new Date()) {
      const badge = STATE.badges[badgeId];
      if (!badge) {
        console.warn('[Analytics] No badge found for logAssignment:', badgeId);
        return;
      }
      
      // Ensure current site is synchronized
      MULTISITE.ensureCurrentSiteSync();
      
      // Get the site for this assignment - use current site for new assignments
      let assignmentSite = STATE.currentSite;
      if (toLoc === 'unassigned') {
        // If moving to unassigned, record the site they're being removed from
        assignmentSite = MULTISITE.getBadgeAssignmentSite(badgeId) || STATE.currentSite;
      }
      
      console.log(`[Analytics] Logging assignment: badge=${badgeId}, from=${fromLoc}, to=${toLoc}, site=${assignmentSite}`);
      
      // Fallback if site is still undefined
      if (!assignmentSite || assignmentSite === 'undefined') {
        assignmentSite = 'Unknown';
        console.warn('[Analytics] Site was undefined, using fallback:', assignmentSite);
      }
      
      const logEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: timestamp.toISOString(),
        date: timestamp.toDateString(),
        badgeId: badgeId,
        employeeId: badge.eid,
        employeeName: badge.name,
        shiftCode: badge.scode,
        site: assignmentSite,
  quarter: STATE.currentQuarter || 'Q1',
        fromLocation: fromLoc,
        toLocation: toLoc,
        action: fromLoc === 'unassigned' ? 'assign' : (toLoc === 'unassigned' ? 'unassign' : 'reassign'),
        duration: null, // Will be calculated when assignment ends
        sessionId: this.getCurrentSessionId()
      };
      
      // Check for recent duplicate entries (within last 5 seconds)
      const recent = STATE.analytics.history.filter(entry => {
        const entryTime = new Date(entry.timestamp).getTime();
        const currentTime = timestamp.getTime();
        return (currentTime - entryTime) < 5000 && // within 5 seconds
               entry.badgeId === badgeId && 
               entry.employeeId === badge.eid &&
               entry.toLocation === toLoc &&
               entry.site === assignmentSite;
      });
      
      // Only add if not a recent duplicate
      if (recent.length === 0) {
        STATE.analytics.history.push(logEntry);
      } else {
        console.log('[Analytics] Skipping duplicate log entry for', badge.name, toLoc);
      }
      this.updatePerformanceMetrics(badge.eid, logEntry);
      this.saveAnalyticsData();
      console.debug('[Analytics] Logged assignment:', logEntry);
    },

    // Track work sessions (full shifts)
    startSession: function(metadata = {}) {
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const session = {
        id: sessionId,
        startTime: new Date().toISOString(),
        endTime: null,
        date: metadata.date || new Date().toDateString(),
        shift: metadata.shift || 'day',
        site: metadata.site || 'Other',
        plannedHC: metadata.plannedHC || 0,
        actualHC: 0,
        assignments: 0,
        reassignments: 0,
        efficiency: null,
        notes: metadata.notes || ''
      };
      
      STATE.analytics.sessions.push(session);
      this.currentSessionId = sessionId;
      this.saveAnalyticsData();
      console.debug('[Analytics] Started session:', session);
      return sessionId;
    },

    // End current work session
    endSession: function() {
      if (!this.currentSessionId) return;
      
      const session = STATE.analytics.sessions.find(s => s.id === this.currentSessionId);
      if (!session) return;
      
      session.endTime = new Date().toISOString();
      session.actualHC = Object.values(STATE.badges).filter(b => b.loc !== 'unassigned').length;
      
      // Calculate session metrics
      const sessionHistory = STATE.analytics.history.filter(h => h.sessionId === this.currentSessionId);
      session.assignments = sessionHistory.filter(h => h.action === 'assign').length;
      session.reassignments = sessionHistory.filter(h => h.action === 'reassign').length;
      session.efficiency = session.plannedHC > 0 ? (session.actualHC / session.plannedHC * 100).toFixed(2) : 0;
      
      this.saveAnalyticsData();
      console.debug('[Analytics] Ended session:', session);
      this.currentSessionId = null;
    },

    getCurrentSessionId: function() {
      return this.currentSessionId || null;
    },

    // Update employee performance metrics
    updatePerformanceMetrics: function(employeeId, logEntry) {
      if (!employeeId || !logEntry) return;
      
      if (!STATE.analytics.performance[employeeId]) {
        STATE.analytics.performance[employeeId] = {
          employeeId: employeeId,
          name: logEntry.employeeName,
          totalAssignments: 0,
          processExperience: {}, // Track which processes they've worked
          shiftPreference: {}, // Track shift performance
          avgAssignmentDuration: 0,
          performanceScore: 0,
          reliability: 0,
          versatility: 0,
          lastActive: null,
          weeklyStats: {}, // Track performance by week
          productivityTrends: [], // Track assignment frequency over time
          collaborationScore: 0, // How well they work in teams
          adaptabilityScore: 0, // How quickly they learn new processes
          consistencyScore: 0, // How consistent their performance is
          peakPerformanceHours: {}, // Best performance times
          trainingNeeds: [], // Identified skills gaps
          strengths: [] // Identified strengths
        };
      }
      
      const metrics = STATE.analytics.performance[employeeId];
      metrics.totalAssignments++;
      metrics.lastActive = logEntry.timestamp;
      
      // Track process experience and calculate proficiency
      if (logEntry.toLocation && logEntry.toLocation !== 'unassigned') {
        if (!metrics.processExperience[logEntry.toLocation]) {
          metrics.processExperience[logEntry.toLocation] = 0;
        }
        metrics.processExperience[logEntry.toLocation]++;
        
        // Update process proficiency levels
        const assignments = metrics.processExperience[logEntry.toLocation];
        let proficiencyLevel = 'Beginner';
        if (assignments >= 20) proficiencyLevel = 'Expert';
        else if (assignments >= 10) proficiencyLevel = 'Intermediate';
        else if (assignments >= 5) proficiencyLevel = 'Competent';
        
        // Track strengths (processes with high proficiency)
        if (proficiencyLevel === 'Expert' && !metrics.strengths.includes(logEntry.toLocation)) {
          metrics.strengths.push(logEntry.toLocation);
        }
      }
      
      // Track shift patterns and peak hours
      if (logEntry.shiftCode) {
        if (!metrics.shiftPreference[logEntry.shiftCode]) {
          metrics.shiftPreference[logEntry.shiftCode] = 0;
        }
        metrics.shiftPreference[logEntry.shiftCode]++;
        
        // Track peak performance hours
        const hour = new Date(logEntry.timestamp).getHours();
        if (!metrics.peakPerformanceHours[hour]) {
          metrics.peakPerformanceHours[hour] = 0;
        }
        metrics.peakPerformanceHours[hour]++;
      }
      
      // Update weekly statistics
      const weekKey = this.getWeekKey(new Date(logEntry.timestamp));
      if (!metrics.weeklyStats[weekKey]) {
        metrics.weeklyStats[weekKey] = {
          assignments: 0,
          processes: new Set(),
          efficiency: 0,
          reliability: 0
        };
      }
      
      // Ensure processes is always a Set (fix for deserialization issues)
      if (!(metrics.weeklyStats[weekKey].processes instanceof Set)) {
        const existingProcesses = metrics.weeklyStats[weekKey].processes || [];
        metrics.weeklyStats[weekKey].processes = new Set(Array.isArray(existingProcesses) ? existingProcesses : Object.keys(existingProcesses));
      }
      
      metrics.weeklyStats[weekKey].assignments++;
      if (logEntry.toLocation !== 'unassigned') {
        metrics.weeklyStats[weekKey].processes.add(logEntry.toLocation);
      }
      
      // Calculate dynamic scores
      metrics.versatility = Object.keys(metrics.processExperience).length;
      metrics.adaptabilityScore = this.calculateAdaptabilityScore(metrics);
      metrics.consistencyScore = this.calculateConsistencyScore(metrics);
      metrics.collaborationScore = this.calculateCollaborationScore(employeeId);
      
      // Enhanced performance score calculation
      metrics.performanceScore = Math.min(100, 
        (metrics.totalAssignments * 1.5) + 
        (metrics.versatility * 8) + 
        (metrics.reliability * 12) +
        (metrics.adaptabilityScore * 0.2) +
        (metrics.consistencyScore * 0.15) +
        (metrics.collaborationScore * 0.1)
      );
      
      // Identify training needs based on low-experience processes
      metrics.trainingNeeds = this.identifyTrainingNeeds(metrics);
      
      // Track productivity trends
      metrics.productivityTrends.push({
        timestamp: logEntry.timestamp,
        assignments: metrics.totalAssignments,
        score: metrics.performanceScore
      });
      
      // Keep only last 30 productivity data points
      if (metrics.productivityTrends.length > 30) {
        metrics.productivityTrends = metrics.productivityTrends.slice(-30);
      }
    },

    // Calculate adaptability score based on learning curve
    calculateAdaptabilityScore: function(metrics) {
      const processes = Object.entries(metrics.processExperience);
      if (processes.length === 0) return 0;
      
      let adaptabilitySum = 0;
      processes.forEach(([process, count]) => {
        // Higher score for quickly ramping up in new processes
        if (count <= 5) adaptabilitySum += count * 20; // Early learning bonus
        else adaptabilitySum += 100; // Full competency reached
      });
      
      return Math.min(100, adaptabilitySum / processes.length);
    },

    // Calculate consistency score based on assignment patterns
    calculateConsistencyScore: function(metrics) {
      const trends = metrics.productivityTrends;
      if (trends.length < 5) return 50; // Default for insufficient data
      
      // Calculate variance in performance
      const scores = trends.map(t => t.score);
      const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      const variance = scores.reduce((sum, score) => sum + Math.pow(score - avg, 2), 0) / scores.length;
      
      // Lower variance = higher consistency
      return Math.max(0, 100 - variance);
    },

    // Calculate collaboration score based on team assignments
    calculateCollaborationScore: function(employeeId) {
      // Calculate based on how often they work alongside others in same processes
      const employeeHistory = STATE.analytics.history.filter(h => h.employeeId === employeeId);
      let collaborationEvents = 0;
      
      employeeHistory.forEach(entry => {
        // Count assignments to processes where others are also assigned
        const sameTimeAssignments = STATE.analytics.history.filter(h => 
          h.toLocation === entry.toLocation && 
          Math.abs(new Date(h.timestamp) - new Date(entry.timestamp)) < 60000 && // Within 1 minute
          h.employeeId !== employeeId
        );
        collaborationEvents += sameTimeAssignments.length;
      });
      
      return Math.min(100, collaborationEvents * 5); // Scale to 0-100
    },

    // Identify training needs based on process gaps
    identifyTrainingNeeds: function(metrics) {
      const allProcesses = ['cb', 'ibws', 'lineloaders', 'trickle', 'dm', 'idrt', 'pb', 'e2s', 'dockws', 'e2sws', 'tpb', 'tws', 'sap', 'ao5s', 'pa', 'ps', 'laborshare'];
      const experienced = Object.keys(metrics.processExperience);
      const gaps = allProcesses.filter(process => !experienced.includes(process));
      
      return gaps.slice(0, 3); // Return top 3 training opportunities
    },

    // Get week key for grouping statistics
    getWeekKey: function(date) {
      const year = date.getFullYear();
      const week = Math.ceil((date - new Date(year, 0, 1)) / (7 * 24 * 60 * 60 * 1000));
      return `${year}-W${week}`;
    },

    // Save analytics data to localStorage
    saveAnalyticsData: function() {
      try {
        // Create a deep copy and convert Set objects to arrays for serialization
        const analyticsToSave = JSON.parse(JSON.stringify(STATE.analytics, (key, value) => {
          if (value instanceof Set) {
            return Array.from(value);
          }
          return value;
        }));
        
        localStorage.setItem('vlab:analytics', JSON.stringify(analyticsToSave));
        console.debug('[Analytics] Saved analytics data to localStorage');
      } catch (error) {
        console.warn('[Analytics] Failed to save analytics data:', error);
      }
    },

    // Load analytics data from localStorage
    loadAnalyticsData: function() {
      try {
        const data = localStorage.getItem('vlab:analytics');
        if (data) {
          const parsed = JSON.parse(data);
          STATE.analytics = {
            history: parsed.history || [],
            sessions: parsed.sessions || [],
            performance: parsed.performance || {},
            patterns: parsed.patterns || {}
          };
          
          // Fix Set objects that were serialized as arrays/objects
          Object.values(STATE.analytics.performance).forEach(perf => {
            if (perf.weeklyStats) {
              Object.values(perf.weeklyStats).forEach(weekStat => {
                if (weekStat.processes && !(weekStat.processes instanceof Set)) {
                  // Convert back to Set if it was serialized as array or object
                  weekStat.processes = new Set(Array.isArray(weekStat.processes) ? weekStat.processes : Object.keys(weekStat.processes));
                }
              });
            }
          });
          
          console.debug('[Analytics] Loaded analytics data from localStorage');
        }
      } catch (error) {
        console.warn('[Analytics] Failed to load analytics data:', error);
        STATE.analytics = {
          history: [],
          sessions: [],
          performance: {},
          patterns: {}
        };
      }
    },

    // Enhanced assignment recommendations with AI-like scoring
    getRecommendations: function(processPath, requirements = {}) {
      const recommendations = [];
      const employees = Object.values(STATE.analytics.performance);
      const currentAssignments = Object.values(STATE.badges).filter(b => b.loc === processPath);
      
      employees.forEach(emp => {
        // Skip if employee is already assigned to this process
        if (currentAssignments.some(badge => badge.eid === emp.employeeId)) {
          return;
        }
        
        let score = 0;
        let reasoning = [];
        
        // 1. Process Experience (30% weight)
        const processExp = emp.processExperience[processPath] || 0;
        const experienceScore = Math.min(30, processExp * 3);
        score += experienceScore;
        
        if (processExp >= 10) reasoning.push('Highly experienced');
        else if (processExp >= 5) reasoning.push('Experienced');
        else if (processExp > 0) reasoning.push('Some experience');
        else reasoning.push('Cross-training opportunity');
        
        // 2. Performance Score (25% weight)
        const performanceWeight = (emp.performanceScore / 100) * 25;
        score += performanceWeight;
        
        if (emp.performanceScore >= 85) reasoning.push('Top performer');
        else if (emp.performanceScore >= 70) reasoning.push('Strong performer');
        
        // 3. Versatility and Adaptability (20% weight)
        const versatilityScore = Math.min(20, emp.versatility * 2);
        const adaptabilityScore = (emp.adaptabilityScore / 100) * 10;
        score += versatilityScore + adaptabilityScore;
        
        if (emp.versatility >= 8) reasoning.push('Highly versatile');
        if (emp.adaptabilityScore >= 80) reasoning.push('Quick learner');
        
        // 4. Recent Activity and Availability (15% weight)
        if (emp.lastActive) {
          const daysSinceActive = (new Date() - new Date(emp.lastActive)) / (1000 * 60 * 60 * 24);
          if (daysSinceActive < 1) score += 15; // Very recent
          else if (daysSinceActive < 7) score += 10;
          else if (daysSinceActive < 30) score += 5;
          
          if (daysSinceActive < 7) reasoning.push('Recently active');
        }
        
        // 5. Consistency and Reliability (10% weight)
        const consistencyScore = (emp.consistencyScore / 100) * 10;
        score += consistencyScore;
        
        if (emp.consistencyScore >= 80) reasoning.push('Highly consistent');
        
        // 6. Workload Balance Adjustment
        const currentLoad = Object.values(STATE.badges).filter(b => b.eid === emp.employeeId && b.loc !== 'unassigned').length;
        if (currentLoad === 0) score += 10; // Bonus for unassigned employees
        else if (currentLoad >= 2) score -= 5; // Penalty for overloaded employees
        
        if (currentLoad === 0) reasoning.push('Available');
        else if (currentLoad >= 2) reasoning.push('Currently busy');
        
        // 7. Time-based Performance Patterns
        const currentHour = new Date().getHours();
        const hourlyPerformance = emp.peakPerformanceHours[currentHour] || 0;
        if (hourlyPerformance > 0) {
          score += Math.min(5, hourlyPerformance * 0.5);
          reasoning.push('Peak performance time');
        }
        
        // 8. Team Synergy (if requirements specify team needs)
        if (requirements.teamSynergy && emp.collaborationScore >= 70) {
          score += 8;
          reasoning.push('Strong team player');
        }
        
        // 9. Skill Gap Analysis
        if (requirements.skillDevelopment && emp.trainingNeeds.includes(processPath)) {
          score += 12; // Bonus for addressing skill gaps
          reasoning.push('Skill development opportunity');
        }
        
        // 10. Fair Rotation Bonus
        if (ANALYTICS.ROTATION && emp.employeeId) {
          const rotationScore = ANALYTICS.ROTATION.calculateRotationScore(emp.employeeId);
          const processExp = emp.processExperience[processPath] || 0;
          
          // Bonus for employees with poor rotation who need variety
          if (rotationScore.status === 'poor' && processExp < 3) {
            score += 15;
            reasoning.push('Rotation fairness priority');
          } else if (rotationScore.status === 'needs_improvement' && processExp === 0) {
            score += 8;
            reasoning.push('Improve rotation variety');
          }
          
          // Slight penalty for employees with excellent rotation in processes they know well
          if (rotationScore.status === 'excellent' && processExp > 10) {
            score -= 3;
            reasoning.push('Consider rotation balance');
          }
        }
        
        // 11. Shift Preference Alignment
        const badge = Object.values(STATE.badges).find(b => b.eid === emp.employeeId);
        if (badge && badge.scode) {
          const shiftType = badge.scode.toUpperCase().startsWith('N') ? 'night' : 'day';
          const preferenceCount = emp.shiftPreference[badge.scode] || 0;
          if (preferenceCount > 5) {
            score += 5;
            reasoning.push('Preferred shift pattern');
          }
        }
        
        // Calculate confidence level
        let confidence = 'Low';
        if (score >= 80) confidence = 'Very High';
        else if (score >= 65) confidence = 'High';
        else if (score >= 45) confidence = 'Medium';
        
        // Risk assessment
        let riskLevel = 'Low';
        if (processExp === 0 && emp.adaptabilityScore < 50) riskLevel = 'High';
        else if (processExp < 3) riskLevel = 'Medium';
        
        recommendations.push({
          employeeId: emp.employeeId,
          name: emp.name,
          score: Math.round(score * 10) / 10, // Round to 1 decimal
          processExp: processExp,
          versatility: emp.versatility,
          confidence: confidence,
          riskLevel: riskLevel,
          reasoning: reasoning.slice(0, 3), // Top 3 reasons
          fullReason: reasoning.join(', '),
          performanceScore: emp.performanceScore,
          currentLoad: currentLoad,
          adaptabilityScore: emp.adaptabilityScore,
          consistencyScore: emp.consistencyScore
        });
      });
      
      // Sort by score and return top recommendations
      const sortedRecommendations = recommendations.sort((a, b) => b.score - a.score);
      
      // Add ranking information
      sortedRecommendations.forEach((rec, index) => {
        rec.rank = index + 1;
        rec.percentile = ((sortedRecommendations.length - index) / sortedRecommendations.length * 100).toFixed(0);
      });
      
      return sortedRecommendations.slice(0, 10); // Return top 10 recommendations
    },

    // Get bulk assignment recommendations for multiple processes
    getBulkRecommendations: function(processList, requirements = {}) {
      const bulkRecommendations = {};
      const usedEmployees = new Set();
      
      // Prioritize processes by current need (fewer assigned employees = higher priority)
      const processNeeds = processList.map(process => ({
        process,
        currentCount: Object.values(STATE.badges).filter(b => b.loc === process).length,
        targetCount: requirements.targets ? requirements.targets[process] : 3
      })).sort((a, b) => (a.currentCount - a.targetCount) - (b.currentCount - b.targetCount));
      
      processNeeds.forEach(({ process, targetCount, currentCount }) => {
        const needed = Math.max(0, targetCount - currentCount);
        if (needed > 0) {
          // Get recommendations excluding already used employees
          const availableEmployees = Object.values(STATE.analytics.performance)
            .filter(emp => !usedEmployees.has(emp.employeeId));
          
          const processRecommendations = this.getRecommendations(process, requirements)
            .filter(rec => !usedEmployees.has(rec.employeeId))
            .slice(0, needed);
          
          bulkRecommendations[process] = processRecommendations;
          
          // Mark top recommendations as used to avoid conflicts
          processRecommendations.slice(0, Math.min(needed, 2)).forEach(rec => {
            usedEmployees.add(rec.employeeId);
          });
        }
      });
      
      return bulkRecommendations;
    },

    // Analyze assignment optimization opportunities
    getOptimizationSuggestions: function() {
      const suggestions = [];
      const currentAssignments = {};
      
      // Group current assignments by location
      Object.values(STATE.badges).forEach(badge => {
        if (badge.loc && badge.loc !== 'unassigned') {
          if (!currentAssignments[badge.loc]) {
            currentAssignments[badge.loc] = [];
          }
          currentAssignments[badge.loc].push(badge);
        }
      });
      
      // Analyze each process for optimization opportunities
      Object.entries(currentAssignments).forEach(([process, badges]) => {
        badges.forEach(badge => {
          const empPerformance = STATE.analytics.performance[badge.eid];
          if (!empPerformance) return;
          
          const processExp = empPerformance.processExperience[process] || 0;
          const recommendations = this.getRecommendations(process);
          const currentEmployeeRank = recommendations.findIndex(rec => rec.employeeId === badge.eid) + 1;
          
          // Suggest optimization if current employee is not in top 3 recommendations
          if (currentEmployeeRank > 3 && recommendations[0] && recommendations[0].score > 60) {
            suggestions.push({
              type: 'reassignment',
              priority: currentEmployeeRank > 5 ? 'high' : 'medium',
              process: process,
              currentEmployee: badge.name,
              suggestedEmployee: recommendations[0].name,
              reason: `${recommendations[0].name} would be ${(recommendations[0].score - (empPerformance.performanceScore || 0)).toFixed(1)} points better for ${process}`,
              confidenceGain: recommendations[0].confidence,
              riskReduction: recommendations[0].riskLevel === 'Low' ? 'Yes' : 'No'
            });
          }
        });
      });
      
      // Suggest assignments for unassigned high performers
      const unassigned = Object.values(STATE.badges).filter(b => b.loc === 'unassigned');
      const highPerformers = unassigned.filter(badge => {
        const emp = STATE.analytics.performance[badge.eid];
        return emp && emp.performanceScore >= 75;
      });
      
      highPerformers.forEach(badge => {
        const emp = STATE.analytics.performance[badge.eid];
        const bestProcesses = Object.entries(emp.processExperience)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        
        if (bestProcesses.length > 0) {
          suggestions.push({
            type: 'assignment',
            priority: 'medium',
            employee: badge.name,
            suggestedProcess: bestProcesses[0][0],
            reason: `High performer with ${bestProcesses[0][1]} assignments in ${bestProcesses[0][0]}`,
            expectedImpact: 'Increase process efficiency'
          });
        }
      });
      
      return suggestions.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }).slice(0, 8); // Return top 8 suggestions
    },

    currentSessionId: null,

    // Fair Rotation System
    ROTATION: {
      // Lock current assignments and generate rotation reports
      lockAssignments: function() {
        const timestamp = new Date().toISOString();
        const currentSession = ANALYTICS.getCurrentSessionId();
        
        if (!currentSession) {
          alert('No active session to lock. Please start a session first.');
          return;
        }
        
        // Create assignment lock record
        const lockRecord = {
          id: `lock_${Date.now()}`,
          timestamp: timestamp,
          sessionId: currentSession,
          date: new Date().toDateString(),
          assignments: {},
          rotationScores: {},
          nextRecommendations: {}
        };
        
        // Capture current assignments
        Object.values(STATE.badges).forEach(badge => {
          if (badge.loc !== 'unassigned') {
            if (!lockRecord.assignments[badge.loc]) {
              lockRecord.assignments[badge.loc] = [];
            }
            lockRecord.assignments[badge.loc].push({
              employeeId: badge.eid,
              employeeName: badge.name,
              shiftCode: badge.scode,
              site: badge.site
            });
          }
        });
        
        // Calculate rotation scores for each employee
        Object.values(STATE.analytics.performance).forEach(emp => {
          lockRecord.rotationScores[emp.employeeId] = this.calculateRotationScore(emp.employeeId);
        });
        
        // Generate next assignment recommendations
        lockRecord.nextRecommendations = this.generateRotationRecommendations();
        
        // Save lock record
        if (!STATE.analytics.rotationLocks) {
          STATE.analytics.rotationLocks = [];
        }
        STATE.analytics.rotationLocks.push(lockRecord);
        ANALYTICS.saveAnalyticsData();
        
        // Process in integrated rotation system
        this.processRotationLock(lockRecord);
        
        // Update UI to show locked state and rotation management
        this.updateLockUI(true);
        this.showRotationManagementPanel();
        
        console.log('[ROTATION] Assignments locked and processed in-app:', lockRecord);
        return lockRecord;
      },

      // Lock assignments for a specific quarter without disabling UI globally
      lockQuarter: function(quarter) {
        const q = quarter || (STATE.currentQuarter || 'Q1');
        const timestamp = new Date().toISOString();
        const currentSession = ANALYTICS.getCurrentSessionId();
        if (!currentSession) {
          alert('No active session to lock. Please start a session first.');
          return null;
        }

        // Build lock record similar to full lock, with quarter tag
        const lockRecord = {
          id: `lock_${q}_${Date.now()}`,
          quarter: q,
          timestamp,
          sessionId: currentSession,
          date: new Date().toDateString(),
          assignments: {},
          rotationScores: {},
          nextRecommendations: {}
        };

        // Capture current assignments snapshot into quarterAssignments (preserve existing)
        STATE.quarterAssignments[q] = STATE.quarterAssignments[q] || {};
        Object.values(STATE.badges).forEach(badge => {
          STATE.quarterAssignments[q][badge.id] = badge.loc;
          if (badge.loc !== 'unassigned') {
            if (!lockRecord.assignments[badge.loc]) lockRecord.assignments[badge.loc] = [];
            lockRecord.assignments[badge.loc].push({
              employeeId: badge.eid,
              employeeName: badge.name,
              shiftCode: badge.scode,
              site: badge.site
            });
          }
        });

        // Rotation scores and next recommendations
        Object.values(STATE.analytics.performance).forEach(emp => {
          lockRecord.rotationScores[emp.employeeId] = this.calculateRotationScore(emp.employeeId);
        });
        lockRecord.nextRecommendations = this.generateRotationRecommendations();

        // Persist quarter lock record
        STATE.analytics.quarterLocks = STATE.analytics.quarterLocks || [];
        STATE.analytics.quarterLocks.push(lockRecord);
        STATE.quarterLocks[q] = true;
          // Log a 'lock' entry per assignment so search reflects the locked quarter
          Object.entries(lockRecord.assignments).forEach(([process, employees]) => {
            (employees || []).forEach(emp => {
              const badge = Object.values(STATE.badges).find(b => b.eid === emp.employeeId);
              const logEntry = {
                id: `log_${q}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                timestamp: new Date().toISOString(),
                date: new Date().toDateString(),
                badgeId: badge ? badge.id : `emp_${emp.employeeId}`,
                employeeId: emp.employeeId,
                employeeName: emp.employeeName,
                shiftCode: emp.shiftCode,
                site: emp.site,
                quarter: q,
                fromLocation: process,
                toLocation: process,
                action: 'lock',
                duration: null,
                sessionId: currentSession
              };
              STATE.analytics.history.push(logEntry);
            });
          });
          ANALYTICS.saveAnalyticsData();

        // Optionally open rotation management panel
        this.showRotationManagementPanel();
        // Do NOT disable the lock button globally; just provide lightweight feedback
        console.log(`[ROTATION] Quarter ${q} locked`, lockRecord);
        return lockRecord;
      },
      
      // Calculate fairness score for employee rotation
      calculateRotationScore: function(employeeId) {
        const emp = STATE.analytics.performance[employeeId];
        if (!emp) return { score: 0, status: 'unknown' };
        
        const processes = Object.keys(emp.processExperience);
        const totalAssignments = emp.totalAssignments;
        const uniqueProcesses = processes.length;
        
        // Calculate assignment distribution
        const assignmentDistribution = {};
        let maxAssignments = 0;
        let minAssignments = Infinity;
        
        processes.forEach(process => {
          const count = emp.processExperience[process];
          assignmentDistribution[process] = count;
          maxAssignments = Math.max(maxAssignments, count);
          minAssignments = Math.min(minAssignments, count);
        });
        
        // Calculate fairness metrics
        const varietyScore = Math.min(100, uniqueProcesses * 10); // More processes = higher score
        const balanceScore = totalAssignments > 0 ? 
          Math.max(0, 100 - ((maxAssignments - minAssignments) / totalAssignments * 100)) : 50;
        
        // Recent rotation tracking
        const recentAssignments = STATE.analytics.history
          .filter(h => h.employeeId === employeeId)
          .slice(-10); // Last 10 assignments
        
        const recentProcesses = new Set(recentAssignments.map(h => h.toLocation));
        const recentVarietyScore = Math.min(100, recentProcesses.size * 20);
        
        // Overall rotation score (0-100, higher is better rotation)
        const overallScore = (varietyScore * 0.4) + (balanceScore * 0.4) + (recentVarietyScore * 0.2);
        
        let status = 'good';
        if (overallScore < 30) status = 'poor';
        else if (overallScore < 60) status = 'needs_improvement';
        else if (overallScore >= 85) status = 'excellent';
        
        return {
          score: Math.round(overallScore),
          status: status,
          varietyScore: Math.round(varietyScore),
          balanceScore: Math.round(balanceScore),
          recentVarietyScore: Math.round(recentVarietyScore),
          totalProcesses: uniqueProcesses,
          totalAssignments: totalAssignments,
          assignmentDistribution: assignmentDistribution,
          recommendedProcesses: this.getRecommendedProcessesForRotation(employeeId)
        };
      },
      
      // Get recommended processes for better rotation
      getRecommendedProcessesForRotation: function(employeeId) {
        const emp = STATE.analytics.performance[employeeId];
        if (!emp) return [];
        
  const allProcesses = ['cb', 'ibws', 'lineloaders', 'trickle', 'dm', 'idrt', 'pb', 'e2s', 'dockws', 'e2sws', 'tpb', 'tws', 'sap', 'ao5s', 'pa', 'ps', 'laborshare'];
        const experienced = Object.keys(emp.processExperience);
        const experienceCounts = emp.processExperience;
        
        // Find processes with low or no experience
        const recommendations = allProcesses.map(process => {
          const currentExp = experienceCounts[process] || 0;
          const priority = experienced.includes(process) ? 
            (currentExp < 3 ? 'expand' : 'maintain') : 'learn';
          
          return {
            process: process,
            currentExperience: currentExp,
            priority: priority,
            reason: priority === 'learn' ? 'New skill opportunity' : 
                   priority === 'expand' ? 'Build proficiency' : 'Maintain skills'
          };
        });
        
        // Sort by priority: learn > expand > maintain
        const priorityOrder = { learn: 3, expand: 2, maintain: 1 };
        return recommendations.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
      },
      
      // Generate rotation recommendations for all employees
      generateRotationRecommendations: function() {
        const recommendations = {};
        
        Object.values(STATE.analytics.performance).forEach(emp => {
          const rotationScore = this.calculateRotationScore(emp.employeeId);
          const processRecommendations = rotationScore.recommendedProcesses.slice(0, 3);
          
          recommendations[emp.employeeId] = {
            name: emp.name,
            currentScore: rotationScore.score,
            status: rotationScore.status,
            recommendedProcesses: processRecommendations,
            reasoning: rotationScore.status === 'poor' ? 'Needs immediate rotation diversity' :
                      rotationScore.status === 'needs_improvement' ? 'Could benefit from more variety' :
                      rotationScore.status === 'excellent' ? 'Excellent rotation balance' : 'Good rotation variety'
          };
        });
        
        return recommendations;
      },
      
      // Process rotation lock and integrate into in-app system
      processRotationLock: function(lockRecord) {
        console.log('[ROTATION] Processing rotation lock in-app...');
        
        // Create rotation management data structure
        if (!STATE.analytics.rotationManagement) {
          STATE.analytics.rotationManagement = {
            lockHistory: [],
            rotationRules: {
              maxConsecutiveSameProcess: 3,
              minProcessVariety: 2,
              rotationCycleDays: 7,
              fairnessThreshold: 60
            },
            assignmentQueue: [],
            rotationAlerts: []
          };
        }
        
        const mgmt = STATE.analytics.rotationManagement;
        
        // Store lock record
        mgmt.lockHistory.push(lockRecord);
        
        // Generate smart assignment queue for next session
        this.generateSmartAssignmentQueue(lockRecord);
        
        // Create rotation alerts for employees who need attention
        this.generateRotationAlerts(lockRecord);
        
        // Update employee rotation profiles
        this.updateRotationProfiles(lockRecord);
        
        // Save to persistent storage
        ANALYTICS.saveAnalyticsData();
        
        console.log('[ROTATION] In-app rotation system updated successfully');
        return mgmt;
      },
      
      // Generate assignment lock CSV
      generateAssignmentLockCSV: function(lockRecord) {
        const headers = ['Process', 'Employee ID', 'Employee Name', 'Shift Code', 'Site', 'Lock Timestamp', 'Session ID'];
        const rows = [];
        
        Object.entries(lockRecord.assignments).forEach(([process, employees]) => {
          employees.forEach(emp => {
            rows.push([
              process.toUpperCase(),
              emp.employeeId,
              emp.employeeName,
              emp.shiftCode,
              emp.site,
              lockRecord.timestamp,
              lockRecord.sessionId
            ]);
          });
        });
        
        return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      },
      
      // Generate rotation analysis CSV
      generateRotationAnalysisCSV: function(lockRecord) {
        const headers = [
          'Employee ID', 'Employee Name', 'Rotation Score', 'Status', 'Variety Score', 'Balance Score', 
          'Recent Variety Score', 'Total Processes', 'Total Assignments', 'Most Experienced Process', 
          'Least Experienced Process', 'Recommended Action'
        ];
        
        const rows = Object.entries(lockRecord.rotationScores).map(([empId, score]) => {
          const emp = STATE.analytics.performance[empId];
          const distribution = score.assignmentDistribution;
          const processes = Object.entries(distribution);
          
          const mostExp = processes.length > 0 ? 
            processes.reduce((max, curr) => curr[1] > max[1] ? curr : max) : ['N/A', 0];
          const leastExp = processes.length > 0 ? 
            processes.reduce((min, curr) => curr[1] < min[1] ? curr : min) : ['N/A', 0];
          
          let recommendedAction = 'Maintain current variety';
          if (score.status === 'poor') recommendedAction = 'Urgent: Assign to new processes';
          else if (score.status === 'needs_improvement') recommendedAction = 'Increase process variety';
          else if (score.status === 'excellent') recommendedAction = 'Continue balanced rotation';
          
          return [
            empId,
            emp ? emp.name : 'Unknown',
            score.score,
            score.status,
            score.varietyScore,
            score.balanceScore,
            score.recentVarietyScore,
            score.totalProcesses,
            score.totalAssignments,
            `${mostExp[0]} (${mostExp[1]})`,
            `${leastExp[0]} (${leastExp[1]})`,
            recommendedAction
          ];
        });
        
        return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      },
      
      // Generate recommendations CSV
      generateRecommendationsCSV: function(lockRecord) {
        const headers = ['Employee ID', 'Employee Name', 'Current Score', 'Recommended Process 1', 'Recommended Process 2', 'Recommended Process 3', 'Priority Reason'];
        
        const rows = Object.entries(lockRecord.nextRecommendations).map(([empId, rec]) => [
          empId,
          rec.name,
          rec.currentScore,
          rec.recommendedProcesses[0] ? rec.recommendedProcesses[0].process.toUpperCase() : 'N/A',
          rec.recommendedProcesses[1] ? rec.recommendedProcesses[1].process.toUpperCase() : 'N/A',
          rec.recommendedProcesses[2] ? rec.recommendedProcesses[2].process.toUpperCase() : 'N/A',
          rec.reasoning
        ]);
        
        return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      },
      
      // Generate HTML rotation summary
      generateRotationSummaryHTML: function(lockRecord) {
        const totalEmployees = Object.keys(lockRecord.rotationScores).length;
        const avgRotationScore = Object.values(lockRecord.rotationScores)
          .reduce((sum, score) => sum + score.score, 0) / totalEmployees;
        
        const statusCounts = {};
        Object.values(lockRecord.rotationScores).forEach(score => {
          statusCounts[score.status] = (statusCounts[score.status] || 0) + 1;
        });
        
        const processAssignments = Object.keys(lockRecord.assignments).length;
        
        return `
<!DOCTYPE html>
<html>
<head>
    <title>VLAB Rotation Summary - ${new Date(lockRecord.timestamp).toDateString()}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 1000px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #f59e0b; padding-bottom: 15px; }
        .header h1 { color: #1f2937; margin: 0; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .metric-card { background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 15px; text-align: center; }
        .metric-value { font-size: 24px; font-weight: bold; color: #92400e; }
        .metric-label { color: #b45309; font-size: 12px; text-transform: uppercase; }
        .rotation-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .rotation-table th, .rotation-table td { padding: 8px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 12px; }
        .rotation-table th { background: #fef3c7; font-weight: 600; }
        .status-poor { background: #fee2e2; color: #dc2626; }
        .status-needs_improvement { background: #fef3c7; color: #d97706; }
        .status-good { background: #d1fae5; color: #059669; }
        .status-excellent { background: #dbeafe; color: #2563eb; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔒 Assignment Lock & Rotation Report</h1>
            <p>${new Date(lockRecord.timestamp).toDateString()} - Session: ${lockRecord.sessionId}</p>
        </div>
        
        <div class="metrics">
            <div class="metric-card">
                <div class="metric-value">${totalEmployees}</div>
                <div class="metric-label">Total Employees</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${processAssignments}</div>
                <div class="metric-label">Active Processes</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${avgRotationScore.toFixed(1)}</div>
                <div class="metric-label">Avg Rotation Score</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${statusCounts.excellent || 0}</div>
                <div class="metric-label">Excellent Rotation</div>
            </div>
        </div>
        
        <h2>Employee Rotation Analysis</h2>
        <table class="rotation-table">
            <thead>
                <tr>
                    <th>Employee</th>
                    <th>Score</th>
                    <th>Status</th>
                    <th>Processes</th>
                    <th>Total Assignments</th>
                    <th>Next Recommended</th>
                </tr>
            </thead>
            <tbody>
                ${Object.entries(lockRecord.rotationScores).map(([empId, score]) => {
                  const emp = STATE.analytics.performance[empId];
                  const rec = lockRecord.nextRecommendations[empId];
                  return `
                    <tr class="status-${score.status}">
                        <td>${emp ? emp.name : 'Unknown'}</td>
                        <td>${score.score}</td>
                        <td>${score.status.replace('_', ' ')}</td>
                        <td>${score.totalProcesses}</td>
                        <td>${score.totalAssignments}</td>
                        <td>${rec && rec.recommendedProcesses[0] ? rec.recommendedProcesses[0].process.toUpperCase() : 'N/A'}</td>
                    </tr>
                  `;
                }).join('')}
            </tbody>
        </table>
        
        <h2>Current Process Assignments</h2>
        ${Object.entries(lockRecord.assignments).map(([process, employees]) => `
            <h3>${process.toUpperCase()} (${employees.length} employees)</h3>
            <ul>
                ${employees.map(emp => `<li>${emp.employeeName} (${emp.employeeId}) - ${emp.shiftCode}</li>`).join('')}
            </ul>
        `).join('')}
        
        <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 11px;">
            Generated by VLAB Fair Rotation System - ${lockRecord.timestamp}
        </div>
    </div>
</body>
</html>`;
      },
      
      // Generate smart assignment queue for next session
      generateSmartAssignmentQueue: function(lockRecord) {
        const mgmt = STATE.analytics.rotationManagement;
        mgmt.assignmentQueue = [];
        
        // Analyze current assignments and create balanced suggestions
        const processNeeds = this.analyzeProcessNeeds(lockRecord);
        const employeeRotationNeeds = this.analyzeEmployeeRotationNeeds();
        
        // Create assignment suggestions prioritizing rotation fairness
        Object.entries(employeeRotationNeeds).forEach(([empId, needs]) => {
          const employee = STATE.analytics.performance[empId];
          if (!employee) return;
          
          // Find best process match for this employee
          const bestMatch = this.findBestProcessMatch(empId, processNeeds, needs);
          
          if (bestMatch) {
            mgmt.assignmentQueue.push({
              employeeId: empId,
              employeeName: employee.name,
              recommendedProcess: bestMatch.process,
              priority: bestMatch.priority,
              reason: bestMatch.reason,
              rotationScore: needs.currentScore,
              expectedImprovement: bestMatch.expectedImprovement,
              timestamp: new Date().toISOString()
            });
          }
        });
        
        // Sort by priority and rotation need
        mgmt.assignmentQueue.sort((a, b) => {
          const priorityOrder = { high: 3, medium: 2, low: 1 };
          return (priorityOrder[b.priority] - priorityOrder[a.priority]) || 
                 (a.rotationScore - b.rotationScore); // Lower rotation score = higher need
        });
        
        console.log('[ROTATION] Generated assignment queue:', mgmt.assignmentQueue);
      },

      // Analyze process staffing needs
      analyzeProcessNeeds: function(lockRecord) {
        const processNeeds = {};
        const allProcesses = ['cb', 'ibws', 'lineloaders', 'trickle', 'dm', 'idrt', 'pb', 'e2s', 'dockws', 'e2sws', 'tpb', 'tws', 'sap', 'ao5s', 'pa', 'ps', 'laborshare'];
        
        allProcesses.forEach(process => {
          const currentAssigned = lockRecord.assignments[process] ? lockRecord.assignments[process].length : 0;
          const targetStaffing = 2; // Default target, could be made configurable
          
          processNeeds[process] = {
            current: currentAssigned,
            target: targetStaffing,
            need: Math.max(0, targetStaffing - currentAssigned),
            priority: currentAssigned === 0 ? 'high' : (currentAssigned < targetStaffing ? 'medium' : 'low')
          };
        });
        
        return processNeeds;
      },

      // Analyze individual employee rotation needs
      analyzeEmployeeRotationNeeds: function() {
        const employeeNeeds = {};
        
        Object.values(STATE.analytics.performance).forEach(emp => {
          const rotationScore = this.calculateRotationScore(emp.employeeId);
          const recentAssignments = STATE.analytics.history
            .filter(h => h.employeeId === emp.employeeId)
            .slice(-5);
          
          const recentProcesses = new Set(recentAssignments.map(h => h.toLocation));
          const isStuckInSameProcess = recentProcesses.size === 1 && recentAssignments.length >= 3;
          
          employeeNeeds[emp.employeeId] = {
            currentScore: rotationScore.score,
            status: rotationScore.status,
            needsVariety: rotationScore.score < 60,
            stuckInSameProcess: isStuckInSameProcess,
            preferredNewProcesses: rotationScore.recommendedProcesses.slice(0, 3),
            lastProcess: recentAssignments.length > 0 ? recentAssignments[recentAssignments.length - 1].toLocation : null
          };
        });
        
        return employeeNeeds;
      },

      // Find best process match for employee
      findBestProcessMatch: function(employeeId, processNeeds, employeeNeeds) {
        let bestMatch = null;
        let bestScore = 0;
        
        // Get employee's preferred new processes
        const preferredProcesses = employeeNeeds.preferredNewProcesses || [];
        
        preferredProcesses.forEach(preferred => {
          const process = preferred.process;
          const processNeed = processNeeds[process];
          
          if (!processNeed || processNeed.need === 0) return;
          
          let score = 0;
          let priority = 'low';
          let reason = '';
          
          // Score based on rotation need
          if (employeeNeeds.needsVariety) {
            score += 30;
            reason += 'Needs rotation variety. ';
          }
          
          // Score based on process need
          if (processNeed.priority === 'high') {
            score += 25;
            priority = 'high';
            reason += `${process.toUpperCase()} urgently needs staff. `;
          } else if (processNeed.priority === 'medium') {
            score += 15;
            priority = 'medium';
            reason += `${process.toUpperCase()} needs additional staff. `;
          }
          
          // Bonus for learning new skills
          if (preferred.priority === 'learn') {
            score += 20;
            reason += 'New skill learning opportunity. ';
          } else if (preferred.priority === 'expand') {
            score += 10;
            reason += 'Skill expansion opportunity. ';
          }
          
          // Avoid same process if stuck
          if (employeeNeeds.stuckInSameProcess && employeeNeeds.lastProcess === process) {
            score -= 50;
            reason += 'Avoiding repetitive assignment. ';
          }
          
          if (score > bestScore) {
            bestScore = score;
            bestMatch = {
              process: process,
              priority: priority,
              reason: reason.trim(),
              expectedImprovement: Math.min(15, score / 5),
              confidenceScore: Math.min(100, bestScore)
            };
          }
        });
        
        return bestMatch;
      },

      // Generate rotation alerts for management attention
      generateRotationAlerts: function(lockRecord) {
        const mgmt = STATE.analytics.rotationManagement;
        mgmt.rotationAlerts = [];
        
        Object.entries(lockRecord.rotationScores).forEach(([empId, score]) => {
          const emp = STATE.analytics.performance[empId];
          if (!emp) return;
          
          let alert = null;
          
          if (score.status === 'poor') {
            alert = {
              type: 'urgent',
              employeeId: empId,
              employeeName: emp.name,
              message: `${emp.name} has very limited rotation variety (Score: ${score.score})`,
              action: 'Assign to new process immediately',
              priority: 'high'
            };
          } else if (score.status === 'needs_improvement') {
            alert = {
              type: 'warning',
              employeeId: empId,
              employeeName: emp.name,
              message: `${emp.name} could benefit from more process variety (Score: ${score.score})`,
              action: 'Consider rotation in next 2-3 assignments',
              priority: 'medium'
            };
          }
          
          // Check for process monopolization
          const maxProcess = Object.entries(score.assignmentDistribution)
            .reduce((max, curr) => curr[1] > max[1] ? curr : max, ['', 0]);
          
          if (maxProcess[1] > mgmt.rotationRules.maxConsecutiveSameProcess && score.totalAssignments > 5) {
            alert = {
              type: 'monopolization',
              employeeId: empId,
              employeeName: emp.name,
              message: `${emp.name} has been in ${maxProcess[0].toUpperCase()} for ${maxProcess[1]} assignments`,
              action: `Move away from ${maxProcess[0].toUpperCase()} for better balance`,
              priority: 'high'
            };
          }
          
          if (alert) {
            alert.timestamp = new Date().toISOString();
            mgmt.rotationAlerts.push(alert);
          }
        });
        
        console.log('[ROTATION] Generated alerts:', mgmt.rotationAlerts);
      },

      // Update employee rotation profiles
      updateRotationProfiles: function(lockRecord) {
        Object.entries(lockRecord.rotationScores).forEach(([empId, score]) => {
          const emp = STATE.analytics.performance[empId];
          if (!emp) return;
          
          // Update rotation history
          if (!emp.rotationHistory) {
            emp.rotationHistory = [];
          }
          
          emp.rotationHistory.push({
            date: new Date().toDateString(),
            score: score.score,
            status: score.status,
            processesWorked: score.totalProcesses,
            assignments: score.totalAssignments
          });
          
          // Keep only last 30 records
          if (emp.rotationHistory.length > 30) {
            emp.rotationHistory = emp.rotationHistory.slice(-30);
          }
          
          // Calculate rotation trend
          if (emp.rotationHistory.length >= 3) {
            const recent = emp.rotationHistory.slice(-3);
            const avgRecentScore = recent.reduce((sum, r) => sum + r.score, 0) / recent.length;
            const older = emp.rotationHistory.slice(-6, -3);
            
            if (older.length > 0) {
              const avgOlderScore = older.reduce((sum, r) => sum + r.score, 0) / older.length;
              emp.rotationTrend = avgRecentScore > avgOlderScore ? 'improving' : 
                                 avgRecentScore < avgOlderScore ? 'declining' : 'stable';
            }
          }
        });
      },
      
      // Update UI to show locked state
      updateLockUI: function(locked) {
        const lockBtn = document.getElementById('lockAssignmentsBtn');
        if (lockBtn) {
          if (locked) {
            lockBtn.textContent = '🔒 Locked';
            lockBtn.disabled = true;
            lockBtn.classList.add('opacity-50', 'cursor-not-allowed');
            lockBtn.title = 'Assignments are locked. Refresh to unlock.';
            
            // Add locked banner
            this.showLockedBanner();
          }
        }
      },
      
      // Show banner indicating assignments are locked
      showLockedBanner: function() {
        const existingBanner = document.getElementById('lockedBanner');
        if (existingBanner) return; // Don't create duplicate
        
        const banner = document.createElement('div');
        banner.id = 'lockedBanner';
        banner.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: linear-gradient(90deg, #f59e0b, #d97706);
          color: white;
          text-align: center;
          padding: 8px;
          font-weight: 600;
          font-size: 14px;
          z-index: 1000;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          animation: slideDown 0.3s ease-out;
        `;
        banner.innerHTML = '🔒 Assignments Locked - Rotation tracking active. Reports generated. Refresh page to unlock.';
        
        document.body.appendChild(banner);
        
        // Add CSS animation
        const style = document.createElement('style');
        style.textContent = `
          @keyframes slideDown {
            from { transform: translateY(-100%); }
            to { transform: translateY(0); }
          }
        `;
        document.head.appendChild(style);
        
        // Adjust page content to account for banner
        document.body.style.paddingTop = '40px';
      },
      
      // Show rotation management panel
      showRotationManagementPanel: function() {
        const existingPanel = document.getElementById('rotationPanel');
        if (existingPanel) {
          existingPanel.style.display = 'block';
          return;
        }
        
        const panel = document.createElement('div');
        panel.id = 'rotationPanel';
        panel.className = 'rotation-management-panel';
        panel.innerHTML = `
          <div class="rotation-panel-header">
            <h3>🔄 Smart Rotation Management</h3>
            <button class="rotation-close-btn" onclick="document.getElementById('rotationPanel').style.display='none'">×</button>
          </div>
          <div class="rotation-panel-content">
            <div class="rotation-tabs">
              <button class="rotation-tab active" data-tab="queue">Assignment Queue</button>
              <button class="rotation-tab" data-tab="alerts">Rotation Alerts</button>
              <button class="rotation-tab" data-tab="trends">Employee Trends</button>
            </div>
            <div id="rotation-queue" class="rotation-tab-content">
              <div id="queueContent">Loading assignment queue...</div>
            </div>
            <div id="rotation-alerts" class="rotation-tab-content hidden">
              <div id="alertsContent">Loading rotation alerts...</div>
            </div>
            <div id="rotation-trends" class="rotation-tab-content hidden">
              <div id="trendsContent">Loading employee trends...</div>
            </div>
          </div>
        `;
        
        // Style the panel
        panel.style.cssText = `
          position: fixed;
          right: 20px;
          top: 80px;
          width: 400px;
          max-height: 600px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.15);
          z-index: 1001;
          overflow: hidden;
          border: 2px solid #f59e0b;
        `;
        
        document.body.appendChild(panel);
        
        // Add panel styles
        this.addRotationPanelStyles();
        
        // Setup tab functionality
        this.setupRotationTabs();
        
        // Load initial content
        this.loadRotationQueueContent();
      },
      
      // Add CSS styles for rotation panel
      addRotationPanelStyles: function() {
        if (document.getElementById('rotationPanelStyles')) return;
        
        const style = document.createElement('style');
        style.id = 'rotationPanelStyles';
        style.textContent = `
          .rotation-panel-header {
            background: linear-gradient(135deg, #f59e0b, #d97706);
            color: white;
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .rotation-panel-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
          }
          .rotation-close-btn {
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .rotation-close-btn:hover {
            background: rgba(255,255,255,0.2);
          }
          .rotation-panel-content {
            padding: 0;
          }
          .rotation-tabs {
            display: flex;
            background: #f3f4f6;
          }
          .rotation-tab {
            flex: 1;
            padding: 8px 12px;
            background: none;
            border: none;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            color: #6b7280;
            transition: all 0.2s;
          }
          .rotation-tab.active {
            background: white;
            color: #1f2937;
            border-bottom: 2px solid #f59e0b;
          }
          .rotation-tab-content {
            padding: 16px;
            max-height: 400px;
            overflow-y: auto;
          }
          .rotation-tab-content.hidden {
            display: none;
          }
          .queue-item {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 8px;
            transition: all 0.2s;
          }
          .queue-item:hover {
            border-color: #f59e0b;
            background: #fef3c7;
          }
          .queue-item-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
          }
          .queue-employee {
            font-weight: 600;
            color: #1f2937;
          }
          .queue-process {
            background: #3b82f6;
            color: white;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 600;
          }
          .queue-reason {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 6px;
          }
          .queue-actions {
            display: flex;
            gap: 6px;
          }
          .queue-btn {
            padding: 4px 8px;
            font-size: 10px;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-weight: 500;
          }
          .queue-btn.assign {
            background: #10b981;
            color: white;
          }
          .queue-btn.skip {
            background: #6b7280;
            color: white;
          }
          .queue-btn:hover {
            opacity: 0.8;
          }
          .alert-item {
            padding: 12px;
            margin-bottom: 8px;
            border-radius: 6px;
            border-left: 4px solid;
          }
          .alert-urgent {
            background: #fef2f2;
            border-color: #dc2626;
          }
          .alert-warning {
            background: #fef3c7;
            border-color: #f59e0b;
          }
          .alert-monopolization {
            background: #f0f4ff;
            border-color: #3b82f6;
          }
          .alert-header {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 4px;
          }
          .alert-message {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 6px;
          }
          .alert-action {
            font-size: 12px;
            font-weight: 500;
            color: #1f2937;
          }
        `;
        document.head.appendChild(style);
      },
      
      // Setup tab functionality for rotation panel
      setupRotationTabs: function() {
        const tabs = document.querySelectorAll('.rotation-tab');
        const contents = document.querySelectorAll('.rotation-tab-content');
        
        tabs.forEach(tab => {
          tab.addEventListener('click', () => {
            // Remove active from all tabs
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.add('hidden'));
            
            // Add active to clicked tab
            tab.classList.add('active');
            const tabName = tab.getAttribute('data-tab');
            const content = document.getElementById(`rotation-${tabName}`);
            if (content) {
              content.classList.remove('hidden');
              
              // Load content based on tab
              if (tabName === 'queue') this.loadRotationQueueContent();
              else if (tabName === 'alerts') this.loadRotationAlertsContent();
              else if (tabName === 'trends') this.loadRotationTrendsContent();
            }
          });
        });
      },
      
      // Load assignment queue content
      loadRotationQueueContent: function() {
        const queueContent = document.getElementById('queueContent');
        const mgmt = STATE.analytics.rotationManagement;
        
        if (!mgmt || !mgmt.assignmentQueue || mgmt.assignmentQueue.length === 0) {
          queueContent.innerHTML = '<p style="text-align: center; color: #6b7280;">No assignment recommendations available</p>';
          return;
        }
        
        queueContent.innerHTML = mgmt.assignmentQueue.map(item => `
          <div class="queue-item" data-employee-id="${item.employeeId}">
            <div class="queue-item-header">
              <span class="queue-employee">${item.employeeName}</span>
              <span class="queue-process">${item.recommendedProcess.toUpperCase()}</span>
            </div>
            <div class="queue-reason">${item.reason}</div>
            <div style="font-size: 11px; color: #6b7280; margin-bottom: 8px;">
              Current rotation: ${item.rotationScore} | Priority: ${item.priority} | Expected improvement: +${item.expectedImprovement}
            </div>
            <div class="queue-actions">
              <button class="queue-btn assign" onclick="ANALYTICS.ROTATION.executeAssignment('${item.employeeId}', '${item.recommendedProcess}')">
                Assign Now
              </button>
              <button class="queue-btn skip" onclick="ANALYTICS.ROTATION.skipAssignment('${item.employeeId}')">
                Skip
              </button>
            </div>
          </div>
        `).join('');
      },
      
      // Load rotation alerts content
      loadRotationAlertsContent: function() {
        const alertsContent = document.getElementById('alertsContent');
        const mgmt = STATE.analytics.rotationManagement;
        
        if (!mgmt || !mgmt.rotationAlerts || mgmt.rotationAlerts.length === 0) {
          alertsContent.innerHTML = '<p style="text-align: center; color: #6b7280;">No rotation alerts</p>';
          return;
        }
        
        alertsContent.innerHTML = mgmt.rotationAlerts.map(alert => `
          <div class="alert-item alert-${alert.type}">
            <div class="alert-header">${alert.employeeName}</div>
            <div class="alert-message">${alert.message}</div>
            <div class="alert-action">Action: ${alert.action}</div>
          </div>
        `).join('');
      },
      
      // Load rotation trends content
      loadRotationTrendsContent: function() {
        const trendsContent = document.getElementById('trendsContent');
        const employees = Object.values(STATE.analytics.performance);
        
        if (employees.length === 0) {
          trendsContent.innerHTML = '<p style="text-align: center; color: #6b7280;">No employee data available</p>';
          return;
        }
        
        const employeesWithTrends = employees.filter(emp => emp.rotationHistory && emp.rotationHistory.length >= 2);
        
        if (employeesWithTrends.length === 0) {
          trendsContent.innerHTML = '<p style="text-align: center; color: #6b7280;">Not enough data for trends analysis</p>';
          return;
        }
        
        trendsContent.innerHTML = employeesWithTrends.map(emp => {
          const latest = emp.rotationHistory[emp.rotationHistory.length - 1];
          const trendIcon = emp.rotationTrend === 'improving' ? '📈' : 
                           emp.rotationTrend === 'declining' ? '📉' : '➡️';
          
          return `
            <div class="queue-item">
              <div class="queue-item-header">
                <span class="queue-employee">${emp.name}</span>
                <span style="font-size: 12px;">${trendIcon} ${emp.rotationTrend || 'stable'}</span>
              </div>
              <div style="font-size: 12px; color: #6b7280;">
                Current Score: ${latest.score} | Processes: ${latest.processesWorked} | Total Assignments: ${latest.assignments}
              </div>
            </div>
          `;
        }).join('');
      },
      
      // Execute assignment from queue
      executeAssignment: function(employeeId, processKey) {
        const badge = Object.values(STATE.badges).find(b => b.eid === employeeId);
        if (!badge) {
          alert('Employee badge not found');
          return;
        }
        
        // Move badge to the specified process
        const oldLocation = badge.loc;
        badge.loc = processKey;
        
        // Log the assignment
        ANALYTICS.logAssignment(badge.id, oldLocation, processKey);
        
        // Update DOM
        const badgeElement = document.getElementById(badge.id);
        const targetContainer = processKey === 'unassigned' ? 
          document.getElementById('unassignedStack') : 
          document.querySelector(`#tile-${processKey} .path-box`);
        
        if (badgeElement && targetContainer) {
          targetContainer.appendChild(badgeElement);
          restack(targetContainer);
          setCounts();
        }
        
        // Remove from queue
        const mgmt = STATE.analytics.rotationManagement;
        if (mgmt && mgmt.assignmentQueue) {
          mgmt.assignmentQueue = mgmt.assignmentQueue.filter(item => item.employeeId !== employeeId);
          ANALYTICS.saveAnalyticsData();
        }
        
        // Refresh queue display
        this.loadRotationQueueContent();
        
        alert(`✅ ${badge.name} assigned to ${processKey.toUpperCase()}`);
      },
      
      // Skip assignment from queue  
      skipAssignment: function(employeeId) {
        const mgmt = STATE.analytics.rotationManagement;
        if (mgmt && mgmt.assignmentQueue) {
          mgmt.assignmentQueue = mgmt.assignmentQueue.filter(item => item.employeeId !== employeeId);
          ANALYTICS.saveAnalyticsData();
          this.loadRotationQueueContent();
        }
      }
    }
  };

  // Load analytics data on startup
  ANALYTICS.loadAnalyticsData();
  // Load saved quarter snapshots if available
  try{
    const qa = localStorage.getItem('vlab:quarterAssignments');
    if (qa){ 
      const parsed = JSON.parse(qa); 
      if (parsed && typeof parsed === 'object') {
        STATE.quarterAssignments = Object.assign({Q1:{},Q2:{},Q3:{}}, parsed);
        console.log('[QUARTER] Loaded quarter assignments from localStorage:', Object.keys(STATE.quarterAssignments).map(q => `${q}:${Object.keys(STATE.quarterAssignments[q]).length}`));
      }
    }
  }catch(e){ 
    console.warn('[QUARTER] Failed to load quarter assignments:', e);
  }
  
  // Global flag to prevent auto-load during form processing
  let isFormProcessing = false;

  // Auto-load last roster and assignments on page refresh
  function autoLoadLastRoster() {
    console.log('[AUTO-LOAD] Starting auto-load process...');
    
    // Don't auto-load if we're currently processing a form submission
    if (isFormProcessing) {
      console.log('[AUTO-LOAD] Skipping auto-load - form is being processed');
      return;
    }
    
    try {
      const raw = localStorage.getItem('vlab:lastRoster');
      console.log('[AUTO-LOAD] Raw data found:', !!raw, raw ? raw.length + ' characters' : 'none');
      if (raw) {
        const snap = JSON.parse(raw);
        console.log('[AUTO-LOAD] Parsed roster data:', {
          hasBadges: !!snap.badges,
          badgeCount: snap.badges ? Object.keys(snap.badges).length : 0,
          hasSites: !!snap.sites,
          currentSite: snap.currentSite,
          hasMeta: !!snap.meta
        });
        console.log('[AUTO-LOAD] Found saved roster data, restoring assignments...');
        
        // Restore badges
        if (snap.badges) {
          console.log('[AUTO-LOAD] Restoring', Object.keys(snap.badges).length, 'badges');
          STATE.badges = snap.badges;
          
          // Debug: Count initial assignments in badges
          const initialAssigned = Object.values(STATE.badges).filter(b => b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere');
          console.log('[AUTO-LOAD] Badges with assignments found:', initialAssigned.length);
          initialAssigned.forEach(b => console.log('  -', b.name, '→', b.loc));
        }
        
        // Restore multi-site data
        if (snap.sites) {
          STATE.sites = snap.sites;
          console.log('[AUTO-LOAD] Restored site data:', STATE.sites);
          
          // Debug YDD4 assignments specifically
          if (STATE.sites.YDD4 && STATE.sites.YDD4.assignments) {
            console.log('[AUTO-LOAD] YDD4 assignments restored from localStorage:', STATE.sites.YDD4.assignments);
          }
        }
        
        // Restore current site
        if (snap.currentSite) {
          STATE.currentSite = snap.currentSite;
          // Update UI selectors
          const headerSelector = document.getElementById('headerSiteSelector');
          const formSelector = document.getElementById('site');
          if (headerSelector) headerSelector.value = snap.currentSite;
          if (formSelector) formSelector.value = snap.currentSite;
        }
        
        // Restore form data
        if (snap.meta) {
          if (snap.meta.date) {
            const dateInput = document.getElementById('date');
            if (dateInput) dateInput.value = snap.meta.date;
          }
          if (snap.meta.shift) {
            const shiftRadio = document.querySelector(`input[name="shift"][value="${snap.meta.shift}"]`);
            if (shiftRadio) shiftRadio.checked = true;
          }
          if (snap.meta.site) {
            const siteSelect = document.getElementById('site');
            if (siteSelect) siteSelect.value = snap.meta.site;
          }
          if (snap.meta.quarter) {
            STATE.currentQuarter = snap.meta.quarter;
            const quarterSelect = document.getElementById('quarter');
            if (quarterSelect) quarterSelect.value = snap.meta.quarter;
          }
        }
        
        // Restore assignments with perfect preservation across all sites
        if (STATE.sites && STATE.currentSite) {
          console.log('[AUTO-LOAD] Applying site-based filtering while preserving all assignments for:', STATE.currentSite);
          
          // First, let's try a simple approach: restore ALL badge assignments regardless of site filtering
          console.log('[AUTO-LOAD] SIMPLE RESTORE: Restoring all badge assignments from snapshot');
          let restoredCount = 0;
          Object.values(STATE.badges).forEach(badge => {
            // Get the original assignment from the snapshot
            if (badge.loc && badge.loc !== 'unassigned') {
              console.log(`[AUTO-LOAD] SIMPLE: Badge ${badge.name} has assignment: ${badge.loc}`);
              restoredCount++;
            }
          });
          console.log(`[AUTO-LOAD] SIMPLE: Found ${restoredCount} badges with assignments in snapshot`);
          
          // Now apply site filtering for visibility only (don't change assignments)
          Object.values(STATE.badges).forEach(badge => {
            const belongsToCurrentSite = MULTISITE.badgeBelongsToSite(badge, STATE.currentSite);
            badge.hidden = !belongsToCurrentSite;
            
            if (belongsToCurrentSite) {
              console.log(`[AUTO-LOAD] Badge ${badge.name} (site: ${badge.site}) visible in ${STATE.currentSite}, assignment: ${badge.loc}`);
            }
          });
          
          // LEGACY COMPLEX RESTORE (keeping for comparison)
          // Special handling for YDD2/YDD4 to ensure site-specific assignments are properly restored
          if (STATE.currentSite === 'YDD2' || STATE.currentSite === 'YDD4') {
            console.log(`[AUTO-LOAD] LEGACY YDD handling for site: ${STATE.currentSite}`);
            console.log(`[AUTO-LOAD] ${STATE.currentSite} assignments:`, STATE.sites[STATE.currentSite].assignments);
            
            // Count assignments before restoration
            const assignmentCount = Object.keys(STATE.sites[STATE.currentSite].assignments).length;
            console.log(`[AUTO-LOAD] Found ${assignmentCount} assignments for ${STATE.currentSite}`);
            
            // For YDD sites, also check site-specific assignments (but don't override badge.loc unless necessary)
            Object.values(STATE.badges).forEach(badge => {
              const belongsToCurrentSite = MULTISITE.badgeBelongsToSite(badge, STATE.currentSite);
              console.log(`[AUTO-LOAD] Badge ${badge.name} (site: ${badge.site}) belongs to ${STATE.currentSite}?`, belongsToCurrentSite);
              
              if (belongsToCurrentSite) {
                // Check if there's a site-specific assignment that differs from badge.loc
                const siteAssignment = STATE.sites[STATE.currentSite].assignments[badge.id];
                console.log(`[AUTO-LOAD] Site assignment for ${badge.name}:`, siteAssignment, 'vs current loc:', badge.loc);
                
                if (siteAssignment && siteAssignment !== badge.loc) {
                  // Override badge location with site-specific assignment
                  const oldLoc = badge.loc;
                  badge.loc = siteAssignment;
                  console.log(`[AUTO-LOAD] OVERRIDE: Restored ${badge.name} from ${oldLoc} to ${siteAssignment} for ${STATE.currentSite}`);
                  
                  // Special debugging for YDD4 restorations
                  if (STATE.currentSite === 'YDD4') {
                    console.log(`[YDD4-AUTO-LOAD] Successfully restored YDD4 assignment: ${badge.name} → ${siteAssignment}`);
                  }
                }
              }
            });
          }
          
          console.log('[AUTO-LOAD] Site filtering applied while preserving all assignments');
        }
        
        // Update display and render
        try {
          console.log('[AUTO-LOAD] Restoring badges:', Object.keys(STATE.badges).length);
          console.log('[AUTO-LOAD] Restoring sites:', Object.keys(STATE.sites || {}).length);
          
          // Count assignments for verification
          const assignedCount = Object.values(STATE.badges).filter(b => b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere').length;
          console.log('[AUTO-LOAD] Assigned badges count:', assignedCount);
          
          renderAllBadges();
          setCounts();
          updateActualHC();
          
          // Update summary display manually
          if (snap.meta) {
            const elDate = document.getElementById('displayDate');
            const elDay = document.getElementById('displayDay');
            const elShift = document.getElementById('displayShift');
            const elSite = document.getElementById('displaySite');
            
            if (elDate && snap.meta.date) elDate.textContent = snap.meta.date;
            if (elShift && snap.meta.shift) elShift.textContent = snap.meta.shift;
            if (elSite && snap.meta.site) elSite.textContent = snap.meta.site;
            
            if (elDay && snap.meta.date) {
              const dayDate = parseInputDate(snap.meta.date);
              if (dayDate) {
                const dayOfWeek = dayNames[dayDate.getDay()];
                elDay.textContent = dayOfWeek;
              }
            }
          }
          
          // Start analytics session for the restored roster
          if (snap.meta) {
            ANALYTICS.endSession(); // End any existing session
            ANALYTICS.startSession({
              date: snap.meta.date,
              shift: snap.meta.shift,
              site: snap.meta.site,
              plannedHC: snap.meta.plannedHC || 0,
              notes: 'Auto-loaded from saved roster'
            });
            console.log('[AUTO-LOAD] Started analytics session for restored roster');
          }
          
          // Display a visual confirmation of restoration
        const output = document.getElementById('output');
        if (output) {
          const assignedCount = Object.values(STATE.badges).filter(b => 
            b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere' && b.loc !== 'hidden'
          ).length;
          output.textContent = `✅ Restored board state: ${assignedCount} assignments preserved across refresh`;
          output.style.color = '#059669'; // Green color
          setTimeout(() => {
            output.textContent = '';
          }, 5000);
        }
        
        console.log('[AUTO-LOAD] Successfully restored board state');
        } catch (renderError) {
          console.error('[AUTO-LOAD] Error during render:', renderError);
        }
      }
    } catch (error) {
      console.warn('[AUTO-LOAD] Failed to auto-load roster:', error);
    }
  }
  
  // ULTRA-SIMPLE AUTO-LOAD - bypasses all complex logic
  function simpleAutoLoad() {
    console.log('[SIMPLE-AUTO-LOAD] Starting...');
    
    if (isFormProcessing) {
      console.log('[SIMPLE-AUTO-LOAD] Skipping - form processing');
      return;
    }
    
    try {
      const raw = localStorage.getItem('vlab:lastRoster');
      if (!raw) {
        console.log('[SIMPLE-AUTO-LOAD] No data');
        return;
      }
      
      const snap = JSON.parse(raw);
      console.log('[SIMPLE-AUTO-LOAD] Found data, restoring...');
      
      // Direct copy - no filtering, no complex logic
      if (snap.badges) {
        STATE.badges = snap.badges;
        console.log('[SIMPLE-AUTO-LOAD] Copied badges directly');
        
        // Debug YDD4 assignments specifically
        const ydd4Badges = Object.values(STATE.badges).filter(b => 
          b.loc !== 'unassigned' && 
          b.loc !== 'assigned-elsewhere' && 
          (b.site === 'YDD4' || b.site === 'YDD_SHARED')
        );
        console.log('[YDD4-DEBUG] Restored badges with assignments:', ydd4Badges.length);
        ydd4Badges.forEach(b => {
          console.log(`[YDD4-DEBUG] Badge ${b.id} (${b.name}): site=${b.site}, loc=${b.loc}`);
        });
      }
      
      if (snap.sites) {
        STATE.sites = snap.sites;
        console.log('[SIMPLE-AUTO-LOAD] Restored sites data');
        
        // Debug YDD4 site assignments specifically
        if (STATE.sites.YDD4) {
          const ydd4Assignments = Object.keys(STATE.sites.YDD4.assignments || {});
          console.log('[YDD4-DEBUG] Restored YDD4 site assignments:', ydd4Assignments.length);
          console.log('[YDD4-DEBUG] YDD4 assignments:', STATE.sites.YDD4.assignments);
        } else {
          console.log('[YDD4-DEBUG] No YDD4 site data found in restored state');
        }
      }
      
      if (snap.currentSite) {
        STATE.currentSite = snap.currentSite;
        console.log('[SIMPLE-AUTO-LOAD] Restored current site:', snap.currentSite);
        
        // Update selectors
        const headerSel = document.getElementById('headerSiteSelector');
        const formSel = document.getElementById('site');
        if (headerSel) headerSel.value = snap.currentSite;
        if (formSel) formSel.value = snap.currentSite;
        
        // Debug if this is YDD4
        if (snap.currentSite === 'YDD4') {
          console.log('[YDD4-DEBUG] Current site restored as YDD4');
        }
      }
      
      // Restore form data
      if (snap.meta) {
        if (snap.meta.date) {
          const dateInput = document.getElementById('date');
          if (dateInput) dateInput.value = snap.meta.date;
        }
        if (snap.meta.shift) {
          const shiftRadio = document.querySelector(`input[name="shift"][value="${snap.meta.shift}"]`);
          if (shiftRadio) shiftRadio.checked = true;
        }
        if (snap.meta.quarter) {
          STATE.currentQuarter = snap.meta.quarter;
          const quarterSelect = document.getElementById('quarter');
          if (quarterSelect) quarterSelect.value = snap.meta.quarter;
        }
      }
      
      // Minimal visibility filtering - DON'T change assignments!
      Object.values(STATE.badges).forEach(badge => {
        if (STATE.currentSite === 'YHM2') {
          badge.hidden = (badge.site !== 'YHM2');
        } else if (STATE.currentSite === 'YDD2' || STATE.currentSite === 'YDD4') {
          badge.hidden = !(badge.site === 'YDD2' || badge.site === 'YDD4' || badge.site === 'YDD_SHARED');
        } else {
          badge.hidden = false;
        }
      });
      
      // CRITICAL: Synchronize badge.loc with current site assignments
      console.log('[SIMPLE-AUTO-LOAD] Synchronizing badge locations with site assignments...');
      
      // First, reset all badges to unassigned
      Object.values(STATE.badges).forEach(badge => {
        if (badge.loc !== 'assigned-elsewhere' && badge.loc !== 'hidden') {
          badge.loc = 'unassigned';
        }
      });
      
      // Then, set badge.loc based on current site assignments
      if (STATE.sites[STATE.currentSite] && STATE.sites[STATE.currentSite].assignments) {
        Object.entries(STATE.sites[STATE.currentSite].assignments).forEach(([badgeId, location]) => {
          if (STATE.badges[badgeId]) {
            STATE.badges[badgeId].loc = location;
            console.log(`[SYNC] Set badge ${badgeId} to ${location} for site ${STATE.currentSite}`);
          }
        });
      }
      
      // Debug YDD4 synchronization specifically
      if (STATE.currentSite === 'YDD4') {
        const ydd4Assigned = Object.values(STATE.badges).filter(b => b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere' && !b.hidden);
        console.log('[YDD4-SYNC] After synchronization, YDD4 assigned badges:', ydd4Assigned.length);
        ydd4Assigned.forEach(b => {
          console.log(`[YDD4-SYNC] Badge ${b.id} (${b.name}): ${b.loc}`);
        });
      }
      
      // Render everything
      renderAllBadges();
      setCounts();
      
      // Start analytics session for the restored roster
      if (snap.meta) {
        ANALYTICS.endSession(); // End any existing session
        ANALYTICS.startSession({
          date: snap.meta.date,
          shift: snap.meta.shift,
          site: snap.meta.site,
          plannedHC: snap.meta.plannedHC || 0,
          notes: 'Auto-loaded from saved roster (simple mode)'
        });
        console.log('[SIMPLE-AUTO-LOAD] Started analytics session for restored roster');
      }
      
      const assignedCount = Object.values(STATE.badges).filter(b => 
        b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere' && !b.hidden
      ).length;
      
      console.log('[SIMPLE-AUTO-LOAD] Done - restored', assignedCount, 'assignments');
      
      const output = document.getElementById('output');
      if (output) {
        output.innerHTML = `<div style="color: #059669; font-weight: 500;">✅ Restored ${assignedCount} assignments (simple mode)</div>`;
      }
      
    } catch (error) {
      console.error('[SIMPLE-AUTO-LOAD] Error:', error);
    }
  }

  // Auto-load after a delay to ensure DOM is ready
  setTimeout(() => {
    console.log('[AUTO-LOAD] Timer triggered, using simple auto-load...');
    // Double-check that key elements are available
    const formEl = document.getElementById('laborForm');
    const unassignedEl = document.getElementById('unassignedStack');
    
    if (formEl && unassignedEl) {
      console.log('[AUTO-LOAD] DOM elements found, proceeding with simple auto-load...');
      
      // Check current STATE before auto-load
      console.log('[AUTO-LOAD] Current STATE before auto-load:');
      console.log('  - Badges:', Object.keys(STATE.badges || {}).length);
      console.log('  - Sites:', Object.keys(STATE.sites || {}).length);
      console.log('  - Current site:', STATE.currentSite);
      
      simpleAutoLoad();
    } else {
      console.warn('[AUTO-LOAD] DOM not ready, retrying in 1 second...');
      setTimeout(simpleAutoLoad, 1000);
    }
  }, 800);

  // ====== TOAST NOTIFICATION SYSTEM ======
  
  class ToastManager {
    constructor() {
      this.container = document.getElementById('toastContainer');
      this.toastId = 0;
    }
    
    show(message, type = 'success', title = null, duration = 4000) {
      const toast = this.createToast(message, type, title, duration);
      this.container.appendChild(toast);
      
      // Trigger animation
      setTimeout(() => toast.classList.add('show'), 100);
      
      // Auto remove
      setTimeout(() => this.remove(toast), duration);
      
      return toast;
    }
    
    createToast(message, type, title, duration) {
      const toastId = `toast-${++this.toastId}`;
      const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
      };
      
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.id = toastId;
      
      toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.info}</div>
        <div class="toast-content">
          ${title ? `<div class="toast-title">${title}</div>` : ''}
          <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="TOAST.remove(this.parentElement)">×</button>
      `;
      
      return toast;
    }
    
    remove(toast) {
      if (toast && toast.parentElement) {
        toast.classList.remove('show');
        setTimeout(() => {
          if (toast.parentElement) {
            toast.parentElement.removeChild(toast);
          }
        }, 300);
      }
    }
    
    success(message, title = null) {
      return this.show(message, 'success', title);
    }
    
    error(message, title = null) {
      return this.show(message, 'error', title);
    }
    
    warning(message, title = null) {
      return this.show(message, 'warning', title);
    }
    
    info(message, title = null) {
      return this.show(message, 'info', title);
    }
  }
  
  // Initialize toast manager
  const TOAST = new ToastManager();
  window.TOAST = TOAST; // Make globally available
  
  // Helper function to get display names for tiles
  function getTileDisplayName(tileKey) {
    const tileNames = {
      'cb': 'Cross Belt',
      'sort': 'Sort',
      'pack': 'Pack',
      'ps': 'Problem Solve',
      'dock': 'Dock',
      'fluid': 'Fluid',
      'tdr': 'TDR',
      'singles': 'Singles',
      'amnesty': 'Amnesty',
      'damaged': 'Damaged',
      'gift': 'Gift Wrap',
      'hazmat': 'Hazmat',
      'liquids': 'Liquids',
      'oversized': 'Oversized',
      'quality': 'Quality'
    };
    return tileNames[tileKey] || tileKey.charAt(0).toUpperCase() + tileKey.slice(1);
  }

  // ====== BULK ASSIGNMENT SYSTEM ======
  
  class BulkAssignmentManager {
    constructor() {
      this.selectedBadges = new Set();
      this.setupEventListeners();
    }
    
    setupEventListeners() {
      // Filter controls
      const nameFilter = document.getElementById('nameFilter');
      const deptFilter = document.getElementById('deptFilter');
      const shiftFilter = document.getElementById('shiftFilter');
      const clearFilters = document.getElementById('clearFilters');
      
      // Bulk action controls
      const selectAllBtn = document.getElementById('selectAllBtn');
      const clearSelectionBtn = document.getElementById('clearSelectionBtn');
      const bulkAssignBtn = document.getElementById('bulkAssignBtn');
      const bulkAssignTarget = document.getElementById('bulkAssignTarget');
      
      if (nameFilter) nameFilter.addEventListener('input', this.applyFilters.bind(this));
      if (deptFilter) deptFilter.addEventListener('change', this.applyFilters.bind(this));
      if (shiftFilter) shiftFilter.addEventListener('change', this.applyFilters.bind(this));
      if (clearFilters) clearFilters.addEventListener('click', this.clearFilters.bind(this));
      
      if (selectAllBtn) selectAllBtn.addEventListener('click', this.selectAllVisible.bind(this));
      if (clearSelectionBtn) clearSelectionBtn.addEventListener('click', this.clearSelection.bind(this));
      if (bulkAssignBtn) bulkAssignBtn.addEventListener('click', this.performBulkAssignment.bind(this));
      
      // Populate assignment targets
      this.populateAssignmentTargets();
    }
    
    populateAssignmentTargets() {
      const select = document.getElementById('bulkAssignTarget');
      if (!select) return;
      
      // Clear existing options except first
      select.innerHTML = '<option value="">Assign to...</option>';
      
      // Add tiles as options
      TILES.forEach(([tileId, tileKey]) => {
        if (tileKey) {
          const option = document.createElement('option');
          option.value = tileKey;
          option.textContent = getTileDisplayName(tileKey);
          select.appendChild(option);
        }
      });
    }
    
    populateFilterOptions() {
      const deptFilter = document.getElementById('deptFilter');
      const shiftFilter = document.getElementById('shiftFilter');
      
      if (deptFilter) {
        const departments = new Set();
        const shifts = new Set();
        
        Object.values(STATE.badges).forEach(badge => {
          if (badge.loc === 'unassigned' && !badge.hidden) {
            if (badge.eid) {
              const dept = badge.eid.toString().substring(0, 7); // First 7 digits as dept
              departments.add(dept);
            }
            if (badge.scode) shifts.add(badge.scode);
          }
        });
        
        // Clear and populate department filter
        deptFilter.innerHTML = '<option value="">All</option>';
        Array.from(departments).sort().forEach(dept => {
          const option = document.createElement('option');
          option.value = dept;
          option.textContent = dept;
          deptFilter.appendChild(option);
        });
        
        // Clear and populate shift filter
        shiftFilter.innerHTML = '<option value="">All</option>';
        Array.from(shifts).sort().forEach(shift => {
          const option = document.createElement('option');
          option.value = shift;
          option.textContent = shift;
          shiftFilter.appendChild(option);
        });
      }
    }
    
    applyFilters() {
      const nameFilter = document.getElementById('nameFilter')?.value.toLowerCase() || '';
      const deptFilter = document.getElementById('deptFilter')?.value || '';
      const shiftFilter = document.getElementById('shiftFilter')?.value || '';
      
      const badges = document.querySelectorAll('.badge');
      let visibleCount = 0;
      
      badges.forEach(badgeEl => {
        const badgeId = badgeEl.id;
        const badge = STATE.badges[badgeId];
        
        if (!badge || badge.loc !== 'unassigned' || badge.hidden) {
          badgeEl.style.display = 'none';
          return;
        }
        
        let show = true;
        
        // Name/ID filter
        if (nameFilter) {
          const name = (badge.name || '').toLowerCase();
          const eid = (badge.eid || '').toString().toLowerCase();
          show = show && (name.includes(nameFilter) || eid.includes(nameFilter));
        }
        
        // Department filter
        if (deptFilter && badge.eid) {
          const dept = badge.eid.toString().substring(0, 7);
          show = show && (dept === deptFilter);
        }
        
        // Shift filter
        if (shiftFilter) {
          show = show && (badge.scode === shiftFilter);
        }
        
        badgeEl.style.display = show ? '' : 'none';
        if (show) visibleCount++;
      });
      
      // Update counts
      this.updateSelectionUI();
    }
    
    clearFilters() {
      document.getElementById('nameFilter').value = '';
      document.getElementById('deptFilter').value = '';
      document.getElementById('shiftFilter').value = '';
      this.applyFilters();
    }
    
    selectAllVisible() {
      const visibleBadges = document.querySelectorAll('.badge:not([style*="display: none"]) .badge-checkbox');
      visibleBadges.forEach(checkbox => {
        checkbox.checked = true;
        this.selectedBadges.add(checkbox.getAttribute('data-badge-id'));
      });
      this.updateSelectionUI();
    }
    
    clearSelection() {
      this.selectedBadges.clear();
      document.querySelectorAll('.badge-checkbox').forEach(checkbox => {
        checkbox.checked = false;
      });
      this.updateSelectionUI();
    }
    
    updateSelectionUI() {
      const count = this.selectedBadges.size;
      const countEl = document.querySelector('.selected-count');
      const bulkActions = document.getElementById('bulkActions');
      
      if (countEl) countEl.textContent = `${count} selected`;
      if (bulkActions) {
        bulkActions.classList.toggle('show', count > 0);
      }
      
      // Update badge styling
      document.querySelectorAll('.badge').forEach(badgeEl => {
        const isSelected = this.selectedBadges.has(badgeEl.id);
        badgeEl.classList.toggle('selected', isSelected);
      });
    }
    
    performBulkAssignment() {
      const target = document.getElementById('bulkAssignTarget')?.value;
      if (!target || this.selectedBadges.size === 0) {
        TOAST.warning('Please select badges and a target location', 'Bulk Assignment');
        return;
      }
      
      const targetName = getTileDisplayName(target);
      const count = this.selectedBadges.size;
      
      if (!confirm(`Assign ${count} associates to ${targetName}?`)) {
        return;
      }
      
      let successCount = 0;
      
      this.selectedBadges.forEach(badgeId => {
        const badge = STATE.badges[badgeId];
        if (badge && badge.loc === 'unassigned') {
          // Perform assignment using same logic as drag-and-drop
          const currentSite = STATE.currentSite;
          
          // Remove from all sites first
          Object.keys(STATE.sites).forEach(siteCode => {
            delete STATE.sites[siteCode].assignments[badgeId];
          });
          
          // Add to current site
          STATE.sites[currentSite].assignments[badgeId] = target;
          badge.loc = target;
          
          // Save to quarter
          STATE.quarterAssignments[STATE.currentQuarter] = STATE.quarterAssignments[STATE.currentQuarter] || {};
          STATE.quarterAssignments[STATE.currentQuarter][badgeId] = target;
          
          successCount++;
        }
      });
      
      // Save state
      MULTISITE.saveToStorage();
      localStorage.setItem('vlab:quarterAssignments', JSON.stringify(STATE.quarterAssignments));
      
      // Clear selection and re-render
      this.clearSelection();
      renderAllBadges();
      setCounts();
      
      TOAST.success(`${successCount} associates assigned to ${targetName}`, 'Bulk Assignment Complete');
    }
  }
  
  // Badge selection handler
  function handleBadgeSelection(event) {
    const checkbox = event.target;
    const badgeId = checkbox.getAttribute('data-badge-id');
    
    if (checkbox.checked) {
      BULK.selectedBadges.add(badgeId);
    } else {
      BULK.selectedBadges.delete(badgeId);
    }
    
    BULK.updateSelectionUI();
  }
  
  // Initialize bulk assignment manager
  const BULK = new BulkAssignmentManager();
  window.BULK = BULK;

  // ====== ASSIGNMENT HISTORY TRACKING ======
  
  class AssignmentHistoryManager {
    constructor() {
      this.history = [];
      this.currentIndex = -1;
      this.maxHistorySize = 50;
      this.setupEventListeners();
    }
    
    setupEventListeners() {
      // Add keyboard shortcuts for undo/redo
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.undo();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
          e.preventDefault();
          this.redo();
        }
      });
    }
    
    recordAssignment(badgeId, fromLocation, toLocation, timestamp = new Date()) {
      // Don't record internal state changes
      if (fromLocation === 'assigned-elsewhere' || toLocation === 'assigned-elsewhere') return;
      
      const action = {
        type: 'assignment',
        badgeId,
        badgeName: STATE.badges[badgeId]?.name || 'Unknown',
        fromLocation,
        toLocation,
        site: STATE.currentSite,
        quarter: STATE.currentQuarter,
        timestamp,
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      };
      
      // Remove any actions after current index (for branching undo/redo)
      this.history = this.history.slice(0, this.currentIndex + 1);
      
      // Add new action
      this.history.push(action);
      this.currentIndex = this.history.length - 1;
      
      // Trim history if too large
      if (this.history.length > this.maxHistorySize) {
        this.history = this.history.slice(-this.maxHistorySize);
        this.currentIndex = this.history.length - 1;
      }
      
      console.log('[HISTORY] Recorded assignment:', action);
      this.updateUI();
    }
    
    undo() {
      if (this.currentIndex < 0) {
        TOAST.info('Nothing to undo', 'Assignment History');
        return;
      }
      
      const action = this.history[this.currentIndex];
      if (action.type === 'assignment') {
        this.revertAssignment(action);
        this.currentIndex--;
        this.updateUI();
        
        TOAST.info(`Undid: ${action.badgeName} assignment`, 'Undo');
      }
    }
    
    redo() {
      if (this.currentIndex >= this.history.length - 1) {
        TOAST.info('Nothing to redo', 'Assignment History');
        return;
      }
      
      this.currentIndex++;
      const action = this.history[this.currentIndex];
      
      if (action.type === 'assignment') {
        this.reapplyAssignment(action);
        this.updateUI();
        
        TOAST.info(`Redid: ${action.badgeName} assignment`, 'Redo');
      }
    }
    
    revertAssignment(action) {
      const { badgeId, fromLocation, site, quarter } = action;
      const badge = STATE.badges[badgeId];
      
      if (!badge) return;
      
      // Temporarily disable analytics logging
      const wasSupressed = STATE.suppressAnalytics;
      STATE.suppressAnalytics = true;
      
      // Revert the assignment
      if (fromLocation === 'unassigned') {
        // Remove from all site assignments
        Object.keys(STATE.sites).forEach(siteCode => {
          delete STATE.sites[siteCode].assignments[badgeId];
        });
        badge.loc = 'unassigned';
      } else {
        // Assign back to original location
        Object.keys(STATE.sites).forEach(siteCode => {
          delete STATE.sites[siteCode].assignments[badgeId];
        });
        
        if (STATE.sites[site]) {
          STATE.sites[site].assignments[badgeId] = fromLocation;
          badge.loc = fromLocation;
        }
      }
      
      // Update quarter assignments
      if (STATE.quarterAssignments[quarter]) {
        STATE.quarterAssignments[quarter][badgeId] = fromLocation;
      }
      
      // Save and re-render
      MULTISITE.saveToStorage();
      localStorage.setItem('vlab:quarterAssignments', JSON.stringify(STATE.quarterAssignments));
      renderAllBadges();
      setCounts();
      
      // Restore analytics state
      STATE.suppressAnalytics = wasSupressed;
    }
    
    reapplyAssignment(action) {
      const { badgeId, toLocation, site, quarter } = action;
      const badge = STATE.badges[badgeId];
      
      if (!badge) return;
      
      // Temporarily disable analytics logging
      const wasSupressed = STATE.suppressAnalytics;
      STATE.suppressAnalytics = true;
      
      // Reapply the assignment
      if (toLocation === 'unassigned') {
        Object.keys(STATE.sites).forEach(siteCode => {
          delete STATE.sites[siteCode].assignments[badgeId];
        });
        badge.loc = 'unassigned';
      } else {
        Object.keys(STATE.sites).forEach(siteCode => {
          delete STATE.sites[siteCode].assignments[badgeId];
        });
        
        if (STATE.sites[site]) {
          STATE.sites[site].assignments[badgeId] = toLocation;
          badge.loc = toLocation;
        }
      }
      
      // Update quarter assignments
      if (STATE.quarterAssignments[quarter]) {
        STATE.quarterAssignments[quarter][badgeId] = toLocation;
      }
      
      // Save and re-render
      MULTISITE.saveToStorage();
      localStorage.setItem('vlab:quarterAssignments', JSON.stringify(STATE.quarterAssignments));
      renderAllBadges();
      setCounts();
      
      // Restore analytics state
      STATE.suppressAnalytics = wasSupressed;
    }
    
    updateUI() {
      // Update any undo/redo buttons if they exist
      const undoBtn = document.getElementById('undoBtn');
      const redoBtn = document.getElementById('redoBtn');
      
      if (undoBtn) {
        undoBtn.disabled = this.currentIndex < 0;
        undoBtn.title = this.currentIndex >= 0 ? 
          `Undo: ${this.history[this.currentIndex]?.badgeName} assignment` : 
          'Nothing to undo';
      }
      
      if (redoBtn) {
        redoBtn.disabled = this.currentIndex >= this.history.length - 1;
        redoBtn.title = this.currentIndex < this.history.length - 1 ? 
          `Redo: ${this.history[this.currentIndex + 1]?.badgeName} assignment` : 
          'Nothing to redo';
      }
    }
    
    getRecentHistory(limit = 10) {
      return this.history.slice(-limit).reverse();
    }
    
    clearHistory() {
      this.history = [];
      this.currentIndex = -1;
      this.updateUI();
      TOAST.info('Assignment history cleared', 'History');
    }
  }
  
  // Initialize history manager
  const HISTORY = new AssignmentHistoryManager();
  window.HISTORY = HISTORY;

  // Debug function for YDD4 assignments
  window.debugYDD4Assignments = function() {
    console.log('=== YDD4 Assignment Debug ===');
    console.log('Current site:', STATE.currentSite);
    
    // Check badges with YDD4 assignments
    const ydd4Badges = Object.values(STATE.badges).filter(b => 
      b.loc !== 'unassigned' && 
      b.loc !== 'assigned-elsewhere' && 
      (b.site === 'YDD4' || b.site === 'YDD_SHARED')
    );
    console.log('YDD4/YDD_SHARED badges with assignments:', ydd4Badges.length);
    ydd4Badges.forEach(b => {
      console.log(`  Badge ${b.id} (${b.name}): site=${b.site}, loc=${b.loc}, hidden=${b.hidden}`);
    });
    
    // Check YDD4 site assignments
    if (STATE.sites.YDD4) {
      const ydd4SiteAssignments = Object.keys(STATE.sites.YDD4.assignments || {});
      console.log('YDD4 site assignments:', ydd4SiteAssignments.length);
      console.log('YDD4 assignments object:', STATE.sites.YDD4.assignments);
    } else {
      console.log('YDD4 site object not found');
    }
    
    // Check localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('vlab:lastRoster') || '{}');
      if (saved.sites && saved.sites.YDD4) {
        const savedYDD4 = Object.keys(saved.sites.YDD4.assignments || {});
        console.log('Saved YDD4 assignments in localStorage:', savedYDD4.length);
        console.log('Saved YDD4 assignments:', saved.sites.YDD4.assignments);
      } else {
        console.log('No YDD4 data in localStorage');
      }
    } catch (e) {
      console.log('Error reading localStorage:', e);
    }
    
    console.log('=== End YDD4 Debug ===');
  };

  window.testYDD4Persistence = function() {
    console.log('=== YDD4 Persistence Test ===');
    
    // Count current YDD4 assignments
    const currentAssignments = Object.values(STATE.badges).filter(b => 
      b.loc !== 'unassigned' && 
      b.loc !== 'assigned-elsewhere' && 
      STATE.currentSite === 'YDD4' &&
      !b.hidden
    ).length;
    
    console.log('Currently visible YDD4 assignments:', currentAssignments);
    
    if (currentAssignments === 0) {
      console.warn('❌ YDD4 assignments not visible after refresh!');
      console.log('Running full debug...');
      debugYDD4Assignments();
    } else {
      console.log('✅ YDD4 assignments are visible');
    }
  };
  
  // Debug function to test analytics
  window.debugAnalytics = function() {
    console.log('STATE.analytics:', STATE.analytics);
    console.log('ANALYTICS object:', ANALYTICS);
    console.log('PapaParse available:', typeof Papa !== 'undefined');
  };
  
  // Debug function to check localStorage
  window.debugStorage = function() {
    const raw = localStorage.getItem('vlab:lastRoster');
    if (raw) {
      const data = JSON.parse(raw);
      console.log('=== LOCALSTORAGE DEBUG ===');
      console.log('Data found:', !!data);
      console.log('Badges:', data.badges ? Object.keys(data.badges).length : 0);
      console.log('Sites:', data.sites ? Object.keys(data.sites) : []);
      console.log('Current site:', data.currentSite);
      
      if (data.badges) {
        const assigned = Object.values(data.badges).filter(b => b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere');
        console.log('Assigned badges in storage:', assigned.length);
        assigned.forEach(b => console.log('  -', b.name, '→', b.loc));
      }
      
      if (data.sites && data.currentSite && data.sites[data.currentSite]) {
        console.log('Site assignments in storage:', Object.keys(data.sites[data.currentSite].assignments || {}).length);
      }
      
      console.log('=== END DEBUG ===');
    } else {
      console.log('No roster data in localStorage');
    }
  };

  // Debug function to check site assignment isolation
  window.debugSiteAssignments = function() {
    console.group('🔍 Site Assignment Debug');
    console.log('Current site:', STATE.currentSite);
    
    Object.keys(STATE.sites || {}).forEach(siteCode => {
      const siteData = STATE.sites[siteCode];
      const assignmentCount = Object.keys(siteData.assignments || {}).length;
      console.log(`${siteCode}: ${assignmentCount} assignments`, siteData.assignments);
    });
    
    // Show visible badges for current site
    if (STATE.badges) {
      const visibleBadges = Object.values(STATE.badges).filter(badge => 
        badge.loc !== 'hidden' && MULTISITE.badgeBelongsToSite(badge, STATE.currentSite)
      );
      console.log(`Visible badges in ${STATE.currentSite}:`, visibleBadges.length);
      
      const assignedBadges = visibleBadges.filter(badge => 
        badge.loc !== 'unassigned' && badge.loc !== 'assigned-elsewhere'
      );
      console.log(`Assigned badges in ${STATE.currentSite}:`, assignedBadges.length);
      assignedBadges.forEach(badge => {
        console.log(`  - ${badge.name} (${badge.site}) → ${badge.loc}`);
      });
    }
    
    console.groupEnd();
  };
  
  // Test function to verify assignment persistence
  window.testPersistence = function() {
    console.group('🧪 Assignment Persistence Test');
    
    const totalBadges = Object.keys(STATE.badges || {}).length;
    const allAssignments = Object.values(STATE.badges || {}).filter(b => 
      b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere' && b.loc !== 'hidden'
    );
    
    console.log(`Total badges: ${totalBadges}`);
    console.log(`Total assignments: ${allAssignments.length}`);
    
    // Group assignments by site
    const assignmentsBySite = {};
    allAssignments.forEach(badge => {
      const site = badge.site || 'Unknown';
      if (!assignmentsBySite[site]) assignmentsBySite[site] = [];
      assignmentsBySite[site].push(badge);
    });
    
    Object.keys(assignmentsBySite).forEach(site => {
      console.log(`${site}: ${assignmentsBySite[site].length} assignments`);
      assignmentsBySite[site].forEach(badge => {
        console.log(`  - ${badge.name} → ${badge.loc}`);
      });
    });
    
    // Check localStorage
    const saved = localStorage.getItem('vlab:lastRoster');
    if (saved) {
      const data = JSON.parse(saved);
      const savedAssignments = Object.values(data.badges || {}).filter(b => 
        b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere' && b.loc !== 'hidden'
      );
      console.log(`Saved assignments in localStorage: ${savedAssignments.length}`);
    } else {
      console.log('No saved data in localStorage');
    }
    
    console.groupEnd();
  };

  // Debug YDD2/YDD4 assignment restoration specifically
  window.debugYDDAssignments = function() {
    console.group('🔍 YDD2/YDD4 Assignment Debug');
    
    console.log('Current site:', STATE.currentSite);
    console.log('YDD2 assignments:', STATE.sites?.YDD2?.assignments || {});
    console.log('YDD4 assignments:', STATE.sites?.YDD4?.assignments || {});
    
    // Check badge locations for YDD associates
    const yddBadges = Object.values(STATE.badges || {}).filter(b => 
      b.site === 'YDD2' || b.site === 'YDD4'
    );
    
    console.log(`Total YDD badges: ${yddBadges.length}`);
    
    yddBadges.forEach(badge => {
      const inYDD2 = STATE.sites?.YDD2?.assignments?.[badge.id];
      const inYDD4 = STATE.sites?.YDD4?.assignments?.[badge.id];
      console.log(`${badge.name} (${badge.site}): loc=${badge.loc}, YDD2=${inYDD2 || 'none'}, YDD4=${inYDD4 || 'none'}`);
    });
    
    // Check localStorage specifically for YDD assignments
    const saved = localStorage.getItem('vlab:lastRoster');
    if (saved) {
      const data = JSON.parse(saved);
      console.log('Saved YDD2 assignments:', data.sites?.YDD2?.assignments || {});
      console.log('Saved YDD4 assignments:', data.sites?.YDD4?.assignments || {});
    }
    
    console.groupEnd();
  };

  // Debug quarter assignment issues
  window.debugQuarterAssignments = function() {
    console.group('📊 Quarter Assignment Debug');
    
    console.log('Current quarter:', STATE.currentQuarter);
    console.log('Quarter assignments:', STATE.quarterAssignments);
    console.log('Quarter locks:', STATE.quarterLocks);
    
    // Check localStorage
    const saved = localStorage.getItem('vlab:quarterAssignments');
    if (saved) {
      console.log('Saved quarter assignments:', JSON.parse(saved));
    }
    
    // Check analytics history per quarter
    const historyByQuarter = {};
    STATE.analytics.history.forEach(entry => {
      const q = entry.quarter || 'Unknown';
      if (!historyByQuarter[q]) historyByQuarter[q] = [];
      historyByQuarter[q].push(entry);
    });
    
    console.log('Analytics history by quarter:');
    Object.keys(historyByQuarter).forEach(quarter => {
      console.log(`  ${quarter}: ${historyByQuarter[quarter].length} entries`);
    });
    
    // Check for duplicates
    const duplicates = STATE.analytics.history.filter((entry, index, array) => {
      return array.findIndex(e => 
        e.badgeId === entry.badgeId && 
        e.toLocation === entry.toLocation && 
        Math.abs(new Date(e.timestamp) - new Date(entry.timestamp)) < 1000
      ) !== index;
    });
    
    console.log(`Found ${duplicates.length} potential duplicates in analytics`);
    
    console.groupEnd();
  };

  // Clean up quarter assignment data
  window.fixQuarterAssignments = function() {
    console.log('🔧 Fixing quarter assignment data...');
    
    // Remove duplicates from analytics
    const uniqueHistory = [];
    const seen = new Set();
    
    STATE.analytics.history.forEach(entry => {
      const key = `${entry.badgeId}-${entry.toLocation}-${entry.timestamp}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueHistory.push(entry);
      }
    });
    
    const removedDuplicates = STATE.analytics.history.length - uniqueHistory.length;
    STATE.analytics.history = uniqueHistory;
    
    // Save cleaned data
    ANALYTICS.saveAnalyticsData();
    localStorage.setItem('vlab:quarterAssignments', JSON.stringify(STATE.quarterAssignments));
    
    console.log(`✅ Removed ${removedDuplicates} duplicates from analytics history`);
    console.log('✅ Saved cleaned quarter assignments');
  };

  // Test YDD4 assignment persistence specifically
  window.testYDD4Persistence = function() {
    console.group('🧪 YDD4 Assignment Persistence Test');
    
    // Switch to YDD4 and check assignments
    if (STATE.currentSite !== 'YDD4') {
      console.log('Switching to YDD4 to test assignments...');
      MULTISITE.switchToSite('YDD4');
    }
    
    // Count visible YDD badges and their assignments
    const visibleYDDBadges = Object.values(STATE.badges).filter(badge => 
      !badge.hidden && (badge.site === 'YDD2' || badge.site === 'YDD4')
    );
    
    const assignedYDDBadges = visibleYDDBadges.filter(badge => 
      badge.loc !== 'unassigned' && badge.loc !== 'assigned-elsewhere'
    );
    
    console.log(`Visible YDD badges in YDD4: ${visibleYDDBadges.length}`);
    console.log(`Assigned YDD badges in YDD4: ${assignedYDDBadges.length}`);
    
    // Show specific assignments
    assignedYDDBadges.forEach(badge => {
      console.log(`  ${badge.name} → ${badge.loc}`);
    });
    
    // Check if YDD4 site assignments match badge locations
    const ydd4SiteAssignments = STATE.sites?.YDD4?.assignments || {};
    const ydd4AssignmentCount = Object.keys(ydd4SiteAssignments).length;
    
    console.log(`YDD4 site assignments: ${ydd4AssignmentCount}`);
    console.log('YDD4 assignments:', ydd4SiteAssignments);
    
    // Check localStorage consistency
    const saved = localStorage.getItem('vlab:lastRoster');
    if (saved) {
      const data = JSON.parse(saved);
      const savedYDD4Assignments = data.sites?.YDD4?.assignments || {};
      console.log('Saved YDD4 assignments count:', Object.keys(savedYDD4Assignments).length);
      console.log('Saved YDD4 assignments:', savedYDD4Assignments);
    }
    
    console.groupEnd();
  };

  // --- helpers ---
  function addOverrideLog(badgeId, fromLoc, toLoc){
    const badge = STATE.badges[badgeId];
    const ts = new Date();
    const entry = {
      id: `override_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,
      timestamp: ts.toISOString(),
      date: ts.toDateString(),
      badgeId: badgeId,
      employeeId: badge ? badge.eid : undefined,
      employeeName: badge ? badge.name : undefined,
      shiftCode: badge ? badge.scode : undefined,
      site: badge ? badge.site : undefined,
      quarter: STATE.currentQuarter || 'Q1',
      fromLocation: fromLoc,
      toLocation: toLoc,
      action: 'override',
      duration: null,
      sessionId: ANALYTICS.getCurrentSessionId()
    };
    STATE.analytics.history.push(entry);
    try{ ANALYTICS.saveAnalyticsData(); }catch(_){ }
  }

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

  // Site classifier - YDD2 and YDD4 share the same associate pool
  function classifySite(row){
    const d = toNum(row['Department ID'] ?? row.DepartmentID ?? row['Dept ID']);
    const a = toNum(row['Management Area ID'] ?? row.ManagementAreaID);
    const shiftPattern = String(row['Shift Pattern'] || '').trim().toUpperCase();
    
    if (isFinite(d)){
      // YHM2 associates - inbound and DA shift patterns
      if (shiftPattern.startsWith('DA') || shiftPattern.includes('INBOUND')) {
        return 'YHM2';
      }
      
      // YDD2/YDD4 associates share the same department IDs
      // Classification will be based on site selection rather than department ID
      // since they have the same department IDs but different operations
      if ([1211010,1211020,1211030,1211040,1211070,1211080].includes(d) || 
          [1299010,1299020,1299030,1299040,1299070,1299080].includes(d)) {
        // Return 'YDD_SHARED' to indicate these can be used by both YDD2 and YDD4
        // The actual site assignment will be determined by the selected site
        return 'YDD_SHARED';
      }
    }
    
    // Default to YHM2 for any other associates
    return 'YHM2';
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
      console.log('[DEBUG] Parsing CSV file:', file.name);
      
      if (!file) {
        reject(new Error('No file provided'));
        return;
      }
      
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          console.log('[DEBUG] CSV parsing complete for', file.name, '- rows:', res.data?.length);
          if (res.errors && res.errors.length > 0) {
            console.warn('[DEBUG] CSV parsing warnings:', res.errors);
          }
          resolve(res.data || []);
        },
        error: (err) => {
          console.error('[DEBUG] CSV parsing error for', file.name, ':', err);
          reject(err);
        }
      });
    });
  }

  // Special parser for upload files that can handle tab-separated or comma-separated values
  function parseUploadFile(file){
    return new Promise((resolve, reject) => {
      console.log('[DEBUG] Parsing upload file:', file.name);
      
      if (!file) {
        reject(new Error('No file provided'));
        return;
      }

      // First, read the file as text to detect delimiter
      const reader = new FileReader();
      reader.onload = function(e) {
        const content = e.target.result;
        console.log('[DEBUG] File content preview:', content.substring(0, 200));
        const firstLine = content.split('\n')[0];
        
        // Detect if it's tab-separated or comma-separated
        const tabCount = (firstLine.match(/\t/g) || []).length;
        const commaCount = (firstLine.match(/,/g) || []).length;
        const delimiter = tabCount > commaCount ? '\t' : ',';
        
        console.log('[DEBUG] First line:', firstLine.substring(0, 100));
        console.log('[DEBUG] Tab count:', tabCount, 'Comma count:', commaCount);
        console.log('[DEBUG] Detected delimiter:', delimiter === '\t' ? 'TAB' : 'COMMA', 'in file:', file.name);

        // Parse with detected delimiter
        Papa.parse(file, {
          header: true,
          delimiter: delimiter,
          skipEmptyLines: true,
          complete: (res) => {
            console.log('[DEBUG] Upload file parsing complete for', file.name, '- rows:', res.data?.length);
            if (res.errors && res.errors.length > 0) {
              console.warn('[DEBUG] Upload file parsing warnings:', res.errors);
            }
            resolve(res.data || []);
          },
          error: (err) => {
            console.error('[DEBUG] Upload file parsing error for', file.name, ':', err);
            reject(err);
          }
        });
      };
      
      reader.onerror = function() {
        reject(new Error('Failed to read file'));
      };
      
      reader.readAsText(file);
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
    
    // Count badges, but exclude 'assigned-elsewhere' and 'hidden' from all counts
    Object.values(STATE.badges).forEach(b => { 
      if (b.loc !== 'assigned-elsewhere' && b.loc !== 'hidden') {
        counts[b.loc] = (counts[b.loc] || 0) + 1; 
      }
    });
    
    TILES.forEach(([id,key]) => {
      const el = document.getElementById(id);
      if (el){
        if (el.tagName === 'INPUT') el.value = String(counts[key] || 0);
        else el.textContent = String(counts[key] || 0);
        
        // Update capacity indicators
        updateCapacityIndicator(id, key, counts[key] || 0);
      }
    });
    
    // Count truly unassigned badges (not assigned anywhere and not hidden)
    const trulyUnassigned = Object.values(STATE.badges).filter(b => {
      if (b.loc !== 'unassigned' || b.loc === 'hidden') return false;
      // Check if assigned in any site
      return !Object.values(STATE.sites).some(site => 
        site.assignments && site.assignments[b.id]
      );
    }).length;
    
    unassignedCountEl.textContent = String(trulyUnassigned);
  }
  
  // Capacity indicator system
  function updateCapacityIndicator(tileId, tileKey, currentCount) {
    const tileElement = document.getElementById(tileId);
    if (!tileElement) return;
    
    const parentCard = tileElement.closest('.board-card');
    if (!parentCard) return;
    
    // Remove existing indicator
    const existingIndicator = parentCard.querySelector('.capacity-indicator');
    if (existingIndicator) existingIndicator.remove();
    
    // Get target count from input
    const targetInput = parentCard.querySelector('.board-count-input');
    const targetCount = targetInput ? parseInt(targetInput.value) || 0 : 0;
    
    if (targetCount === 0) return; // No indicator if no target set
    
    // Create indicator
    const indicator = document.createElement('div');
    indicator.className = 'capacity-indicator';
    
    let status = '';
    let icon = '';
    
    if (currentCount === targetCount) {
      status = 'optimal';
      icon = '✓';
    } else if (currentCount > targetCount) {
      status = 'over-capacity';
      icon = '⚠';
    } else {
      status = 'under-capacity';
      icon = '!';
    }
    
    indicator.classList.add(status);
    indicator.innerHTML = `
      <span class="capacity-icon">${icon}</span>
      <span>${currentCount}/${targetCount}</span>
    `;
    
    // Position relative to parent card
    parentCard.style.position = 'relative';
    parentCard.appendChild(indicator);
  }

  function makeDropTarget(container, key){
    // container is the element that will receive dropped badges (.path-box or #unassignedStack)
    container.addEventListener('dragover', (e) => { 
      e.preventDefault(); 
      container.classList && container.classList.add('ring','ring-indigo-300');
      console.log(`[DEBUG] Drag over target: ${key}`);
    });
    container.addEventListener('dragleave', () => { container.classList && container.classList.remove('ring','ring-indigo-300'); });
    container.addEventListener('drop', (e) => {
      e.preventDefault(); container.classList && container.classList.remove('ring','ring-indigo-300');
      // If quarter is locked, ask if user wants to override
      let isOverride = false;
      if (STATE.quarterLocks && STATE.quarterLocks[STATE.currentQuarter]){
        const ok = confirm(`Quarter ${STATE.currentQuarter} is locked. Override previous assignments with this change?`);
        if (!ok) return;
        isOverride = true;
      }
      const payload = e.dataTransfer.getData('text/plain');
      console.log(`[DEBUG] Drop payload: "${payload}"`);
      if (!payload) {
        console.log('[DEBUG] No payload found in drop event');
        return;
      }
      // payload may be employee id (preferred) or DOM id
      let node = document.getElementById(payload) || document.querySelector(`.badge[data-id="${payload}"]`);
      console.log(`[DEBUG] Found node:`, node);
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
      if (!node) {
        console.log('[DEBUG] No node found for payload:', payload);
        return; // unknown drag payload
      }
      if (!badgeId || !STATE.badges[badgeId]) {
        console.log('[DEBUG] Invalid badgeId or missing badge:', badgeId, !!STATE.badges[badgeId]);
        return;
      }
      
      // Track assignment change for analytics
      const oldLocation = STATE.badges[badgeId].loc;
      const newLocation = key || 'unassigned';
      
      // Conflict Detection - Check for duplicate assignments
      if (newLocation !== 'unassigned') {
        const conflictBadges = Object.values(STATE.badges).filter(b => 
          b.id !== badgeId && 
          b.loc === newLocation && 
          !b.hidden &&
          b.site === STATE.badges[badgeId].site
        );
        
        if (conflictBadges.length > 0) {
          const conflictNames = conflictBadges.map(b => b.name).join(', ');
          const tileName = getTileDisplayName(newLocation);
          
          TOAST.warning(
            `${conflictNames} already assigned to ${tileName}. Consider redistributing assignments.`,
            'Assignment Conflict Detected'
          );
        }
      }
      
      // Multi-site assignment logic
      const isUploadedBadge = STATE.badges[badgeId].isUploaded;
      console.log(`[DEBUG] Processing drop for badge ${badgeId}, isUploaded: ${isUploadedBadge}, oldLoc: ${oldLocation}, newLoc: ${newLocation}`);
      
      if (newLocation === 'unassigned') {
        // Remove from ALL site assignments (badge becomes globally unassigned)
        Object.keys(STATE.sites).forEach(siteCode => {
          delete STATE.sites[siteCode].assignments[badgeId];
        });
        STATE.badges[badgeId].loc = 'unassigned';
        console.log(`[MULTISITE] Badge ${badgeId} moved to global unassigned pool`);
      } else {
        // Ensure current site is properly synchronized before assignment
        MULTISITE.ensureCurrentSiteSync();
        const currentSite = STATE.currentSite;
        console.log(`[DEBUG] Assigning to site: ${currentSite}, location: ${newLocation}`);
        
        // Check if badge was assigned elsewhere for logging
        const previousSiteAssignment = Object.keys(STATE.sites).find(siteCode => 
          siteCode !== currentSite && STATE.sites[siteCode].assignments[badgeId]
        );
        
        // Remove from ALL sites first (ensures one assignment per associate)
        Object.keys(STATE.sites).forEach(siteCode => {
          delete STATE.sites[siteCode].assignments[badgeId];
        });
        
        // Add to current site
        STATE.sites[currentSite].assignments[badgeId] = newLocation;
        STATE.badges[badgeId].loc = newLocation;
        
        // Enhanced logging for cross-site moves
        if (previousSiteAssignment) {
          console.log(`[MULTISITE] Cross-site move: badge ${badgeId} moved from ${previousSiteAssignment} to ${currentSite}/${newLocation}`);
        } else {
          console.log(`[MULTISITE] New assignment: badge ${badgeId} assigned to ${currentSite}/${newLocation}`);
        }
        
        // Special debugging for YDD4 assignments
        if (currentSite === 'YDD4') {
          console.log(`[YDD4-DEBUG] Assignment made - Badge: ${badgeId}, Location: ${newLocation}`);
          console.log(`[YDD4-DEBUG] YDD4 assignments now:`, STATE.sites.YDD4.assignments);
          console.log(`[YDD4-DEBUG] Badge loc set to:`, STATE.badges[badgeId].loc);
        }
      }
      
      // Save change into current quarter snapshot
      try{
        STATE.quarterAssignments[STATE.currentQuarter] = STATE.quarterAssignments[STATE.currentQuarter] || {};
        STATE.quarterAssignments[STATE.currentQuarter][badgeId] = newLocation;
        // Save quarter assignments to localStorage immediately
        localStorage.setItem('vlab:quarterAssignments', JSON.stringify(STATE.quarterAssignments));
      }catch(_){ }
      
      // Log the assignment (override when applicable)
      // Only log actual user-initiated assignments, not internal state changes
      if (!STATE.suppressAnalytics && newLocation !== 'assigned-elsewhere' && oldLocation !== 'assigned-elsewhere') {
        const logLocation = newLocation === 'unassigned' ? newLocation : `${STATE.currentSite}/${newLocation}`;
        const logOldLocation = oldLocation === 'unassigned' ? oldLocation : `${STATE.currentSite}/${oldLocation}`;
        
        if (isOverride) addOverrideLog(badgeId, logOldLocation, logLocation);
        else ANALYTICS.logAssignment(badgeId, logOldLocation, logLocation);
        
        // Record in history for undo/redo
        HISTORY.recordAssignment(badgeId, oldLocation, newLocation);
      }
      
      // Save multi-site state to localStorage
      MULTISITE.saveToStorage();
      
      // Show toast notification for assignment
      const badge = STATE.badges[badgeId];
      if (badge) {
        if (newLocation === 'unassigned') {
          TOAST.info(`${badge.name} moved to unassigned pool`, 'Assignment Updated');
        } else {
          const tileName = getTileDisplayName(newLocation);
          const siteDisplay = STATE.currentSite;
          TOAST.success(`${badge.name} assigned to ${tileName}`, `${siteDisplay} Assignment`);
        }
      }
      
      // Also save a complete roster snapshot to ensure ALL assignments persist across refreshes
      try {
        const snap = {
          badges: STATE.badges,
          sites: STATE.sites,
          currentSite: STATE.currentSite,
          meta: {
            date: document.getElementById('date')?.value || '',
            shift: document.querySelector('input[name="shift"]:checked')?.value || 'day',
            site: STATE.currentSite,
            quarter: STATE.currentQuarter || 'Q1'
          }
        };
        localStorage.setItem('vlab:lastRoster', JSON.stringify(snap));
        console.log('[DRAG-DROP] Saved complete roster snapshot with ALL assignments after assignment change');
        
        // Debug: Count total assignments being saved
        const totalAssigned = Object.values(STATE.badges).filter(b => 
          b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere' && b.loc !== 'hidden'
        ).length;
        console.log('[DRAG-DROP] Total assignments saved:', totalAssigned);
      } catch (saveError) {
        console.warn('[DRAG-DROP] Failed to save roster snapshot:', saveError);
      }
      
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
    let badgeClasses = `badge ${(p.scode||'').trim()}`;
    if (p.isUploaded) badgeClasses += ' uploaded';
    wrap.className = badgeClasses.trim();
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

    // Add selection checkbox (only for unassigned badges)
    if (p.loc === 'unassigned') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'badge-checkbox';
      checkbox.setAttribute('data-badge-id', p.id);
      checkbox.addEventListener('change', handleBadgeSelection);
      wrap.appendChild(checkbox);
    }

    // upload indicator (for uploaded associates)
    if (p.isUploaded) {
      const uploadIndicator = document.createElement('div');
      uploadIndicator.className = 'upload-indicator';
      uploadIndicator.textContent = '📤';
      uploadIndicator.style.cssText = `
        position: absolute;
        top: 4px;
        right: 4px;
        font-size: 12px;
        background: #3b82f6;
        color: white;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        z-index: 10;
      `;
      uploadIndicator.title = 'Uploaded associate';
      wrap.appendChild(uploadIndicator);
    }

    // presence tick (right)
    const tick = document.createElement('div'); tick.className = 'tick'; tick.textContent = '✓';
    if (!p.present) tick.style.display = 'none';
    wrap.appendChild(tick);

    // rotation status indicator
    if (ANALYTICS.ROTATION && p.eid) {
      const rotationScore = ANALYTICS.ROTATION.calculateRotationScore(p.eid);
      if (rotationScore && rotationScore.status) {
        const rotationIndicator = document.createElement('div');
        rotationIndicator.className = 'rotation-indicator';
        
        const rotationConfig = {
          'excellent': { icon: '🌟', color: '#059669', title: 'Excellent rotation variety' },
          'good': { icon: '✨', color: '#10b981', title: 'Good rotation balance' },
          'needs_improvement': { icon: '⚠️', color: '#f59e0b', title: 'Needs more variety' },
          'poor': { icon: '🔄', color: '#dc2626', title: 'Limited rotation - needs variety' }
        };
        
        const config = rotationConfig[rotationScore.status] || rotationConfig['good'];
        rotationIndicator.textContent = config.icon;
        rotationIndicator.style.cssText = `
          position: absolute;
          bottom: 4px;
          left: 4px;
          font-size: 10px;
          background: white;
          border-radius: 50%;
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          z-index: 10;
        `;
        rotationIndicator.title = `${config.title} (Score: ${rotationScore.score})`;
        wrap.appendChild(rotationIndicator);
      }
    }

    // drag payload uses employee id when possible
    wrap.addEventListener('dragstart', (e) => {
      const emp = String(p.eid || p.id || '');
      console.log(`[DEBUG] Drag started for badge ${p.name} (${emp})`);
      console.log(`[DEBUG] Badge data:`, { id: p.id, eid: p.eid, name: p.name, loc: p.loc });
      try{ 
        e.dataTransfer.setData('text/plain', emp);
        console.log(`[DEBUG] Set drag payload: "${emp}"`);
      }catch(err){ 
        console.log(`[DEBUG] Drag error:`, err);
        e.dataTransfer.setData('text/plain', p.id); 
      }
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

    // Debug YDD4 rendering
    if (STATE.currentSite === 'YDD4') {
      console.log('[YDD4-RENDER] Starting renderAllBadges for YDD4');
      const ydd4Assignments = STATE.sites.YDD4 ? Object.keys(STATE.sites.YDD4.assignments || {}) : [];
      console.log('[YDD4-RENDER] YDD4 site assignments to render:', ydd4Assignments.length);
    }

    // Check if badge is assigned in ANY site (not just current site)
    const isAssignedAnywhere = (badgeId) => {
      const assigned = Object.values(STATE.sites).some(site => 
        site.assignments && site.assignments[badgeId]
      );
      return assigned;
    };

    // Render unassigned as a compact list in the left panel (preview), and full list in overlay when open.
    const overlayOpen = !!document.getElementById('unassignedOverlay');
    const unassigned = Object.values(STATE.badges).filter(b => 
      b.loc === 'unassigned' && !isAssignedAnywhere(b.id) && b.loc !== 'hidden'
    );
    const previewCount = overlayOpen ? Infinity : 6;
    let rendered = 0;

    Object.values(STATE.badges).forEach(b => {
      // Debug YDD4 badges specifically
      if (STATE.currentSite === 'YDD4' && (b.site === 'YDD4' || b.site === 'YDD_SHARED') && b.loc !== 'unassigned') {
        console.log(`[YDD4-RENDER] Processing badge ${b.id} (${b.name}): loc=${b.loc}, hidden=${b.hidden}, site=${b.site}`);
        const isAssigned = isAssignedAnywhere(b.id);
        console.log(`[YDD4-RENDER] Badge ${b.id} isAssignedAnywhere: ${isAssigned}`);
        if (STATE.sites.YDD4 && STATE.sites.YDD4.assignments[b.id]) {
          console.log(`[YDD4-RENDER] Badge ${b.id} found in YDD4 assignments:`, STATE.sites.YDD4.assignments[b.id]);
        }
      }
      
      // Skip hidden badges (not for current site)
      if (b.loc === 'hidden') return;
      
      // Only show as unassigned if not assigned anywhere
      if (b.loc === 'unassigned' && !isAssignedAnywhere(b.id)){
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
      } else if (b.loc !== 'assigned-elsewhere' && b.loc !== 'hidden') {
        // Only render if assigned to current site (not assigned elsewhere or hidden)
        const node = renderBadge(b);
        if (b.present){ node.classList.add('present'); const t = document.createElement('div'); t.className='tick'; t.textContent='✓'; node.appendChild(t); }
        tileBadgeLayers[b.loc]?.appendChild(node);
      }
      // Skip rendering badges that are assigned-elsewhere
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
    
    // Update filter options and apply current filters
    if (typeof BULK !== 'undefined') {
      BULK.populateFilterOptions();
      BULK.applyFilters();
    }
  }

  // change preview
  form.addEventListener('change', () => {
    const date = form.date.value;
    const shift = form.querySelector('input[name="shift"]:checked')?.value || 'day';
    const d = parseInputDate(date);
    if (!d){ elType.textContent = '-'; return; }
    elType.textContent = shiftTypeMap[shift][d.getDay()];
  });

  // Multi-site switching functionality - both form and header selectors
  const setupSiteSwitching = function() {
    const formSiteSelect = document.getElementById('site');
    const headerSiteSelect = document.getElementById('headerSiteSelector');
    
    const handleSiteSwitch = (newSite) => {
      // Only proceed if we have existing badges (board is already loaded)
      if (Object.keys(STATE.badges).length === 0) return;
      
      console.log('[MULTISITE] Switching to site:', newSite);
      MULTISITE.switchToSite(newSite);
    };
    
    // Form site selector handler
    formSiteSelect?.addEventListener('change', (e) => {
      handleSiteSwitch(e.target.value);
    });
    
    // Header site selector handler  
    headerSiteSelect?.addEventListener('change', (e) => {
      handleSiteSwitch(e.target.value);
    });
  };
  
  // Initialize site switching after DOM is ready
  setupSiteSwitching();
  
  // Ensure header site selector is synchronized with form on page load
  const initializeHeaderSiteSelector = function() {
    const formSite = document.getElementById('site')?.value;
    const headerSite = document.getElementById('headerSiteSelector');
    
    if (formSite && headerSite && headerSite.value !== formSite) {
      headerSite.value = formSite;
      STATE.currentSite = formSite;
      console.log('[MULTISITE] Initialized header selector to match form:', formSite);
    }
  };
  
  // Initialize on DOM ready
  setTimeout(initializeHeaderSiteSelector, 100);

  // Button event handlers
  const loadLastBtn = document.getElementById('loadLastBtn');
  const clearSavedBtn = document.getElementById('clearSavedBtn');
  
  // Load last roster button
  if (loadLastBtn) {
    loadLastBtn.addEventListener('click', () => {
      simpleAutoLoad();
      output.textContent = 'Loaded last saved roster and assignments (simple mode).';
      
      // Ensure analytics session is started
      try {
        const raw = localStorage.getItem('vlab:lastRoster');
        if (raw) {
          const snap = JSON.parse(raw);
          if (snap.meta) {
            ANALYTICS.endSession();
            ANALYTICS.startSession({
              date: snap.meta.date,
              shift: snap.meta.shift,
              site: snap.meta.site,
              plannedHC: snap.meta.plannedHC || 0,
              notes: 'Manually loaded roster'
            });
            console.log('[LOAD-ROSTER] Started analytics session');
          }
        }
      } catch (error) {
        console.warn('[LOAD-ROSTER] Failed to start analytics session:', error);
      }
    });
  }
  
  // Clear Board button
  if (clearSavedBtn) {
    clearSavedBtn.addEventListener('click', () => {
      if (confirm('Clear all assignments and move everyone back to unassigned?')) {
        // Clear all assignments
        Object.values(STATE.badges).forEach(badge => {
          badge.loc = 'unassigned';
        });
        
        // Clear multi-site assignments
        Object.keys(STATE.sites).forEach(siteCode => {
          STATE.sites[siteCode].assignments = {};
        });
        
        // Save the cleared state
        MULTISITE.saveToStorage();
        
        // Re-render the board
        renderAllBadges();
        setCounts();
        
        // Log the board clear action
        ANALYTICS.logAssignment(null, 'Board Clear', 'All Unassigned');
        
        output.textContent = 'Board cleared - all associates moved to unassigned.';
        console.log('[CLEAR-BOARD] All assignments cleared');
      }
    });
  }

  // Undo/Redo buttons
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      HISTORY.undo();
    });
  }
  
  if (redoBtn) {
    redoBtn.addEventListener('click', () => {
      HISTORY.redo();
    });
  }

  // submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    
    // Set flag to prevent auto-load during form processing
    isFormProcessing = true;
    console.log('[FORM] Form processing started, preventing auto-load');
    
    console.log('[DEBUG] Form submission started');
    console.log('[DEBUG] Form element:', form);
    console.log('[DEBUG] Form files - roster:', form.roster?.files, 'missing:', form.missing?.files);
    output.textContent = 'Processing files…';

    const rosterFile = form.roster.files[0];
    const missingFile = form.missing.files[0] || null;
    
    // Allow upload-only processing or require roster + additional roster
    if (!rosterFile && !missingFile){ 
      output.textContent = 'Please select at least a Roster File or Additional Roster file to proceed.'; 
      console.warn('[DEBUG] No files selected');
      return; 
    }
    
    console.log('[DEBUG] Roster file selected:', rosterFile.name, 'size:', rosterFile.size);
    
    console.log('[DEBUG] Upload file:', missingFile ? `${missingFile.name} (${missingFile.size} bytes)` : 'None selected');

    // Check if Papa Parse is available
    if (typeof Papa === 'undefined') {
      output.textContent = 'Error: CSV parser not loaded. Please refresh the page.';
      console.error('[DEBUG] PapaParse library not available');
      return;
    }

    console.log('[DEBUG] Starting CSV parsing...');
    console.log('[DEBUG] Files to parse:', {
      roster: rosterFile?.name,
      additional: missingFile?.name
    });
    
    Promise.all([
      rosterFile ? parseCsv(rosterFile).catch(err => { console.error('[DEBUG] Roster parsing error:', err); return []; }) : Promise.resolve([]),
      missingFile ? parseCsv(missingFile).catch(err => { console.error('[DEBUG] Additional roster parsing error:', err); return []; }) : Promise.resolve([]),
    ]).then(([roster, additional]) => {
      console.debug('[build] rosterFile=', rosterFile && rosterFile.name, 'size=', rosterFile && rosterFile.size);
      console.debug('[build] parsed roster rows=', Array.isArray(roster) ? roster.length : typeof roster, roster && roster[0]);
      console.debug('[DEBUG] Additional roster parsed:', Array.isArray(additional) ? additional.length : typeof additional, additional && additional[0]);
  const siteSel = form.site.value;
  const quarterSel = (quarterSelect && quarterSelect.value) || 'Q1';
      
      // Initialize current site early for proper analytics tracking
      STATE.currentSite = siteSel;
      console.log('[DEBUG] Setting current site to:', siteSel);
      
      const dateStr = form.date.value;
      const shiftSel = form.querySelector('input[name="shift"]:checked')?.value || 'day';
      const d = parseInputDate(dateStr); const dow = d?.getDay() ?? 0;
      elDate.textContent = dateStr || '-';
      elDay.textContent = d ? shortDay[dow] : '-';
      elShift.textContent = shiftSel[0].toUpperCase() + shiftSel.slice(1);
      elType.textContent = shiftTypeMap[shiftSel][dow];
  elSite.textContent = siteSel;
  STATE.currentQuarter = quarterSel;

      const allowed = new Set(getAllowedCodes(dateStr, shiftSel));
      if (allowed.size){ codesBar.classList.remove('hidden'); codesBar.textContent = `Codes active for ${dayNames[dow]} (${elShift.textContent}): ${[...allowed].sort().join(', ')}`; }
      else { codesBar.classList.add('hidden'); codesBar.textContent = ''; }

      // Process additional roster associates and merge with main roster
      let combinedRoster = Array.isArray(roster) ? [...roster] : [];
      const uploadedEmployeeIds = new Set(); // Track which employees came from additional file
      
      console.log(`[DEBUG] Initial roster size: ${combinedRoster.length}`);
      console.log(`[DEBUG] Additional roster data:`, additional);
      
      if (Array.isArray(additional) && additional.length > 0) {
        console.log(`[DEBUG] Processing ${additional.length} additional associates`);
        
        // Add additional associates to the roster with normalized headers
        additional.forEach(additionalPerson => {
          // Use same format as roster - simple normalization
          const normalizedPerson = {
            'Employee ID': additionalPerson['Employee ID'] || additionalPerson['ID'] || additionalPerson['EID'] || '',
            'Employee Name': additionalPerson['Employee Name'] || additionalPerson['Name'] || additionalPerson['Full Name'] || '',
            'Employee Status': additionalPerson['Employee Status'] || additionalPerson['Status'] || 'Active',
            'Shift Pattern': additionalPerson['Shift Pattern'] || additionalPerson['ShiftCode'] || additionalPerson['Shift Code'] || additionalPerson['Shift'] || '',
            'Department ID': additionalPerson['Department ID'] || additionalPerson['DepartmentID'] || additionalPerson['Dept ID'] || '',
            'Management Area ID': additionalPerson['Management Area ID'] || additionalPerson['ManagementAreaID'] || '',
            'User ID': additionalPerson['User ID'] || additionalPerson['UserID'] || '',
            'Badge Barcode ID': additionalPerson['Badge Barcode ID'] || additionalPerson['Barcode'] || '',
            '_isUploaded': true // Mark as uploaded
          };
          
          // Only add if not already in roster (check by Employee ID)
          const existingEmployee = combinedRoster.find(existing => 
            (existing['Employee ID'] || existing['ID'] || existing['EID']) === normalizedPerson['Employee ID']
          );
          
          if (!existingEmployee && normalizedPerson['Employee ID']) {
            combinedRoster.push(normalizedPerson);
            uploadedEmployeeIds.add(normalizedPerson['Employee ID']);
            console.log(`[DEBUG] Added uploaded associate: ${normalizedPerson['Employee Name']} (${normalizedPerson['Employee ID']})`);
          } else if (existingEmployee) {
            console.log(`[DEBUG] Skipped duplicate: ${normalizedPerson['Employee Name']} (${normalizedPerson['Employee ID']})`);
          }
        });
        
        console.log(`[DEBUG] Combined roster now has ${combinedRoster.length} total employees`);
        console.log(`[DEBUG] Uploaded employee IDs:`, Array.from(uploadedEmployeeIds));
        
        // Show sample of combined data
        const uploadedInCombined = combinedRoster.filter(r => r['_isUploaded'] === true);
        console.log(`[DEBUG] Uploaded associates in combined roster:`, uploadedInCombined.length, uploadedInCombined);
      }

      const activeRows = combinedRoster.filter(r => String(r['Employee Status'] ?? r.Status ?? '').toLowerCase() === 'active');

      if (combinedRoster.length > 0 && filteredPreviewNeeded(combinedRoster, activeRows)){
        // if parsing succeeded but no "active" rows found, give immediate guidance
        const keys = combinedRoster[0] ? Object.keys(combinedRoster[0]) : [];
        output.textContent = `Parsed ${combinedRoster.length} rows (${missing.length || 0} added from upload file). No active rows matched filters. Detected headers: ${keys.join(', ')}.`;
        console.warn('[build] no active rows after filtering; headers=', keys);
      }
  const filtered = activeRows.filter(r => {
        const site = classifySite(r);
        const sc = shiftCodeOf(r['Shift Pattern'] ?? r['ShiftCode'] ?? r['Shift Code'] ?? r['Shift'] ?? r['Pattern']);
        const isUploaded = r['_isUploaded'] === true;
        
        if (isUploaded) {
          console.log(`[DEBUG] Filtering uploaded associate:`, {
            name: r['Employee Name'],
            id: r['Employee ID'],
            deptId: r['Department ID'],
            mgmtArea: r['Management Area ID'],
            classifiedSite: site,
            selectedSite: siteSel,
            shiftCode: sc,
            shiftPattern: r['Shift Pattern']
          });
        }
        
        // Site filtering: YHM2 is separate, YDD2/YDD4 share associate pool
        if (siteSel === 'YHM2' && site !== 'YHM2') return false;
        if ((siteSel === 'YDD2' || siteSel === 'YDD4') && (site !== 'YHM2' && site !== 'YDD_SHARED')) return false;
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
      const uploadedInFiltered = filtered.filter(r => r['_isUploaded'] === true).length;
      console.log(`[DEBUG] After filtering: ${baseHC} total, ${uploadedInFiltered} uploaded associates`);
      
      // Site summary for clarity
      console.log(`[SITE-FILTER] Selected site: ${siteSel}`);
      console.log(`[SITE-FILTER] Associates loaded for ${siteSel}: ${baseHC} (${uploadedInFiltered} from upload)`);
      
      // Debug: Show what was filtered out
      const totalBeforeFilter = combinedRoster.length;
      const filteredOutCount = totalBeforeFilter - baseHC;
      if (filteredOutCount > 0) {
        console.log(`[SITE-FILTER] Filtered out ${filteredOutCount} associates not matching ${siteSel} criteria`);
        
        // Show breakdown of filtered associates by site
        const siteBreakdown = {};
        combinedRoster.forEach(r => {
          const site = classifySite(r);
          siteBreakdown[site] = (siteBreakdown[site] || 0) + 1;
        });
        console.log(`[SITE-FILTER] Site breakdown in roster:`, siteBreakdown);
      }
      
      const plannedHC = baseHC - swapOUT + swapIN + vet - vto + lsIN - lsOUT;
      elPlan.textContent = String(plannedHC); elActual.textContent = '0';

  STATE.badges = {};
      filtered.forEach((r, idx) => {
        const name = String(r['Employee Name'] ?? r['Name'] ?? r['Full Name'] ?? '').trim();
        const eid  = String(r['Employee ID'] ?? r['ID'] ?? r['EID'] ?? r['Employee Number'] ?? '').trim();
        const sc   = shiftCodeOf(r['Shift Pattern'] ?? r['ShiftCode'] ?? r['Shift Code'] ?? r['Shift'] ?? r['Pattern']);
        const classifiedSite = classifySite(r); // Get the actual classified site for this associate
        
        // For YDD_SHARED associates, assign them to the currently selected site (YDD2 or YDD4)
        const actualSite = classifiedSite === 'YDD_SHARED' ? siteSel : classifiedSite;
        
        const barcode = String(r['Badge Barcode ID'] ?? r['Barcode'] ?? r['Badge'] ?? r['Employee Login'] ?? r['Username'] ?? '').trim();
        const handle = String(r['User ID'] ?? r['Handle'] ?? r['Employee Handle'] ?? r['Login'] ?? '').trim();
        const photo = String(r['Photo'] ?? r['Photo URL'] ?? r['Image'] ?? '').trim();
        const id   = `b_${eid || idx}_${Math.random().toString(36).slice(2,8)}`;
        const isUploaded = r['_isUploaded'] === true; // Check if this came from upload
        STATE.badges[id] = { id, name, eid, scode: sc, site: actualSite, present:false, loc:'unassigned', barcode, handle, photo, isUploaded };
      });

      if (Object.keys(STATE.badges).length === 0){
        output.textContent = 'No badges created — check CSV headers and active status field.';
        console.warn('[build] no badges in STATE.badges');
      }
  // Ensure multi-site state is properly initialized
      try {
        MULTISITE.ensureCurrentSiteSync();
        console.log('[DEBUG] Multi-site state synchronized');
      } catch(err) {
        console.warn('[DEBUG] Multi-site sync warning:', err);
      }
      
      renderAllBadges();
      // Snapshot initial quarter state (preserve existing assignments)
      try{ 
        STATE.quarterAssignments[STATE.currentQuarter] = STATE.quarterAssignments[STATE.currentQuarter] || {}; 
        Object.values(STATE.badges).forEach(b => { 
          STATE.quarterAssignments[STATE.currentQuarter][b.id] = b.loc; 
        }); 
      }catch(_){ }
      setupVPH(plannedHC);
      
      // Show site-specific summary in output
      const siteMessage = `✅ Loaded ${baseHC} associates for ${siteSel}` + 
        (uploadedInFiltered > 0 ? ` (${uploadedInFiltered} from additional roster)` : '');
      output.innerHTML = `<div style="color: #059669; font-weight: 500;">${siteMessage}</div>`;
      
      console.log('[BUILD-COMPLETE] Board ready with site-filtered associates');

      // Start analytics session
      ANALYTICS.endSession(); // End any existing session
      const additionalCount = additional.length || 0;
      const sessionNotes = additionalCount > 0 
        ? `Roster: ${rosterFile.name} + ${additionalCount} additional associates, Badges: ${Object.keys(STATE.badges).length}`
        : `Roster: ${rosterFile.name}, Badges: ${Object.keys(STATE.badges).length}`;
        
      ANALYTICS.startSession({
        date: dateStr,
        shift: shiftSel,
        site: siteSel,
        plannedHC: plannedHC,
        notes: sessionNotes
      });
      
      if (missingCount > 0) {
        console.log(`[SUCCESS] Loaded ${Object.keys(STATE.badges).length} badges including ${missingCount} from upload file`);
      }

      // persist compact snapshot so user can reload without re-uploading CSV
      try{
        // Initialize current site to the selected site from form
        STATE.currentSite = siteSel;
        
        // Save current assignments before creating snapshot
        MULTISITE.saveCurrentSiteAssignments();
        
        const snap = { 
          badges: STATE.badges, 
          sites: STATE.sites,
          currentSite: STATE.currentSite,
          meta: { date: dateStr, shift: shiftSel, site: siteSel, plannedHC, quarter: STATE.currentQuarter } 
        };
        
        // Debug: Log what we're saving
        const assignedBadges = Object.values(STATE.badges).filter(b => b.loc !== 'unassigned');
        const siteAssignmentCount = STATE.sites[STATE.currentSite] ? Object.keys(STATE.sites[STATE.currentSite].assignments).length : 0;
        console.debug('[save] Saving roster with', assignedBadges.length, 'assigned badges and', siteAssignmentCount, 'site assignments');
        
        localStorage.setItem('vlab:lastRoster', JSON.stringify(snap));
        console.debug('[save] saved roster snapshot with multi-site data to localStorage (vlab:lastRoster)');
        
        // Clear form processing flag
        isFormProcessing = false;
        console.log('[FORM] Form processing completed, auto-load re-enabled');
      }catch(_){ /* ignore storage failures */ }
    }).catch(err => { 
      console.error('[DEBUG] Form submission error:', err); 
      output.textContent = `Error processing files: ${err.message || err}. Please check CSV headers and try again.`;
      
      // Clear form processing flag even on error
      isFormProcessing = false;
      console.log('[FORM] Form processing failed, auto-load re-enabled');
    });
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

  // Analytics Dashboard Management
  const analyticsModal = document.getElementById('analyticsModal');
  const analyticsBtn = document.getElementById('analyticsBtn');
  const closeAnalyticsBtn = document.getElementById('closeAnalyticsBtn');
  const exportAnalyticsBtn = document.getElementById('exportAnalyticsBtn');
  const clearAnalyticsBtn = document.getElementById('clearAnalyticsBtn');

  // Analytics tab management
  const analyticsTabs = document.querySelectorAll('.analytics-tab');
  const analyticsTabContents = document.querySelectorAll('.analytics-tab-content');
  const analyticsSearchInput = document.getElementById('analyticsSearchInput');
  const analyticsSearchResults = document.getElementById('analyticsSearchResults');
  
  // ----- Quarter helpers -----
  function nextProcessKey(key){
    const ring = TILES.map(t => t[1]).filter(k => k !== 'unassigned');
    const idx = ring.indexOf(key);
    if (idx === -1) return key;
    return ring[(idx + 1) % ring.length];
  }

  function snapshotCurrentQuarter(){
    const q = STATE.currentQuarter || 'Q1';
    // Preserve existing assignments, don't wipe them
    STATE.quarterAssignments[q] = STATE.quarterAssignments[q] || {};
    Object.values(STATE.badges).forEach(b => { STATE.quarterAssignments[q][b.id] = b.loc; });
    try{ localStorage.setItem('vlab:quarterAssignments', JSON.stringify(STATE.quarterAssignments)); }catch(_){ }
    console.log(`[QUARTER] Snapshotted current quarter ${q} with ${Object.keys(STATE.quarterAssignments[q]).length} assignments`);
  }

  function applyQuarterAssignments(q){
    const snap = (STATE.quarterAssignments && STATE.quarterAssignments[q]) || null;
    if (!snap) return;
    Object.entries(snap).forEach(([bid, loc]) => { if (STATE.badges[bid]) STATE.badges[bid].loc = loc; });
    renderAllBadges();
  }

  function rotateFromTo(prevQ, newQ){
    // Simple round-robin rotation across process ring
    const prevSnap = STATE.quarterAssignments[prevQ] || null;
    if (!prevSnap) { snapshotCurrentQuarter(); return; }
    // Preserve existing assignments in new quarter, don't wipe them
    STATE.quarterAssignments[newQ] = STATE.quarterAssignments[newQ] || {};
    Object.entries(prevSnap).forEach(([bid, prevLoc]) => {
      if (!STATE.badges[bid]) return;
      if (prevLoc && prevLoc !== 'unassigned'){
        const newLoc = nextProcessKey(prevLoc);
        const oldLoc = STATE.badges[bid].loc;
        STATE.badges[bid].loc = newLoc;
        STATE.quarterAssignments[newQ][bid] = newLoc;
        // Log as reassignment under new quarter
        ANALYTICS.logAssignment(bid, oldLoc, newLoc);
      } else {
        STATE.quarterAssignments[newQ][bid] = 'unassigned';
      }
    });
    renderAllBadges();
    try{ localStorage.setItem('vlab:quarterAssignments', JSON.stringify(STATE.quarterAssignments)); }catch(_){ }
  }

  function isQuarterLocked(q){ return !!(STATE.quarterLocks && STATE.quarterLocks[q]); }
  function handleQuarterChange(){
    const newQ = (quarterSelect && quarterSelect.value) || 'Q1';
    const prevQ = STATE.currentQuarter;
    if (newQ === prevQ) return;
    STATE.currentQuarter = newQ;
    // If we have a saved snapshot for newQ, apply it; else rotate from prevQ
    if (STATE.quarterAssignments && STATE.quarterAssignments[newQ] && Object.keys(STATE.quarterAssignments[newQ]).length > 0){
      applyQuarterAssignments(newQ);
    } else if (prevQ){
      rotateFromTo(prevQ, newQ);
    } else {
      snapshotCurrentQuarter();
    }
    // Persist meta with quarter
    try{
      const raw = localStorage.getItem('vlab:lastRoster');
      if (raw){ const snap = JSON.parse(raw); if (snap && snap.meta){ snap.meta.quarter = newQ; localStorage.setItem('vlab:lastRoster', JSON.stringify(snap)); } }
    }catch(_){ }
  }
  quarterSelect && quarterSelect.addEventListener('change', handleQuarterChange);

  analyticsTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active class from all tabs and contents
      analyticsTabs.forEach(t => t.classList.remove('active'));
      analyticsTabContents.forEach(content => content.classList.add('hidden'));
      
      // Add active class to clicked tab and show corresponding content
      tab.classList.add('active');
      const tabName = tab.getAttribute('data-tab');
      document.getElementById(`tab-${tabName}`).classList.remove('hidden');
      
      // Load content for the selected tab
      loadAnalyticsContent(tabName);
      
      // Set up quarter filter for assignments tab
      if (tabName === 'assignments') {
        setTimeout(setupQuarterFilter, 50);
      }
    });
  });

  function openAnalytics() {
    analyticsModal.classList.remove('hidden');
    loadAnalyticsContent('overview'); // Load initial content
    // Focus search for quick access
    analyticsSearchInput && analyticsSearchInput.focus();
    // Set up quarter filter after content loads
    setTimeout(setupQuarterFilter, 100);
  }

  function closeAnalytics() {
    analyticsModal.classList.add('hidden');
    // Clear search state when closing
    if (analyticsSearchInput) analyticsSearchInput.value = '';
    if (analyticsSearchResults) analyticsSearchResults.classList.add('hidden');
    if (analyticsSearchResults) analyticsSearchResults.innerHTML = '';
  }

  // --- Analytics Search (Associate history across quarters) ---
  function ensureEmployeeIndex(){
    // Rebuild employee index from analytics history on each call to ensure freshness
    if (!STATE.analytics) STATE.analytics = {};
    STATE.analytics.employees = {};
    (STATE.analytics.history || []).forEach(h => {
      const login = h.employeeId || h.badgeId || h.eid;
      if (!login) return;
      if (!STATE.analytics.employees[login]){
        STATE.analytics.employees[login] = {
          login: login,
          name: h.employeeName || '',
          history: []
        };
      }
      // Map into expected fields with sensible fallbacks
      const rec = {
        date: h.date || h.timestamp || '',
        shiftType: h.shiftCode ? (String(h.shiftCode).toUpperCase().startsWith('N') ? 'Night' : 'Day') : '',
        quarter: h.quarter || '',
        ls: (typeof h.ls !== 'undefined') ? (h.ls ? 'Yes' : 'No') : 'No',
        assigned: (h.action === 'assign' || h.action === 'reassign' || h.action === 'lock') ? 'Yes' : 'No',
        process: h.toLocation || '',
        employeeId: h.employeeId || '',
        employeeName: h.employeeName || STATE.analytics.employees[login].name || ''
      };
      STATE.analytics.employees[login].history.push(rec);
    });
  }

  function parseQuarterValue(q){
    const s = String(q || '').toUpperCase();
    if (s === 'Q1') return 1; if (s === 'Q2') return 2; if (s === 'Q3') return 3; if (s === 'Q4') return 4;
    return 99;
  }

  function normalizeDateToYMD(v){
    if (!v) return '';
    if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0,10);
    if (typeof v === 'string'){
      const d = parseInputDate(v);
      if (d) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    if (v instanceof Date){
      return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
    }
    return String(v);
  }

  function renderSearchResults(query){
    if (!analyticsSearchResults) return;
    const q = String(query || '').trim();
    if (!q){
      analyticsSearchResults.classList.add('hidden');
      analyticsSearchResults.innerHTML = '';
      return;
    }
    
    const lower = q.toLowerCase();
    let rows = [];
    
    // Ensure multi-site assignments are up to date
    MULTISITE.syncCurrentAssignments();
    
    // Search through current badges for matching employees
    console.log('[Analytics Search] STATE.sites:', STATE.sites);
    console.log('[Analytics Search] Current site:', STATE.currentSite);
    
    Object.values(STATE.badges).forEach(badge => {
      const name = badge.name || '';
      const eid = badge.eid || '';
      
      if (String(name).toLowerCase().includes(lower) || String(eid).toLowerCase().includes(lower)) {
        console.log('[Analytics Search] Checking badge:', badge.id, name, 'loc:', badge.loc);
        
        // Find current assignment info
        let currentSite = 'Unassigned';
        let currentProcess = 'UNASSIGNED';
        let isAssigned = 'No';
        
        // Check each site for current assignment
        Object.entries(STATE.sites).forEach(([siteCode, siteData]) => {
          console.log(`[Analytics Search] Checking site ${siteCode}:`, siteData.assignments);
          if (siteData.assignments && siteData.assignments[badge.id]) {
            currentSite = siteCode;
            currentProcess = siteData.assignments[badge.id].toUpperCase();
            isAssigned = 'Yes';
            console.log(`[Analytics Search] Found assignment: ${badge.name} -> ${siteCode}/${currentProcess}`);
          }
        });
        
        // Also check badge.loc as fallback
        if (currentSite === 'Unassigned' && badge.loc && badge.loc !== 'unassigned' && badge.loc !== 'assigned-elsewhere') {
          currentSite = STATE.currentSite; // Use current site as fallback
          currentProcess = badge.loc.toUpperCase();
          isAssigned = 'Yes';
          console.log(`[Analytics Search] Using badge.loc fallback: ${badge.name} -> ${currentSite}/${currentProcess}`);
        }
        
        console.log(`[Analytics Search] Final result: ${badge.name} -> Site: ${currentSite}, Process: ${currentProcess}, Assigned: ${isAssigned}`);
        
        // Get the actual date from the form
        const formDate = document.getElementById('date')?.value || new Date().toISOString().split('T')[0];
        
        // Get the actual shift type from the form
        const formShift = document.querySelector('input[name="shift"]:checked')?.value || 'day';
        const shiftType = formShift.charAt(0).toUpperCase() + formShift.slice(1); // Capitalize
        
        rows.push({
          date: formDate, // Use form date instead of current date
          shiftType: shiftType, // Use form shift type
          quarter: STATE.currentQuarter || 'Q1',
          site: currentSite,
          ls: 'No', // Default
          assigned: isAssigned,
          process: currentProcess,
          employeeId: eid,
          employeeName: name
        });
      }
    });

    if (rows.length === 0){
      analyticsSearchResults.innerHTML = '<div class="muted">No matching employees found.</div>';
      analyticsSearchResults.classList.remove('hidden');
      return;
    }

    // Sort by name
    rows.sort((a,b) => {
      return (a.employeeName || '').localeCompare(b.employeeName || '');
    });

  const total = rows.length;
  // Render header + table
  const header = `<div class="results-header"><span>Current Status - Matches: <strong>${total}</strong></span></div>`;
    const tableHead = `
      <thead><tr>
        <th>Date</th>
        <th>Shift Type</th>
        <th>Quarter</th>
        <th>Site</th>
        <th>LS</th>
        <th>Assigned</th>
        <th>Process</th>
        <th>Employee ID</th>
        <th>Employee Name</th>
      </tr></thead>`;
    const tableBody = `<tbody>${rows.map(r => `
      <tr>
        <td>${r.date || ''}</td>
        <td>${r.shiftType || ''}</td>
        <td>${r.quarter || ''}</td>
        <td><span class="site-badge site-${(r.site||'').toLowerCase()}">${r.site || 'N/A'}</span></td>
        <td>${r.ls}</td>
        <td>${r.assigned}</td>
        <td>${(r.process||'').toString().toUpperCase()}</td>
        <td>${r.employeeId || ''}</td>
        <td>${r.employeeName || ''}</td>
      </tr>
    `).join('')}</tbody>`;

    analyticsSearchResults.innerHTML = header + `<table>${tableHead}${tableBody}</table>`;
    analyticsSearchResults.classList.remove('hidden');
  }

  // Bind search input (responsive updates)
  analyticsSearchInput && analyticsSearchInput.addEventListener('input', (e) => {
    renderSearchResults(e.target.value);
  });

  function loadAnalyticsContent(tabName) {
    switch(tabName) {
      case 'overview':
        loadOverviewContent();
        break;
      case 'performance':
        loadPerformanceContent();
        break;
      case 'assignments':
        // Check if quarter filter exists and use its value
        const quarterFilter = document.getElementById('quarterFilter');
        const selectedQuarter = quarterFilter ? quarterFilter.value : 'all';
        loadAssignmentsContent(selectedQuarter);
        break;
      case 'rotation':
        loadRotationContent();
        break;
      case 'insights':
        loadInsightsContent();
        break;
    }
  }

  function loadOverviewContent() {
    // Session Summary
    const currentSession = STATE.analytics.sessions.find(s => s.id === ANALYTICS.currentSessionId);
    const sessionSummary = document.getElementById('sessionSummary');
    if (currentSession) {
      sessionSummary.innerHTML = `
        <div class="metric-row">
          <span class="metric-label">Current Session</span>
          <span class="metric-value">${currentSession.date} - ${currentSession.shift}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Planned HC</span>
          <span class="metric-value">${currentSession.plannedHC}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Actual HC</span>
          <span class="metric-value">${currentSession.actualHC}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Efficiency</span>
          <span class="metric-value ${currentSession.efficiency >= 90 ? 'positive' : currentSession.efficiency < 70 ? 'negative' : ''}">${currentSession.efficiency}%</span>
        </div>
      `;
    } else {
      sessionSummary.innerHTML = '<p>No active session</p>';
    }

    // Assignment Activity
    const recentHistory = STATE.analytics.history.slice(-10).reverse();
    const assignmentActivity = document.getElementById('assignmentActivity');
    assignmentActivity.innerHTML = `
      <div class="metric-row">
        <span class="metric-label">Total Assignments</span>
        <span class="metric-value">${STATE.analytics.history.length}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Today's Assignments</span>
        <span class="metric-value">${STATE.analytics.history.filter(h => h.date === new Date().toDateString()).length}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Reassignments</span>
        <span class="metric-value">${STATE.analytics.history.filter(h => h.action === 'reassign').length}</span>
      </div>
    `;

    // Process Distribution
    const processStats = {};
    STATE.analytics.history.forEach(h => {
      if (h.toLocation !== 'unassigned') {
        processStats[h.toLocation] = (processStats[h.toLocation] || 0) + 1;
      }
    });
    
    const processDistribution = document.getElementById('processDistribution');
    const sortedProcesses = Object.entries(processStats).sort((a, b) => b[1] - a[1]).slice(0, 5);
    processDistribution.innerHTML = sortedProcesses.map(([process, count]) => `
      <div class="metric-row">
        <span class="metric-label">${process.toUpperCase()}</span>
        <span class="metric-value">${count}</span>
      </div>
    `).join('') || '<p>No process assignments yet</p>';

    // Efficiency Metrics
    const efficiencyMetrics = document.getElementById('efficiencyMetrics');
    const totalEmployees = Object.keys(STATE.badges).length;
    const assignedEmployees = Object.values(STATE.badges).filter(b => b.loc !== 'unassigned').length;
    const utilizationRate = totalEmployees > 0 ? ((assignedEmployees / totalEmployees) * 100).toFixed(1) : 0;
    
    efficiencyMetrics.innerHTML = `
      <div class="metric-row">
        <span class="metric-label">Utilization Rate</span>
        <span class="metric-value ${utilizationRate >= 85 ? 'positive' : utilizationRate < 60 ? 'negative' : ''}">${utilizationRate}%</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Assigned</span>
        <span class="metric-value">${assignedEmployees}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Available</span>
        <span class="metric-value">${totalEmployees - assignedEmployees}</span>
      </div>
    `;
  }

  function loadPerformanceContent() {
    const performanceRankings = document.getElementById('performanceRankings');
    const topPerformers = document.getElementById('topPerformers');
    const skillDevelopment = document.getElementById('skillDevelopment');

    // Performance Rankings
    const sortedPerformance = Object.values(STATE.analytics.performance)
      .sort((a, b) => b.performanceScore - a.performanceScore)
      .slice(0, 10);

    if (sortedPerformance.length > 0) {
      performanceRankings.innerHTML = sortedPerformance.map((emp, index) => `
        <div class="metric-row">
          <div>
            <div class="metric-label">#${index + 1} ${emp.name}</div>
            <div class="performance-bar">
              <div class="performance-fill" style="width: ${emp.performanceScore}%"></div>
            </div>
          </div>
          <span class="metric-value">${emp.performanceScore.toFixed(1)}</span>
        </div>
      `).join('');
    } else {
      performanceRankings.innerHTML = '<p>No performance data available yet</p>';
    }

    // Top Performers (Top 3) with Rotation Status
    const top3 = sortedPerformance.slice(0, 3);
    topPerformers.innerHTML = top3.map((emp, index) => {
      const rotationScore = ANALYTICS.ROTATION ? ANALYTICS.ROTATION.calculateRotationScore(emp.employeeId) : null;
      const rotationStatus = rotationScore ? rotationScore.status : 'unknown';
      const rotationColor = {
        'excellent': '#059669',
        'good': '#10b981', 
        'needs_improvement': '#f59e0b',
        'poor': '#dc2626',
        'unknown': '#6b7280'
      }[rotationStatus];
      
      return `
        <div class="metric-row">
          <span class="metric-label">${emp.name}</span>
          <span class="metric-value">${emp.performanceScore.toFixed(1)}</span>
        </div>
        <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">
          Versatility: ${emp.versatility} processes | Assignments: ${emp.totalAssignments}
        </div>
        <div style="font-size: 11px; color: ${rotationColor}; margin-bottom: 12px;">
          🔄 Rotation: ${rotationStatus.replace('_', ' ')} ${rotationScore ? `(${rotationScore.score})` : ''}
        </div>
      `;
    }).join('') || '<p>No performance data available</p>';

    // Skill Development
    const allEmployees = Object.values(STATE.analytics.performance);
    const avgVersatility = allEmployees.length > 0 ? 
      allEmployees.reduce((sum, emp) => sum + emp.versatility, 0) / allEmployees.length : 0;
    
    skillDevelopment.innerHTML = `
      <div class="metric-row">
        <span class="metric-label">Average Versatility</span>
        <span class="metric-value">${avgVersatility.toFixed(1)} processes</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Most Experienced Process</span>
        <span class="metric-value">${getMostExperiencedProcess()}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Training Opportunities</span>
        <span class="metric-value">${getTrainingOpportunityCount()}</span>
      </div>
    `;
  }

  function loadAssignmentsContent(selectedQuarter = null) {
    const assignmentHistory = document.getElementById('assignmentHistory');
    const assignmentPatterns = document.getElementById('assignmentPatterns');
    const assignmentRecommendations = document.getElementById('assignmentRecommendations');
    
    // Get selected quarter from filter dropdown
    const quarterFilter = document.getElementById('quarterFilter');
    const filterQuarter = selectedQuarter || (quarterFilter ? quarterFilter.value : 'all');

    // Current Assignments Across All Sites
    let currentAssignmentsHTML = '<h4>Current Assignments by Site</h4>';
    Object.entries(STATE.sites).forEach(([siteCode, siteData]) => {
      const assignments = siteData.assignments || {};
      const assignmentCount = Object.keys(assignments).length;
      
      currentAssignmentsHTML += `
        <div class="site-assignment-section">
          <h5><span class="site-badge site-${siteCode.toLowerCase()}">${siteCode}</span> (${assignmentCount} assigned)</h5>
      `;
      
      if (assignmentCount > 0) {
        const assignmentsByProcess = {};
        Object.entries(assignments).forEach(([badgeId, location]) => {
          if (!assignmentsByProcess[location]) assignmentsByProcess[location] = [];
          const badge = STATE.badges[badgeId];
          if (badge) {
            assignmentsByProcess[location].push(badge);
          }
        });
        
        Object.entries(assignmentsByProcess).forEach(([process, badges]) => {
          currentAssignmentsHTML += `
            <div class="process-assignment">
              <strong>${process.toUpperCase()}</strong> (${badges.length}):
              ${badges.map(b => `<span class="employee-name">${b.name || b.eid}</span>`).join(', ')}
            </div>
          `;
        });
      } else {
        currentAssignmentsHTML += '<p class="no-assignments">No current assignments</p>';
      }
      
      currentAssignmentsHTML += '</div>';
    });

    // Filter assignment history by quarter
    let filteredHistory = STATE.analytics.history;
    if (filterQuarter !== 'all') {
      filteredHistory = STATE.analytics.history.filter(entry => entry.quarter === filterQuarter);
    }
    
    // Take last 50 assignments (or all if filtered by quarter) and reverse for newest first
    const displayHistory = filterQuarter === 'all' ? filteredHistory.slice(-50).reverse() : filteredHistory.reverse();
    
    // Create quarter summary with statistics
    const quarterStats = {};
    STATE.analytics.history.forEach(entry => {
      const q = entry.quarter || 'Q1';
      quarterStats[q] = (quarterStats[q] || 0) + 1;
    });
    
    const quarterSummary = filterQuarter === 'all' ? 
      'Showing recent assignments from all quarters' :
      `Showing all assignments from ${filterQuarter} (${displayHistory.length} total)`;
    
    const statsHTML = filterQuarter === 'all' ? 
      `<div class="text-sm text-gray-600 mt-2">Quarter breakdown: ${Object.entries(quarterStats).map(([q, count]) => `${q}: ${count}`).join(', ')}</div>` :
      '';
    
    const historyHTML = `
      <div class="quarter-summary mb-4 p-3 bg-gray-50 rounded border">
        <strong>${quarterSummary}</strong>
        ${filterQuarter !== 'all' ? `<div class="text-sm text-gray-600 mt-1">Filter: ${filterQuarter} assignments only</div>` : ''}
        ${statsHTML}
      </div>
    ` + displayHistory.map(entry => `
      <div class="history-item">
        <div class="history-timestamp">${new Date(entry.timestamp).toLocaleString()}</div>
        <div class="history-action">
          <span class="quarter-badge bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">${entry.quarter || 'Q1'}</span>
          <span class="site-badge site-${(entry.site||'').toLowerCase()}">${entry.site || 'N/A'}</span>
          ${entry.employeeName} ${entry.action === 'assign' ? 'assigned to' : 
            entry.action === 'unassign' ? 'unassigned from' : 'moved to'} 
          ${entry.toLocation.toUpperCase()}
        </div>
      </div>
    `).join('') || '<p>No assignment history available</p>';

    assignmentHistory.innerHTML = currentAssignmentsHTML + '<h4>Recent Assignment History</h4>' + historyHTML;

    // Assignment Patterns
    const patternStats = analyzeAssignmentPatterns();
    assignmentPatterns.innerHTML = `
      <div class="metric-row">
        <span class="metric-label">Peak Assignment Hour</span>
        <span class="metric-value">${patternStats.peakHour}:00</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Most Active Process</span>
        <span class="metric-value">${patternStats.mostActiveProcess}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Avg Time Between Moves</span>
        <span class="metric-value">${patternStats.avgTimeBetweenMoves} min</span>
      </div>
    `;

    // Assignment Recommendations with Rotation Fairness
    const processOptions = ['cb', 'ibws', 'lineloaders', 'trickle', 'dm'];
    let allRecommendations = [];
    
    processOptions.forEach(process => {
      const recommendations = ANALYTICS.getRecommendations(process, { fairRotation: true });
      recommendations.slice(0, 2).forEach(rec => {
        rec.targetProcess = process.toUpperCase();
        allRecommendations.push(rec);
      });
    });
    
    // Sort by rotation fairness and score
    allRecommendations.sort((a, b) => {
      const aRotation = ANALYTICS.ROTATION ? ANALYTICS.ROTATION.calculateRotationScore(a.employeeId) : null;
      const bRotation = ANALYTICS.ROTATION ? ANALYTICS.ROTATION.calculateRotationScore(b.employeeId) : null;
      
      // Prioritize poor rotation employees
      if (aRotation && bRotation) {
        const priorityOrder = { poor: 4, needs_improvement: 3, good: 2, excellent: 1 };
        const aPriority = priorityOrder[aRotation.status] || 0;
        const bPriority = priorityOrder[bRotation.status] || 0;
        
        if (aPriority !== bPriority) return bPriority - aPriority;
      }
      
      return b.score - a.score;
    });
    
    assignmentRecommendations.innerHTML = allRecommendations.slice(0, 5).map(rec => {
      const rotationScore = ANALYTICS.ROTATION ? ANALYTICS.ROTATION.calculateRotationScore(rec.employeeId) : null;
      const rotationBadge = rotationScore ? 
        `<span style="color: ${rotationScore.status === 'poor' ? '#dc2626' : rotationScore.status === 'needs_improvement' ? '#f59e0b' : '#059669'}; font-size: 10px;">
          🔄 ${rotationScore.status.replace('_', ' ')} (${rotationScore.score})
        </span>` : '';
        
      return `
        <div class="recommendation-item">
          <div class="recommendation-header">${rec.name} → ${rec.targetProcess}</div>
          <div class="recommendation-reason">${rec.fullReason || rec.reason} (Score: ${rec.score.toFixed(1)})</div>
          ${rotationBadge}
        </div>
      `;
    }).join('') || '<p>No recommendations available</p>';
  }

  function loadRotationContent() {
    const smartAssignmentQueue = document.getElementById('smartAssignmentQueue');
    const rotationAlertsPanel = document.getElementById('rotationAlertsPanel');
    const rotationFairnessMetrics = document.getElementById('rotationFairnessMetrics');
    
    const mgmt = STATE.analytics.rotationManagement;
    
    // Smart Assignment Queue
    if (mgmt && mgmt.assignmentQueue && mgmt.assignmentQueue.length > 0) {
      smartAssignmentQueue.innerHTML = mgmt.assignmentQueue.slice(0, 5).map(item => `
        <div class="recommendation-item" style="margin-bottom: 12px;">
          <div class="recommendation-header">${item.employeeName} → ${item.recommendedProcess.toUpperCase()}</div>
          <div class="recommendation-reason">${item.reason}</div>
          <div style="font-size: 11px; color: #6b7280; margin-top: 4px;">
            Priority: ${item.priority} | Current Score: ${item.rotationScore} | Expected: +${item.expectedImprovement}
          </div>
          <button onclick="ANALYTICS.ROTATION.executeAssignment('${item.employeeId}', '${item.recommendedProcess}')" 
                  style="margin-top: 8px; padding: 4px 8px; background: #10b981; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;">
            Execute Assignment
          </button>
        </div>
      `).join('');
    } else {
      smartAssignmentQueue.innerHTML = '<p>No smart assignments available. Lock assignments to generate recommendations.</p>';
    }
    
    // Rotation Alerts
    if (mgmt && mgmt.rotationAlerts && mgmt.rotationAlerts.length > 0) {
      rotationAlertsPanel.innerHTML = mgmt.rotationAlerts.map(alert => `
        <div class="insight-item" style="background: ${alert.type === 'urgent' ? '#fee2e2' : alert.type === 'warning' ? '#fef3c7' : '#f0f4ff'}; margin-bottom: 8px;">
          <div class="insight-title" style="color: ${alert.type === 'urgent' ? '#dc2626' : alert.type === 'warning' ? '#d97706' : '#3b82f6'};">
            ${alert.employeeName} - ${alert.type.toUpperCase()}
          </div>
          <div class="insight-description" style="color: #374151;">${alert.message}</div>
          <div style="font-size: 11px; margin-top: 4px; font-weight: 500;">Action: ${alert.action}</div>
        </div>
      `).join('');
    } else {
      rotationAlertsPanel.innerHTML = '<p>No rotation alerts. System will generate alerts when rotation issues are detected.</p>';
    }
    
    // Fairness Metrics
    if (mgmt && mgmt.rotationRules) {
      const employees = Object.values(STATE.analytics.performance);
      const rotationScores = employees.map(emp => ANALYTICS.ROTATION.calculateRotationScore(emp.employeeId));
      const avgScore = rotationScores.length > 0 ? 
        rotationScores.reduce((sum, score) => sum + score.score, 0) / rotationScores.length : 0;
      
      const statusCounts = { poor: 0, needs_improvement: 0, good: 0, excellent: 0 };
      rotationScores.forEach(score => statusCounts[score.status]++);
      
      rotationFairnessMetrics.innerHTML = `
        <div class="metric-row">
          <span class="metric-label">Average Rotation Score</span>
          <span class="metric-value ${avgScore >= 70 ? 'positive' : avgScore < 50 ? 'negative' : ''}">${avgScore.toFixed(1)}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Excellent Rotation</span>
          <span class="metric-value positive">${statusCounts.excellent}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Needs Attention</span>
          <span class="metric-value ${statusCounts.poor > 0 ? 'negative' : ''}">${statusCounts.poor + statusCounts.needs_improvement}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Max Consecutive Rule</span>
          <span class="metric-value">${mgmt.rotationRules.maxConsecutiveSameProcess} assignments</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">Fairness Threshold</span>
          <span class="metric-value">${mgmt.rotationRules.fairnessThreshold} points</span>
        </div>
      `;
    } else {
      rotationFairnessMetrics.innerHTML = '<p>Lock assignments to activate rotation management and view fairness metrics.</p>';
    }
  }

  function loadInsightsContent() {
    const workforceInsights = document.getElementById('workforceInsights');
    const trainingOpportunities = document.getElementById('trainingOpportunities');
    const productivityTrends = document.getElementById('productivityTrends');

    // Workforce Insights
    const insights = generateWorkforceInsights();
    workforceInsights.innerHTML = insights.map(insight => `
      <div class="insight-item">
        <div class="insight-title">${insight.title}</div>
        <div class="insight-description">${insight.description}</div>
      </div>
    `).join('');

    // Training Opportunities
    const trainingNeeds = getAllTrainingNeeds();
    trainingOpportunities.innerHTML = trainingNeeds.map(need => `
      <div class="metric-row">
        <span class="metric-label">${need.employee}</span>
        <span class="metric-value">${need.process}</span>
      </div>
    `).join('') || '<p>No specific training needs identified</p>';

    // Productivity Trends
    const trends = calculateProductivityTrends();
    productivityTrends.innerHTML = `
      <div class="metric-row">
        <span class="metric-label">Trend Direction</span>
        <span class="metric-value ${trends.direction === 'up' ? 'positive' : trends.direction === 'down' ? 'negative' : ''}">${trends.direction === 'up' ? '↗ Improving' : trends.direction === 'down' ? '↘ Declining' : '→ Stable'}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Change Rate</span>
        <span class="metric-value">${trends.changeRate.toFixed(1)}%</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Peak Performance</span>
        <span class="metric-value">${trends.peakScore.toFixed(1)}</span>
      </div>
    `;
  }

  // Helper functions for analytics
  function getMostExperiencedProcess() {
    const processExp = {};
    Object.values(STATE.analytics.performance).forEach(emp => {
      Object.entries(emp.processExperience).forEach(([process, count]) => {
        processExp[process] = (processExp[process] || 0) + count;
      });
    });
    const topProcess = Object.entries(processExp).sort((a, b) => b[1] - a[1])[0];
    return topProcess ? topProcess[0].toUpperCase() : 'None';
  }

  function getTrainingOpportunityCount() {
    return Object.values(STATE.analytics.performance)
      .reduce((sum, emp) => sum + emp.trainingNeeds.length, 0);
  }

  function analyzeAssignmentPatterns() {
    const hours = {};
    const processes = {};
    const timeBetweenMoves = [];
    
    let lastTimestamp = null;
    STATE.analytics.history.forEach(entry => {
      const hour = new Date(entry.timestamp).getHours();
      hours[hour] = (hours[hour] || 0) + 1;
      
      if (entry.toLocation !== 'unassigned') {
        processes[entry.toLocation] = (processes[entry.toLocation] || 0) + 1;
      }
      
      if (lastTimestamp) {
        const diffMinutes = (new Date(entry.timestamp) - new Date(lastTimestamp)) / (1000 * 60);
        timeBetweenMoves.push(diffMinutes);
      }
      lastTimestamp = entry.timestamp;
    });
    
    const peakHour = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
    const mostActive = Object.entries(processes).sort((a, b) => b[1] - a[1])[0];
    const avgTime = timeBetweenMoves.length > 0 ? 
      timeBetweenMoves.reduce((sum, time) => sum + time, 0) / timeBetweenMoves.length : 0;
    
    return {
      peakHour: peakHour ? peakHour[0] : 'N/A',
      mostActiveProcess: mostActive ? mostActive[0].toUpperCase() : 'N/A',
      avgTimeBetweenMoves: avgTime.toFixed(1)
    };
  }

  function generateWorkforceInsights() {
    const insights = [];
    const employees = Object.values(STATE.analytics.performance);
    
    if (employees.length === 0) {
      return [{ title: 'Getting Started', description: 'Start assigning employees to generate workforce insights' }];
    }
    
    const avgScore = employees.reduce((sum, emp) => sum + emp.performanceScore, 0) / employees.length;
    const topPerformer = employees.sort((a, b) => b.performanceScore - a.performanceScore)[0];
    
    insights.push({
      title: 'Workforce Performance',
      description: `Average performance score is ${avgScore.toFixed(1)}. ${topPerformer.name} leads with ${topPerformer.performanceScore.toFixed(1)} points.`
    });
    
    const versatilityLevels = employees.map(emp => emp.versatility);
    const avgVersatility = versatilityLevels.reduce((sum, v) => sum + v, 0) / versatilityLevels.length;
    
    insights.push({
      title: 'Skill Distribution',
      description: `Average employee versatility is ${avgVersatility.toFixed(1)} processes. Consider cross-training to improve flexibility.`
    });
    
    if (STATE.analytics.history.length > 50) {
      insights.push({
        title: 'Assignment Efficiency',
        description: 'Rich assignment history detected. Use the recommendations engine to optimize future assignments based on historical performance patterns.'
      });
    }
    
    return insights;
  }

  function getAllTrainingNeeds() {
    const trainingNeeds = [];
    Object.values(STATE.analytics.performance).forEach(emp => {
      emp.trainingNeeds.forEach(process => {
        trainingNeeds.push({
          employee: emp.name,
          process: process.toUpperCase()
        });
      });
    });
    return trainingNeeds.slice(0, 10); // Limit to top 10
  }

  function calculateProductivityTrends() {
    const allTrends = [];
    Object.values(STATE.analytics.performance).forEach(emp => {
      allTrends.push(...emp.productivityTrends);
    });
    
    if (allTrends.length < 10) {
      return { direction: 'stable', changeRate: 0, peakScore: 0 };
    }
    
    const sortedTrends = allTrends.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const recent = sortedTrends.slice(-10);
    const earlier = sortedTrends.slice(-20, -10);
    
    const recentAvg = recent.reduce((sum, t) => sum + t.score, 0) / recent.length;
    const earlierAvg = earlier.length > 0 ? earlier.reduce((sum, t) => sum + t.score, 0) / earlier.length : recentAvg;
    
    const changeRate = ((recentAvg - earlierAvg) / earlierAvg) * 100;
    const direction = changeRate > 5 ? 'up' : changeRate < -5 ? 'down' : 'stable';
    const peakScore = Math.max(...sortedTrends.map(t => t.score));
    
    return { direction, changeRate: Math.abs(changeRate), peakScore };
  }

  // Event listeners for analytics
  analyticsBtn?.addEventListener('click', openAnalytics);
  closeAnalyticsBtn?.addEventListener('click', closeAnalytics);

  // Quarter filter event listener
  function setupQuarterFilter() {
    const quarterFilter = document.getElementById('quarterFilter');
    if (quarterFilter) {
      // Set current quarter as default if not already set
      if (!quarterFilter.value || quarterFilter.value === 'all') {
        quarterFilter.value = STATE.currentQuarter || 'Q1';
      }
      
      // Remove existing listener to prevent duplicates
      quarterFilter.replaceWith(quarterFilter.cloneNode(true));
      const newQuarterFilter = document.getElementById('quarterFilter');
      
      newQuarterFilter.addEventListener('change', (e) => {
        const selectedQuarter = e.target.value;
        console.log(`[Analytics] Quarter filter changed to: ${selectedQuarter}`);
        loadAssignmentsContent(selectedQuarter);
      });
      
      console.log(`[Analytics] Quarter filter setup complete, current selection: ${newQuarterFilter.value}`);
    }
  }

  // Quarter filter setup is now handled in the main openAnalytics function

  // Enhanced export analytics with multiple formats
  exportAnalyticsBtn?.addEventListener('click', () => {
    // Export only Assignment History as CSV (with Quarter)
    const currentDate = new Date().toISOString().split('T')[0];
    const assignmentCSV = generateAssignmentHistoryCSV();
    const assignmentBlob = new Blob([assignmentCSV], {type: 'text/csv'});
    const assignmentLink = document.createElement('a');
    assignmentLink.href = URL.createObjectURL(assignmentBlob);
    assignmentLink.download = `vlab-assignment-history-${currentDate}.csv`;
    assignmentLink.click();
    alert('Assignment history exported as CSV.');
  });

  // Generate CSV export for performance data
  function generatePerformanceCSV() {
    const employees = Object.values(STATE.analytics.performance);
    if (employees.length === 0) return 'No performance data available';
    
    const headers = [
      'Employee ID', 'Employee Name', 'Performance Score', 'Total Assignments',
      'Versatility', 'Adaptability Score', 'Consistency Score', 'Collaboration Score',
      'Last Active', 'Top Skill 1', 'Top Skill 2', 'Top Skill 3', 'Training Needs'
    ];
    
    const rows = employees.map(emp => {
      const topSkills = Object.entries(emp.processExperience)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([process, count]) => `${process}(${count})`);
      
      while (topSkills.length < 3) topSkills.push('');
      
      return [
        emp.employeeId,
        emp.name,
        emp.performanceScore.toFixed(1),
        emp.totalAssignments,
        emp.versatility,
        emp.adaptabilityScore.toFixed(1),
        emp.consistencyScore.toFixed(1),
        emp.collaborationScore.toFixed(1),
        emp.lastActive || 'Never',
        topSkills[0],
        topSkills[1],
        topSkills[2],
        emp.trainingNeeds.join('; ')
      ];
    });
    
    return [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
  }

  // Generate CSV export for assignment history
  function generateAssignmentHistoryCSV() {
    // Always produce a CSV header; include Quarter column
    const headers = [
      'Timestamp', 'Date', 'Employee ID', 'Employee Name', 'Shift Code',
      'Site', 'Quarter', 'Action', 'From Location', 'To Location', 'Session ID'
    ];

    const rows = (STATE.analytics.history || []).map(entry => [
      entry.timestamp,
      entry.date,
      entry.employeeId,
      entry.employeeName,
      entry.shiftCode,
      entry.site,
      entry.quarter || '',
      entry.action,
      entry.fromLocation,
      entry.toLocation,
      entry.sessionId
    ]);

    return [headers, ...rows].map(row => row.map(cell => `"${cell || ''}"`).join(',')).join('\n');
  }

  // Generate executive HTML report
  function generateExecutiveReport() {
    const employees = Object.values(STATE.analytics.performance);
    const totalAssignments = STATE.analytics.history.length;
    const activeSessions = STATE.analytics.sessions.length;
    const avgPerformance = employees.length > 0 ? 
      employees.reduce((sum, emp) => sum + emp.performanceScore, 0) / employees.length : 0;
    
    const topPerformers = employees
      .sort((a, b) => b.performanceScore - a.performanceScore)
      .slice(0, 5);
    
    const processStats = generateProcessStatistics();
    const insights = generateWorkforceInsights();
    const recommendations = ANALYTICS.getOptimizationSuggestions();
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>VLAB Workforce Analytics - Executive Summary</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid #3b82f6; padding-bottom: 20px; }
            .header h1 { color: #1f2937; margin: 0; font-size: 28px; }
            .header p { color: #6b7280; margin: 10px 0 0 0; }
            .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 30px 0; }
            .metric-card { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; text-align: center; }
            .metric-value { font-size: 32px; font-weight: bold; color: #3b82f6; margin-bottom: 5px; }
            .metric-label { color: #6b7280; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
            .section { margin: 40px 0; }
            .section h2 { color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
            .performers-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            .performers-table th, .performers-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
            .performers-table th { background: #f8fafc; font-weight: 600; }
            .insight-item { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 10px 0; border-radius: 4px; }
            .recommendation-item { background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 10px 0; border-radius: 4px; }
            .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Virtual Labor Board Analytics</h1>
                <p>Executive Summary Report - ${new Date().toLocaleDateString()}</p>
            </div>
            
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-value">${totalAssignments}</div>
                    <div class="metric-label">Total Assignments</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${employees.length}</div>
                    <div class="metric-label">Employees Tracked</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${activeSessions}</div>
                    <div class="metric-label">Active Sessions</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">${avgPerformance.toFixed(1)}</div>
                    <div class="metric-label">Avg Performance Score</div>
                </div>
            </div>
            
            <div class="section">
                <h2>Top Performers</h2>
                <table class="performers-table">
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Employee Name</th>
                            <th>Performance Score</th>
                            <th>Versatility</th>
                            <th>Total Assignments</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${topPerformers.map((emp, index) => `
                            <tr>
                                <td>#${index + 1}</td>
                                <td>${emp.name}</td>
                                <td>${emp.performanceScore.toFixed(1)}</td>
                                <td>${emp.versatility} processes</td>
                                <td>${emp.totalAssignments}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            
            <div class="section">
                <h2>Process Performance</h2>
                ${Object.entries(processStats).map(([process, stats]) => `
                    <div style="margin: 15px 0; padding: 15px; background: #f8fafc; border-radius: 6px;">
                        <strong>${process.toUpperCase()}</strong>: ${stats.totalAssignments} assignments, 
                        ${stats.uniqueEmployees} unique employees, 
                        Avg experience: ${stats.avgExperience.toFixed(1)}
                    </div>
                `).join('')}
            </div>
            
            <div class="section">
                <h2>Key Insights</h2>
                ${insights.map(insight => `
                    <div class="insight-item">
                        <strong>${insight.title}</strong><br>
                        ${insight.description}
                    </div>
                `).join('')}
            </div>
            
            <div class="section">
                <h2>Optimization Recommendations</h2>
                ${recommendations.slice(0, 5).map(rec => `
                    <div class="recommendation-item">
                        <strong>${rec.type === 'reassignment' ? 'Reassignment' : 'Assignment'} Suggestion</strong><br>
                        ${rec.reason} (Priority: ${rec.priority})
                    </div>
                `).join('')}
            </div>
            
            <div class="footer">
                Generated by VLAB Virtual Labor Board Analytics System<br>
                Report Date: ${new Date().toISOString()}
            </div>
        </div>
    </body>
    </html>`;
  }

  // Generate process statistics
  function generateProcessStatistics() {
    const processStats = {};
    
    STATE.analytics.history.forEach(entry => {
      if (entry.toLocation !== 'unassigned') {
        if (!processStats[entry.toLocation]) {
          processStats[entry.toLocation] = {
            totalAssignments: 0,
            uniqueEmployees: new Set(),
            experienceLevels: []
          };
        }
        
        processStats[entry.toLocation].totalAssignments++;
        processStats[entry.toLocation].uniqueEmployees.add(entry.employeeId);
        
        const empPerformance = STATE.analytics.performance[entry.employeeId];
        if (empPerformance) {
          const processExp = empPerformance.processExperience[entry.toLocation] || 0;
          processStats[entry.toLocation].experienceLevels.push(processExp);
        }
      }
    });
    
    // Calculate averages
    Object.entries(processStats).forEach(([process, stats]) => {
      stats.uniqueEmployees = stats.uniqueEmployees.size;
      stats.avgExperience = stats.experienceLevels.length > 0 ? 
        stats.experienceLevels.reduce((sum, exp) => sum + exp, 0) / stats.experienceLevels.length : 0;
    });
    
    return processStats;
  }

  // Calculate overall productivity metrics
  function calculateOverallProductivityMetrics() {
    const employees = Object.values(STATE.analytics.performance);
    if (employees.length === 0) return null;
    
    return {
      avgPerformanceScore: employees.reduce((sum, emp) => sum + emp.performanceScore, 0) / employees.length,
      avgVersatility: employees.reduce((sum, emp) => sum + emp.versatility, 0) / employees.length,
      avgAdaptability: employees.reduce((sum, emp) => sum + emp.adaptabilityScore, 0) / employees.length,
      avgConsistency: employees.reduce((sum, emp) => sum + emp.consistencyScore, 0) / employees.length,
      totalTrainingNeeds: employees.reduce((sum, emp) => sum + emp.trainingNeeds.length, 0),
      highPerformers: employees.filter(emp => emp.performanceScore >= 85).length,
      experiencedEmployees: employees.filter(emp => emp.versatility >= 5).length
    };
  }

  // Clear analytics data
  clearAnalyticsBtn?.addEventListener('click', () => {
    if (!confirm('Clear all analytics data? This action cannot be undone.')) return;
    
    STATE.analytics = {
      history: [],
      sessions: [],
      performance: {},
      patterns: {}
    };
    ANALYTICS.saveAnalyticsData();
    
    // Also clear localStorage to start fresh
    try {
      localStorage.removeItem('vlab:analytics');
      localStorage.removeItem('vlab:lastRoster');
    } catch(e) { /* ignore */ }
    
    closeAnalytics();
    alert('Analytics data cleared successfully. Please reload your roster for fresh tracking.');
  });

  // Close modal when clicking outside
  analyticsModal?.addEventListener('click', (e) => {
    if (e.target === analyticsModal) {
      closeAnalytics();
    }
  });

  // ESC key closes analytics modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !analyticsModal.classList.contains('hidden')) {
      closeAnalytics();
    }
  });

  // Test Analytics functionality
  const testAnalyticsBtn = document.getElementById('testAnalyticsBtn');
  testAnalyticsBtn?.addEventListener('click', async () => {
    if (testAnalyticsBtn.disabled) return;
    
    try {
      testAnalyticsBtn.disabled = true;
      testAnalyticsBtn.textContent = '🧪 Running...';
      
      // Confirm test action
      const confirmMessage = `Run 100 assignment analytics test?\n\nThis will:\n• Initialize 20 sample employees\n• Perform 100 random assignments\n• Generate comprehensive analytics report\n• Demonstrate all analytics features\n\nProceed?`;
      
      if (!confirm(confirmMessage)) {
        testAnalyticsBtn.disabled = false;
        testAnalyticsBtn.textContent = '🧪 Test';
        return;
      }
      
      console.log('\n🧪 STARTING 100 ASSIGNMENT ANALYTICS TEST 🧪\n');
      
      // Run the test
      await TESTING.performMultipleAssignments(100);
      
      // Show completion message
      alert(`✅ Analytics Test Completed!\n\n• 100 assignments performed\n• Comprehensive analytics generated\n• Performance data collected\n• Rotation scores calculated\n\nCheck the browser console for detailed analytics report.\nClick Analytics button to view dashboard.`);
      
    } catch (error) {
      console.error('[TEST] Error running analytics test:', error);
      alert('Error running analytics test: ' + error.message);
    } finally {
      testAnalyticsBtn.disabled = false;
      testAnalyticsBtn.textContent = '🧪 Test';
    }
  });

  // Lock Assignments functionality
  const lockAssignmentsBtn = document.getElementById('lockAssignmentsBtn');
  lockAssignmentsBtn?.addEventListener('click', () => {
    if (lockAssignmentsBtn.disabled) return;
    
    // Check if there are any assignments to lock
    const assignedBadges = Object.values(STATE.badges).filter(b => b.loc !== 'unassigned');
    if (assignedBadges.length === 0) {
      alert('No assignments to lock. Please assign employees to processes first.');
      return;
    }
    
    // Confirm quarter lock action
    const currQ = STATE.currentQuarter || 'Q1';
    if (STATE.quarterLocks && STATE.quarterLocks[currQ]){ alert(`Quarter ${currQ} is already locked.`); return; }
    const confirmMessage = `Lock ${assignedBadges.length} assignments for ${currQ}?\n\nThis will:\n• Freeze current quarter assignments\n• Include quarter in analytics logs\n• Generate smart rotation recommendations\n\nProceed?`;
    
    if (!confirm(confirmMessage)) return;
    
    try {
  // Lock only current quarter and activate rotation insights without disabling UI globally
  const lockRecord = ANALYTICS.ROTATION.lockQuarter(currQ);
      
      if (lockRecord) {
  alert(`✅ ${currQ} Locked!\n\n• Assignments frozen for ${currQ}\n• Rotation insights updated\n• Use Quarter dropdown to work on other quarters.`);
      }
    } catch (error) {
      console.error('[LOCK] Error locking assignments:', error);
      alert('Error locking assignments: ' + error.message);
    }
  });

// ===== TESTING SYSTEM FOR 100 ASSIGNMENTS =====
// This system will be available after DOM is loaded
window.TESTING = {
  // Sample employee data for testing
  sampleEmployees: [
    { id: 'EMP001', name: 'Alice Johnson', site: 'FFC1', shift: 'DA' },
    { id: 'EMP002', name: 'Bob Smith', site: 'FFC1', shift: 'DB' },
    { id: 'EMP003', name: 'Carol Davis', site: 'FFC1', shift: 'DC' },
    { id: 'EMP004', name: 'David Wilson', site: 'FFC1', shift: 'DL' },
    { id: 'EMP005', name: 'Emma Brown', site: 'FFC1', shift: 'DN' },
    { id: 'EMP006', name: 'Frank Miller', site: 'FFC1', shift: 'DH' },
    { id: 'EMP007', name: 'Grace Taylor', site: 'FFC1', shift: 'NA' },
    { id: 'EMP008', name: 'Henry Clark', site: 'FFC1', shift: 'NB' },
    { id: 'EMP009', name: 'Ivy Martinez', site: 'FFC1', shift: 'NC' },
    { id: 'EMP010', name: 'Jack Lee', site: 'FFC1', shift: 'NL' },
    { id: 'EMP011', name: 'Kate Anderson', site: 'FFC1', shift: 'NN' },
    { id: 'EMP012', name: 'Leo Garcia', site: 'FFC1', shift: 'NH' },
    { id: 'EMP013', name: 'Maya Singh', site: 'FFC2', shift: 'DA' },
    { id: 'EMP014', name: 'Noah White', site: 'FFC2', shift: 'DB' },
    { id: 'EMP015', name: 'Olivia Thomas', site: 'FFC2', shift: 'DC' },
    { id: 'EMP016', name: 'Paul Rodriguez', site: 'FFC2', shift: 'DL' },
    { id: 'EMP017', name: 'Quinn Harris', site: 'FFC2', shift: 'DN' },
    { id: 'EMP018', name: 'Rachel Green', site: 'FFC2', shift: 'DH' },
    { id: 'EMP019', name: 'Sam Wilson', site: 'FFC2', shift: 'NA' },
    { id: 'EMP020', name: 'Tina Chen', site: 'FFC2', shift: 'NB' }
  ],

  // Available process locations
  processes: ['cb', 'sort', 'dock', 'ib', 'ob', 'stow', 'pick', 'pack'],

  // Initialize sample badges in the system
  initializeSampleData: function() {
    // Check if STATE and ANALYTICS are available
    if (typeof STATE === 'undefined' || typeof ANALYTICS === 'undefined') {
      console.error('[TESTING] STATE or ANALYTICS not available. Make sure the page is fully loaded.');
      throw new Error('System not ready. Please wait for page to load completely.');
    }
    
    console.log('[TESTING] Initializing sample employee data...');
    
    // Clear existing badges
    STATE.badges = {};
    
    // Create badges for sample employees
    this.sampleEmployees.forEach(emp => {
      const badgeId = `b_${emp.id}`;
      STATE.badges[badgeId] = {
        id: badgeId,
        name: emp.name,
        eid: emp.id,
        scode: emp.shift,
        site: emp.site,
        present: true,
        loc: 'unassigned'
      };
    });
    
    // Start analytics session
    ANALYTICS.startSession();
    
    console.log(`[TESTING] Created ${Object.keys(STATE.badges).length} sample badges`);
    
    // Check if renderAllBadges function is available
    if (typeof renderAllBadges === 'function') {
      renderAllBadges();
    } else {
      console.log('[TESTING] renderAllBadges function not available yet');
    }
  },

  // Perform a single random assignment
  performRandomAssignment: function() {
    if (typeof STATE === 'undefined' || typeof ANALYTICS === 'undefined') {
      console.error('[TESTING] STATE or ANALYTICS not available');
      return null;
    }
    
    // Get available unassigned badges
    const unassignedBadges = Object.values(STATE.badges).filter(b => b.loc === 'unassigned');
    if (unassignedBadges.length === 0) {
      console.log('[TESTING] No unassigned badges available');
      return null;
    }

    // Select random badge and process
    const randomBadge = unassignedBadges[Math.floor(Math.random() * unassignedBadges.length)];
    const randomProcess = this.processes[Math.floor(Math.random() * this.processes.length)];
    
    // Log the assignment
    ANALYTICS.logAssignment(randomBadge.eid, randomProcess, {
      assignmentMethod: 'random_test',
      previousLocation: randomBadge.loc,
      shiftCode: randomBadge.scode,
      site: randomBadge.site
    });

    // Update badge location
    randomBadge.loc = randomProcess;
    
    console.log(`[TESTING] Assigned ${randomBadge.name} (${randomBadge.eid}) to ${randomProcess}`);
    
    return {
      employee: randomBadge.name,
      employeeId: randomBadge.eid,
      process: randomProcess,
      shiftCode: randomBadge.scode,
      site: randomBadge.site
    };
  },

  // Perform multiple assignments with delays
  performMultipleAssignments: async function(count = 100) {
    console.log(`\n🚀 [TESTING] Starting ${count} assignment analytics demonstration...`);
    console.log('='.repeat(60));
    
    // Initialize sample data
    this.initializeSampleData();
    console.log(`✅ Initialized ${Object.keys(STATE.badges).length} sample employees`);
    
    const assignments = [];
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    
    // Show initial state
    console.log('\n📊 Initial Analytics State:');
    console.log(`• Sessions: ${STATE.analytics.sessions.length}`);
    console.log(`• Historical Assignments: ${STATE.analytics.history.length}`);
    console.log(`• Performance Records: ${Object.keys(STATE.analytics.performance).length}`);
    
    console.log('\n🔄 Beginning assignment simulation...');
    
    for (let i = 0; i < count; i++) {
      const assignment = this.performRandomAssignment();
      
      if (assignment) {
        assignments.push(assignment);
        
        // Render updates every 10 assignments
        if (i % 10 === 0) {
          renderAllBadges();
          await delay(30); // Small delay for visual updates
          
          // Show interim analytics every 25 assignments
          if (i % 25 === 0 && i > 0) {
            const currentSummary = this.getAnalyticsSummary();
            console.log(`\n📈 Progress Update (Assignment ${i + 1}/${count}):`);
            console.log(`   • Total Assignments: ${currentSummary.totalAssignments}`);
            console.log(`   • Active Employees: ${currentSummary.totalEmployees}`);
            console.log(`   • Currently Assigned: ${currentSummary.assignedBadges}/${currentSummary.currentBadges}`);
          }
        }
        
        // Occasionally reassign someone (simulate movement)
        if (i > 0 && Math.random() < 0.3) {
          this.performRandomReassignment();
        }
        
        // Occasionally mark someone as not present (simulate shift changes)
        if (i > 0 && Math.random() < 0.15) {
          this.simulatePresenceChange();
        }
      } else {
        // If no unassigned badges, reassign someone
        this.performRandomReassignment();
      }
    }
    
    // Final render
    renderAllBadges();
    
    console.log(`\n✅ [TESTING] Completed ${count} assignments!`);
    console.log('='.repeat(60));
    
    // Show final analytics state
    const finalSummary = this.getAnalyticsSummary();
    console.log('\n📊 Final Analytics State:');
    console.log(`• Sessions: ${finalSummary.totalSessions}`);
    console.log(`• Total Assignments: ${finalSummary.totalAssignments}`);
    console.log(`• Performance Records: ${finalSummary.totalEmployees}`);
    console.log(`• Data Persistence: Saved to localStorage`);
    
    console.log('\n📈 Generating comprehensive analytics report...');
    console.log('='.repeat(60));
    
    // Generate comprehensive report
    this.generateAnalyticsReport(assignments);
    
    // Show final recommendations
    console.log('\n🎯 TEST COMPLETION SUMMARY:');
    console.log('• All assignment data has been tracked and analyzed');
    console.log('• Performance metrics calculated for all employees');
    console.log('• Rotation fairness scores generated');
    console.log('• Data persisted for future sessions');
    console.log('• Analytics dashboard ready for viewing');
    console.log('\n👉 Click the "📊 Analytics" button to view the interactive dashboard!');
    console.log('='.repeat(60));
    
    return assignments;
  },

  // Perform a random reassignment
  performRandomReassignment: function() {
    const assignedBadges = Object.values(STATE.badges).filter(b => b.loc !== 'unassigned');
    if (assignedBadges.length === 0) return;
    
    const randomBadge = assignedBadges[Math.floor(Math.random() * assignedBadges.length)];
    const newProcess = this.processes[Math.floor(Math.random() * this.processes.length)];
    
    const oldLocation = randomBadge.loc;
    
    // Log the reassignment
    ANALYTICS.logAssignment(randomBadge.eid, newProcess, {
      assignmentMethod: 'random_reassignment',
      previousLocation: oldLocation,
      shiftCode: randomBadge.scode,
      site: randomBadge.site
    });
    
    randomBadge.loc = newProcess;
    
    console.log(`[TESTING] Reassigned ${randomBadge.name} from ${oldLocation} to ${newProcess}`);
  },

  // Simulate presence changes
  simulatePresenceChange: function() {
    const allBadges = Object.values(STATE.badges);
    if (allBadges.length === 0) return;
    
    const randomBadge = allBadges[Math.floor(Math.random() * allBadges.length)];
    const wasPresent = randomBadge.present;
    randomBadge.present = !randomBadge.present;
    
    if (!randomBadge.present && randomBadge.loc !== 'unassigned') {
      // If marked not present, move to unassigned
      randomBadge.loc = 'unassigned';
    }
    
    console.log(`[TESTING] ${randomBadge.name} marked as ${randomBadge.present ? 'present' : 'not present'}`);
  },

  // Generate comprehensive analytics report
  generateAnalyticsReport: function(assignments) {
    console.log('\n=== ANALYTICS REPORT ===');
    
    // Basic assignment statistics
    const totalAssignments = assignments.length;
    const uniqueEmployees = new Set(assignments.map(a => a.employeeId)).size;
    const processDistribution = {};
    const shiftDistribution = {};
    const siteDistribution = {};
    
    assignments.forEach(a => {
      processDistribution[a.process] = (processDistribution[a.process] || 0) + 1;
      shiftDistribution[a.shiftCode] = (shiftDistribution[a.shiftCode] || 0) + 1;
      siteDistribution[a.site] = (siteDistribution[a.site] || 0) + 1;
    });
    
    console.log(`📊 Assignment Statistics:`);
    console.log(`  • Total Assignments: ${totalAssignments}`);
    console.log(`  • Unique Employees: ${uniqueEmployees}`);
    console.log(`  • Avg Assignments per Employee: ${(totalAssignments/uniqueEmployees).toFixed(2)}`);
    
    console.log(`\n📈 Process Distribution:`);
    Object.entries(processDistribution).forEach(([process, count]) => {
      const percentage = ((count/totalAssignments) * 100).toFixed(1);
      console.log(`  • ${process.toUpperCase()}: ${count} assignments (${percentage}%)`);
    });
    
    console.log(`\n⏰ Shift Code Distribution:`);
    Object.entries(shiftDistribution).forEach(([shift, count]) => {
      const percentage = ((count/totalAssignments) * 100).toFixed(1);
      console.log(`  • ${shift}: ${count} assignments (${percentage}%)`);
    });
    
    console.log(`\n🏢 Site Distribution:`);
    Object.entries(siteDistribution).forEach(([site, count]) => {
      const percentage = ((count/totalAssignments) * 100).toFixed(1);
      console.log(`  • ${site}: ${count} assignments (${percentage}%)`);
    });
    
    // Performance metrics
    console.log(`\n🎯 Performance Insights:`);
    const performanceData = STATE.analytics.performance;
    const topPerformers = Object.entries(performanceData)
      .map(([empId, metrics]) => ({
        employeeId: empId,
        versatilityScore: metrics.versatilityScore,
        totalAssignments: metrics.totalAssignments,
        uniqueProcesses: metrics.uniqueProcesses
      }))
      .sort((a, b) => b.versatilityScore - a.versatilityScore)
      .slice(0, 5);
    
    console.log(`  Top 5 Most Versatile Employees:`);
    topPerformers.forEach((emp, index) => {
      const employee = this.sampleEmployees.find(e => e.id === emp.employeeId);
      console.log(`  ${index + 1}. ${employee?.name || emp.employeeId}: ${emp.versatilityScore.toFixed(1)} score (${emp.totalAssignments} assignments, ${emp.uniqueProcesses} processes)`);
    });
    
    // Rotation analysis
    console.log(`\n🔄 Rotation Analysis:`);
    const rotationScores = {};
    Object.entries(performanceData).forEach(([empId, metrics]) => {
      const rotationScore = ANALYTICS.ROTATION.calculateRotationScore(empId);
      rotationScores[empId] = rotationScore;
    });
    
    const avgRotationScore = Object.values(rotationScores).reduce((a, b) => a + b, 0) / Object.keys(rotationScores).length;
    console.log(`  • Average Rotation Score: ${avgRotationScore.toFixed(1)}/100`);
    
    const fairnessLevel = avgRotationScore >= 80 ? 'Excellent' : 
                         avgRotationScore >= 60 ? 'Good' : 
                         avgRotationScore >= 40 ? 'Fair' : 'Needs Improvement';
    console.log(`  • Rotation Fairness: ${fairnessLevel}`);
    
    // Session information
    console.log(`\n📅 Session Information:`);
    const sessions = STATE.analytics.sessions;
    console.log(`  • Total Sessions: ${sessions.length}`);
    if (sessions.length > 0) {
      const currentSession = sessions[sessions.length - 1];
      console.log(`  • Current Session ID: ${currentSession.id}`);
      console.log(`  • Session Start: ${new Date(currentSession.startTime).toLocaleString()}`);
    }
    
    // Historical data
    const totalHistoricalAssignments = STATE.analytics.history.length;
    console.log(`  • Total Historical Assignments: ${totalHistoricalAssignments}`);
    
    console.log('\n=== END ANALYTICS REPORT ===\n');
    
    // Also display in analytics dashboard if available
    this.updateAnalyticsDashboard();
  },

  // Update analytics dashboard with current data
  updateAnalyticsDashboard: function() {
    // Trigger dashboard update if analytics modal is open
    if (typeof showAnalyticsDashboard === 'function') {
      console.log('[TESTING] Updating analytics dashboard...');
      // The dashboard will automatically show current data when opened
    }
  },

  // Quick test with fewer assignments for demonstration
  quickTest: async function(count = 25) {
    console.log(`[TESTING] Running quick test with ${count} assignments...`);
    return this.performMultipleAssignments(count);
  },

  // Get current analytics summary
  getAnalyticsSummary: function() {
    if (typeof STATE === 'undefined' || !STATE.analytics) {
      console.error('[TESTING] STATE not available for analytics summary');
      return null;
    }
    
    return {
      totalAssignments: STATE.analytics.history.length,
      totalSessions: STATE.analytics.sessions.length,
      totalEmployees: Object.keys(STATE.analytics.performance).length,
      currentBadges: Object.keys(STATE.badges).length,
      assignedBadges: Object.values(STATE.badges).filter(b => b.loc !== 'unassigned').length
    };
  }
};

// Add convenient testing functions to window for easy access
window.testAnalytics = (count) => {
  if (typeof STATE === 'undefined') {
    console.error('❌ System not ready. Please wait for the page to load completely and try again.');
    return;
  }
  return TESTING.performMultipleAssignments(count || 100);
};

window.quickTestAnalytics = (count) => {
  if (typeof STATE === 'undefined') {
    console.error('❌ System not ready. Please wait for the page to load completely and try again.');
    return;
  }
  return TESTING.quickTest(count || 25);
};

window.getAnalyticsSummary = () => {
  if (typeof STATE === 'undefined') {
    console.error('❌ System not ready. Please wait for the page to load completely.');
    return null;
  }
  return TESTING.getAnalyticsSummary();
};
window.showTestingHelp = () => {
  console.log('\n=== TESTING FUNCTIONS AVAILABLE ===');
  console.log('• testAnalytics(count) - Run full test with specified number of assignments (default: 100)');
  console.log('• quickTestAnalytics(count) - Run quick test (default: 25 assignments)');
  console.log('• getAnalyticsSummary() - Get current analytics summary');
  console.log('• TESTING.initializeSampleData() - Reset with sample employee data');
  console.log('• TESTING.generateAnalyticsReport() - Show current analytics report');
  console.log('\nExample: testAnalytics(50) - Run test with 50 assignments');
  console.log('Example: quickTestAnalytics() - Run quick 25-assignment test\n');
};

console.log('[TESTING] Testing system loaded. Type showTestingHelp() for available functions.');

// Display available testing options immediately
setTimeout(() => {
  console.log('\n🧪 ANALYTICS TESTING SYSTEM READY 🧪');
  console.log('====================================');
  console.log('The Virtual Labor Board Portal now includes comprehensive analytics testing!');
  console.log('');
  console.log('🎯 QUICK START:');
  console.log('• Click the green "🧪 Test" button in the header to run 100 assignments automatically');
  console.log('• Or type: testAnalytics() in this console');
  console.log('• For a quick demo: quickTestAnalytics(25)');
  console.log('');
  console.log('📊 WHAT THE TEST DOES:');
  console.log('• Creates 20 sample employees with different shifts and sites');
  console.log('• Performs 100 random assignments across 8 processes');
  console.log('• Tracks performance metrics, versatility scores, and rotation fairness');
  console.log('• Generates comprehensive analytics with process distribution');
  console.log('• Shows real-time assignment tracking and session management');
  console.log('');
  console.log('📈 ANALYTICS FEATURES DEMONSTRATED:');
  console.log('• Assignment history tracking');
  console.log('• Employee performance scoring');
  console.log('• Versatility analysis (how many different processes each employee works)');
  console.log('• Rotation fairness scoring (prevents repetitive assignments)');
  console.log('• Process distribution analysis');
  console.log('• Shift code and site distribution');
  console.log('• Session management and time tracking');
  console.log('');
  console.log('Type showTestingHelp() for detailed function list or just click the Test button!');
  console.log('====================================');
  
  // Auto-run a quick demo if no existing data (but only if STATE is available)
  setTimeout(() => {
    if (typeof STATE !== 'undefined' && STATE.analytics && STATE.analytics.history.length === 0) {
      console.log('\n🎬 AUTO-RUNNING QUICK DEMO (25 assignments)...');
      console.log('This demonstrates the analytics system automatically.');
      console.log('For the full 100-assignment test, click the green "🧪 Test" button.\n');
      try {
        TESTING.quickTest(25);
      } catch (error) {
        console.log('⚠️ Auto-demo skipped - system not ready yet');
      }
    }
  }, 3000);
}, 1000);

  // Add debugging functions to window for console access
  window.debugUpload = function() {
    const form = document.getElementById('laborForm');
    const rosterInput = document.getElementById('roster');
    const missingInput = document.getElementById('missing');
    
    console.log('=== UPLOAD DEBUG INFO ===');
    console.log('Form element:', form);
    console.log('Roster input:', rosterInput);
    console.log('Roster files:', rosterInput?.files);
    console.log('Missing input:', missingInput);
    console.log('Missing files:', missingInput?.files);
    console.log('Papa Parse available:', typeof Papa !== 'undefined');
    console.log('==========================');
    
    if (rosterInput?.files?.length > 0) {
      console.log('Roster file details:', {
        name: rosterInput.files[0].name,
        size: rosterInput.files[0].size,
        type: rosterInput.files[0].type,
        lastModified: new Date(rosterInput.files[0].lastModified)
      });
    }
  };
  
  window.testFormSubmission = function() {
    const form = document.getElementById('laborForm');
    if (form) {
      console.log('Triggering form submission manually...');
      const submitEvent = new Event('submit');
      form.dispatchEvent(submitEvent);
    } else {
      console.error('Form not found!');
    }
  };

  window.debugAssignmentPersistence = function() {
    console.log('=== ASSIGNMENT PERSISTENCE DEBUG ===');
    
    // Check localStorage
    const raw = localStorage.getItem('vlab:lastRoster');
    console.log('localStorage data exists:', !!raw);
    
    if (raw) {
      try {
        const snap = JSON.parse(raw);
        console.log('Parsed snapshot:', {
          hasBadges: !!snap.badges,
          badgeCount: snap.badges ? Object.keys(snap.badges).length : 0,
          hasSites: !!snap.sites,
          currentSite: snap.currentSite,
          siteKeys: snap.sites ? Object.keys(snap.sites) : []
        });
        
        if (snap.badges) {
          const assigned = Object.values(snap.badges).filter(b => 
            b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere'
          );
          console.log(`Badges with assignments in localStorage: ${assigned.length}`);
          assigned.forEach(b => console.log(`  - ${b.name} → ${b.loc} (site: ${b.site})`));
        }
        
        if (snap.sites) {
          Object.keys(snap.sites).forEach(siteKey => {
            const assignments = snap.sites[siteKey].assignments || {};
            const count = Object.keys(assignments).length;
            console.log(`${siteKey} site assignments: ${count}`);
            if (count > 0) {
              Object.entries(assignments).forEach(([badgeId, loc]) => {
                const badge = snap.badges[badgeId];
                console.log(`  - ${badge?.name || badgeId} → ${loc}`);
              });
            }
          });
        }
      } catch (error) {
        console.error('Error parsing localStorage data:', error);
      }
    }
    
    // Check current STATE
    console.log('\nCurrent STATE:');
    console.log('Current site:', STATE.currentSite);
    console.log('Badges count:', Object.keys(STATE.badges || {}).length);
    console.log('Sites:', Object.keys(STATE.sites || {}));
    
    if (STATE.badges) {
      const assigned = Object.values(STATE.badges).filter(b => 
        b.loc !== 'unassigned' && b.loc !== 'assigned-elsewhere'
      );
      console.log(`Current badges with assignments: ${assigned.length}`);
      assigned.forEach(b => console.log(`  - ${b.name} → ${b.loc} (site: ${b.site}, hidden: ${b.hidden})`));
    }
    
    console.log('====================================');
  };

  window.forceRestoreAssignments = function() {
    console.log('=== FORCE RESTORE ASSIGNMENTS ===');
    
    const raw = localStorage.getItem('vlab:lastRoster');
    if (!raw) {
      console.log('No saved data found');
      return;
    }
    
    try {
      const snap = JSON.parse(raw);
      if (snap.badges) {
        console.log('Forcing restoration of all assignments...');
        
        // Simple restore: just copy all assignments from snapshot
        Object.keys(snap.badges).forEach(badgeId => {
          if (STATE.badges[badgeId]) {
            const savedBadge = snap.badges[badgeId];
            const currentBadge = STATE.badges[badgeId];
            
            if (savedBadge.loc !== 'unassigned') {
              console.log(`Restoring ${currentBadge.name}: ${currentBadge.loc} → ${savedBadge.loc}`);
              currentBadge.loc = savedBadge.loc;
            }
          }
        });
        
        // Re-render everything
        renderAllBadges();
        setCounts();
        
        console.log('Force restore completed');
      }
    } catch (error) {
      console.error('Error in force restore:', error);
    }
  };

}); // End of DOMContentLoaded
