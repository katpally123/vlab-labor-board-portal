// app.js for vlab-labor-board-portal
// Handles form logic, file parsing, headcount calculation, dept/site/shift filtering per requirements

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('laborForm');
  const output = document.getElementById('output');
  const shiftTypeBar = document.getElementById('shiftTypeBar');

  // Dept/area validation
  const yhm2DeptIDs = [1211010, 1211020, 1211030, 1211040, 1299010, 1299020, 1299030, 1299040];
  const ydd2DeptIDs = [1211070, 1299070];
  // Split logic by shift pattern/shift code
  const dayShiftCodes = ["DA","DB","DC","DL","DN","DH"];
  const nightShiftCodes = ["NA","NB","NC","NL","NN","NH"];

  // Shift type logic mapping
  const shiftTypeMap = {
    day: { 0: 'FHD', 1: 'FHD', 2: 'FHD', 3: 'FHD', 4: 'BHD', 5: 'BHD', 6: 'BHD' },
    night: { 0: 'FHN', 1: 'FHN', 2: 'FHN', 3: 'FHN', 4: 'BHN', 5: 'BHN', 6: 'BHN' }
  };

  form.addEventListener('change', () => {
    const date = form.date.value;
    const shift = form.shift.value;
    if (!date) return shiftTypeBar.textContent = "";
    const dow = new Date(date).getDay();
    const type = shiftTypeMap[shift][dow];
    shiftTypeBar.textContent = `Detected: ${type}`;
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    output.textContent = 'Processing files...';
    const rosterFile = form.roster.files[0];
    if (!rosterFile) {
      output.textContent = 'Roster file required.';
      return;
    }
    let swapIN = 0, swapOUT = 0, vet = 0, vto = 0, shareIN = 0, shareOUT = 0;
    let doneCount = 1;
    const finish = (hcBase) => {
      if (++doneCount < 4) return;
      const plannedVolumeNode = document.createElement('input');
      plannedVolumeNode.type = 'number';
      plannedVolumeNode.value = 0;
      plannedVolumeNode.className = 'border p-1 mx-2';
      plannedVolumeNode.id = 'plannedVolume';
      plannedVolumeNode.min = 0;
      const hcCalc = hcBase - swapOUT + swapIN + vet - vto + shareIN - shareOUT;
      output.innerHTML = `
        <div class='flex space-x-4 items-center'>
          <span class='custom-output-label'>Date:</span> ${form.date.value}
          <span class='custom-output-label'>Day:</span> ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(form.date.value).getDay()]}
          <span class='custom-output-label'>Shift:</span> ${form.shift.value}
          <span class='custom-output-label'>Site:</span> ${form.site.value}
          <span class='custom-output-label'>Type:</span> ${shiftTypeMap[form.shift.value][new Date(form.date.value).getDay()]}
          <span class='custom-output-label'>Expected HC:</span> <span id='outHC'>${hcCalc}</span>
          <span class='custom-output-label'>Planned Volume:</span> </span>
        </div>
        <div class='mt-4'>Volume per Head: <span id='vph'>0</span></div>
      `;
      output.querySelector('.custom-output-label:last-child').appendChild(plannedVolumeNode);
      plannedVolumeNode.addEventListener('input', () => {
        const planned = Number(plannedVolumeNode.value);
        const vph = hcCalc > 0 ? (planned / hcCalc).toFixed(2) : 0;
        document.getElementById('vph').textContent = vph;
      });
    };
    // Parse roster with additional shift filtering
    Papa.parse(rosterFile, {
      header: true,
      dynamicTyping: true,
      complete: (results) => {
        const site = form.site.value;
        const shift = form.shift.value;
        // Shift pattern/shift code field possible names
        const shiftFields = ["Shift Pattern","ShiftCode","Shift Code","Shift","Pattern"];
        function getShiftCode(row) {
          for (const field of shiftFields) {
            if (row[field]) return String(row[field]).trim();
          }
          return "";
        }
        const filtered = results.data.filter(row => {
          const deptID = Number(row.DepartmentID ?? row['Department ID'] ?? row['Dept ID']);
          const mgmtAreaID = Number(row.ManagementAreaID ?? row['Management Area ID']);
          const shiftCode = getShiftCode(row).toUpperCase();
          if (site === 'YHM2' && yhm2DeptIDs.includes(deptID)) {
            if (shift === 'day') return dayShiftCodes.includes(shiftCode);
            if (shift === 'night') return nightShiftCodes.includes(shiftCode);
          }
          if (site === 'YDD2' && ydd2DeptIDs.includes(deptID) && mgmtAreaID === 22) {
            if (shift === 'day') return dayShiftCodes.includes(shiftCode);
            if (shift === 'night') return nightShiftCodes.includes(shiftCode);
          }
          return false;
        });
        finish(filtered.length);
      }
    });
    if (form.swap.files[0]) {
      Papa.parse(form.swap.files[0], {
        header: true,
        complete: (swapResults) => {
          swapIN = swapResults.data.filter(r => r.Direction === 'IN').length;
          swapOUT = swapResults.data.filter(r => r.Direction === 'OUT').length;
          finish(0);
        }
      });
    } else {
      doneCount++;
    }
    if (form.vetvto.files[0]) {
      Papa.parse(form.vetvto.files[0], {
        header: true,
        complete: (vetvtoResults) => {
          vet = vetvtoResults.data.filter(r => r.Type === 'VET').length;
          vto = vetvtoResults.data.filter(r => r.Type === 'VTO').length;
          finish(0);
        }
      });
    } else {
      doneCount++;
    }
    if (form.laborshare.files[0]) {
      Papa.parse(form.laborshare.files[0], {
        header: true,
        complete: (shareResults) => {
          shareIN = shareResults.data.filter(r => r.Direction === 'IN').length;
          shareOUT = shareResults.data.filter(r => r.Direction === 'OUT').length;
          finish(0);
        }
      });
    } else {
      doneCount++;
    }
  });
});
