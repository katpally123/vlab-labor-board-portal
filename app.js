// app.js — roster logic + optional files + shift/site filters + overlapping badges with tick presence

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('laborForm');
  const output = document.getElementById('output');

  // Summary DOM refs
  const elDate = document.getElementById('displayDate');
  const elDay = document.getElementById('displayDay');
  const elShift = document.getElementById('displayShift');
  const elType = document.getElementById('displayShiftType');
  const elSite = document.getElementById('displaySite');
  const elPlanned = document.getElementById('displayPlannedHC');
  const elActual = document.getElementById('displayActualHC');
  const codesBar = document.getElementById('codesBar');

  // Unassigned badges
  const unassignedWrap = document.getElementById('unassignedBadges');
  const unassignedCount = document.getElementById('unassignedCount');
  const tileUnassigned = document.getElementById('tile-unassigned');

  // ===== Foundation: site & dept mapping =====
  const YHM2_INB = [1211010,1211020,1299010,1299020];
  const YHM2_OUTB = [1211030,1211040,1299030,1299040];
  const YDD2 = [1211070,1299070];

  // shift type mapping (0=Sun..6=Sat)
  const shiftTypeMap = {
    day:   {0:'FHD',1:'FHD',2:'FHD',3:'FHD',4:'BHD',5:'BHD',6:'BHD'},
    night: {0:'FHN',1:'FHN',2:'FHN',3:'FHN',4:'BHN',5:'BHN',6:'BHN'}
  };

  // Allowed codes per weekday (day side). Night mirrors NA..NH
  const WEEK_ALLOWED = {
    'Sunday':    ['DA','DB','DL','DH','NA','NB','NL','NH'],
    'Monday':    ['DA','DC','DL','DH','NA','NC','NL','NH'],
    'Tuesday':   ['DA','DC','DL','DH','NA','NC','NL','NH'],
    'Wednesday': ['DA','DB','DL','DH','NB','NL','NH'],
    'Thursday':  ['DB','DC','DL','DH','NB','NC','NL','NH'],
    'Friday':    ['DB','DC','DL','DH','NB','NC','NL','NH'],
    'Saturday':  ['DB','DL','DH','NB','NL','NH']
  };

  const DAY_SET   = new Set(['DA','DB','DC','DL','DN','DH']);
  const NIGHT_SET = new Set(['NA','NB','NC','NL','NN','NH']);

  // Helpers
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const shortDay = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  function classifySite(row){
    const d = toNum(row['Department ID'] ?? row.DepartmentID ?? row['Dept ID']);
    const a = toNum(row['Management Area ID'] ?? row.ManagementAreaID);
    if (YHM2_INB.includes(d) || YHM2_OUTB.includes(d)) return 'YHM2';
    if (YDD2.includes(d) && a === 22) return 'YDD2';
    if (YDD2.includes(d) && a === 27) return 'Shared-ICQA';
    return 'Other';
  }
  function shiftCodeOf(v){
    if (!v) return '';
    const s = String(v).trim();
    return s.slice(0,2).toUpperCase();
  }
  function toNum(x){
    const n = Number(x);
    return Number.isFinite(n) ? n : NaN;
  }
  function getAllowedCodes(dateStr, shift){
    if (!dateStr) return [];
    const d = new Date(dateStr);
    const wk = dayNames[d.getDay()];
    const base = WEEK_ALLOWED[wk] || [];
    const set = (shift === 'day') ? DAY_SET : NIGHT_SET;
    return base.filter(c => set.has(c));
  }

  // Dynamic shift type preview on change
  form.addEventListener('change', () => {
    const date = form.date.value;
    const shift = form.querySelector('input[name="shift"]:checked')?.value || 'day';
    if (!date){ elType.textContent = '-'; return; }
    const dow = new Date(date).getDay();
    elType.textContent = shiftTypeMap[shift][dow];
  });

  // ===== Core submit =====
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    output.textContent = 'Processing files…';

    const rosterFile = form.roster.files[0];
    if (!rosterFile){ output.textContent = 'Roster file required.'; return; }

    // load optional files concurrently
    const swapFile = form.swap.files[0] || null;
    const vetFile  = form.vetvto.files[0] || null;
    const lsFile   = form.laborshare.files[0] || null;

    Promise.all([
      parseCsv(rosterFile),
      swapFile ? parseCsv(swapFile) : Promise.resolve([]),
      vetFile  ? parseCsv(vetFile)  : Promise.resolve([]),
      lsFile   ? parseCsv(lsFile)   : Promise.resolve([]),
    ]).then(([roster, swaps, vetvto, labshare]) => {
      // === Compute ===
      const siteSel = form.site.value;
      const dateStr = form.date.value;
      const shiftSel = form.querySelector('input[name="shift"]:checked')?.value || 'day';
      const dowIdx = new Date(dateStr).getDay();
      const dayName = dayNames[dowIdx];

      // fill summary static bits
      elDate.textContent  = dateStr || '-';
      elDay.textContent   = dateStr ? shortDay[dowIdx] : '-';
      elShift.textContent = shiftSel[0].toUpperCase() + shiftSel.slice(1);
      elType.textContent  = shiftTypeMap[shiftSel][dowIdx];
      elSite.textContent  = siteSel;

      const allowed = new Set(getAllowedCodes(dateStr, shiftSel));
      if (allowed.size){
        codesBar.classList.remove('hidden');
        codesBar.textContent = `Codes active for ${dayName} (${elShift.textContent}): ${[...allowed].sort().join(', ')}`;
      }else{
        codesBar.classList.add('hidden');
        codesBar.textContent = '';
      }

      // Filter roster
      const activeRows = roster.filter(r => String(r['Employee Status'] ?? r.Status ?? '').toLowerCase() === 'active');

      const filtered = activeRows.filter(r => {
        const site = classifySite(r);
        if (siteSel === 'YHM2' && site !== 'YHM2') return false;
        if (siteSel === 'YDD2' && site !== 'YDD2') return false;
        const sc = shiftCodeOf(r['Shift Pattern'] ?? r['ShiftCode'] ?? r['Shift Code'] ?? r['Shift'] ?? r['Pattern']);
        if (!allowed.has(sc)) return false;
        // Day vs Night hard check
        if (shiftSel === 'day' && !DAY_SET.has(sc)) return false;
        if (shiftSel === 'night' && !NIGHT_SET.has(sc)) return false;
        return true;
      });

      // Adjustments from optional files
      // Swaps: Direction = IN/OUT (case-insensitive)
      const swapIN  = swaps.filter(x => (x.Direction ?? x.direction ?? '').toString().toUpperCase() === 'IN').length;
      const swapOUT = swaps.filter(x => (x.Direction ?? x.direction ?? '').toString().toUpperCase() === 'OUT').length;

      // VET/VTO: Type = VET/VTO and (Accepted == Yes if present)
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

      // Labor share: Direction IN/OUT
      const lsIN  = labshare.filter(x => (x.Direction ?? x.direction ?? '').toString().toUpperCase() === 'IN').length;
      const lsOUT = labshare.filter(x => (x.Direction ?? x.direction ?? '').toString().toUpperCase() === 'OUT').length;

      const baseHC = filtered.length;
      const plannedHC = baseHC - swapOUT + swapIN + vet - vto + lsIN - lsOUT;

      // Summary
      elPlanned.textContent = plannedHC.toString();
      elActual.textContent  = '0';

      // Build overlapping badges in Unassigned header
      renderBadges(filtered, unassignedWrap, elActual);

      // Update unassigned counts (tile + header)
      unassignedCount.textContent = filtered.length.toString();
      tileUnassigned.textContent  = filtered.length.toString();

      // Optional: VPH calc when user enters planned volume
      setupVPH(plannedHC);

      output.textContent = ''; // clear message
    }).catch(err => {
      console.error(err);
      output.textContent = 'Error processing files. Check CSV headers and try again.';
    });
  });

  // ===== Helpers =====
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

  function setupVPH(hc){
    const volInput = document.getElementById('plannedVolumeStub');
    const vphNodeId = 'vph-inline';
    // create inline VPH readout once
    let vphNode = document.getElementById(vphNodeId);
    if (!vphNode){
      vphNode = document.createElement('div');
      vphNode.id = vphNodeId;
      vphNode.className = 'text-sm text-gray-600 mt-1';
      document.getElementById('output').appendChild(vphNode);
    }
    const update = () => {
      const planned = Number(volInput.value || 0);
      const vph = hc > 0 ? (planned / hc).toFixed(2) : '0';
      vphNode.textContent = `Volume per Head: ${vph}`;
    };
    volInput.removeEventListener('input', update);
    volInput.addEventListener('input', update);
    update();
  }

  function renderBadges(rows, container, actualEl){
    container.innerHTML = '';
    let presentCount = 0;

    rows.forEach(r => {
      const name = (r['Employee Name'] ?? r['Name'] ?? '').toString();
      const id   = (r['Employee ID']   ?? r['ID']   ?? '').toString();
      const sc   = shiftCodeOf(r['Shift Pattern'] ?? r['ShiftCode'] ?? r['Shift Code'] ?? r['Shift'] ?? r['Pattern']);

      const b = document.createElement('div');
      b.className = `badge ${sc}`;
      b.title = `${name} • ${id} • ${sc}`;
      b.textContent = name; // name only to save space

      // presence by tick toggle
      b.addEventListener('click', () => {
        if (b.classList.contains('present')){
          b.classList.remove('present');
          const t = b.querySelector('.tick'); if (t) t.remove();
          presentCount = Math.max(0, presentCount - 1);
        }else{
          b.classList.add('present');
          const t = document.createElement('div'); t.className = 'tick'; t.textContent = '✓';
          b.appendChild(t);
          presentCount += 1;
        }
        actualEl.textContent = String(presentCount);
      });

      container.appendChild(b);
    });
  }

  // Export (basic JSON of current header & simple roster cache if needed later)
  document.getElementById('exportLogBtn')?.addEventListener('click', () => {
    const payload = {
      date: elDate.textContent,
      day: elDay.textContent,
      shift: elShift.textContent,
      site: elSite.textContent,
      shiftType: elType.textContent,
      plannedHC: elPlanned.textContent,
      actualHC: elActual.textContent,
      ts: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vlab-shift-summary-${payload.date || 'NA'}.json`;
    a.click();
  });
});
