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

  // In-memory badge store with analytics tracking
  const STATE = { 
    badges: {},
    analytics: {
      history: [], // Assignment history log
      sessions: [], // Work sessions data
      performance: {}, // Employee performance metrics
      patterns: {} // Assignment pattern analysis
    }
  };

  // Analytics and Data Collection System
  const ANALYTICS = {
    // Track assignment changes
    logAssignment: function(badgeId, fromLoc, toLoc, timestamp = new Date()) {
      const badge = STATE.badges[badgeId];
      if (!badge) return;
      
      const logEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: timestamp.toISOString(),
        date: timestamp.toDateString(),
        badgeId: badgeId,
        employeeId: badge.eid,
        employeeName: badge.name,
        shiftCode: badge.scode,
        site: badge.site,
        fromLocation: fromLoc,
        toLocation: toLoc,
        action: fromLoc === 'unassigned' ? 'assign' : (toLoc === 'unassigned' ? 'unassign' : 'reassign'),
        duration: null, // Will be calculated when assignment ends
        sessionId: this.getCurrentSessionId()
      };
      
      STATE.analytics.history.push(logEntry);
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
      const allProcesses = ['cb', 'ibws', 'lineloaders', 'trickle', 'dm', 'idrt', 'pb', 'e2s', 'dockws', 'e2sws', 'tpb', 'tws', 'sap', 'ao5s'];
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
        localStorage.setItem('vlab:analytics', JSON.stringify(STATE.analytics));
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
        
        const allProcesses = ['cb', 'ibws', 'lineloaders', 'trickle', 'dm', 'idrt', 'pb', 'e2s', 'dockws', 'e2sws', 'tpb', 'tws', 'sap', 'ao5s'];
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
        const allProcesses = ['cb', 'ibws', 'lineloaders', 'trickle', 'dm', 'idrt', 'pb', 'e2s', 'dockws', 'e2sws', 'tpb', 'tws', 'sap', 'ao5s'];
        
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
  
  // Debug function to test analytics
  window.debugAnalytics = function() {
    console.log('STATE.analytics:', STATE.analytics);
    console.log('ANALYTICS object:', ANALYTICS);
    console.log('PapaParse available:', typeof Papa !== 'undefined');
  };

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
      
      // Track assignment change for analytics
      const oldLocation = STATE.badges[badgeId].loc;
      const newLocation = key || 'unassigned';
      
      STATE.badges[badgeId].loc = newLocation;
      
      // Log the assignment change
      ANALYTICS.logAssignment(badgeId, oldLocation, newLocation);
      
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
    console.log('[DEBUG] Form submission started');
    output.textContent = 'Processing files…';

    const rosterFile = form.roster.files[0];
    if (!rosterFile){ 
      output.textContent = 'Roster file required.'; 
      console.warn('[DEBUG] No roster file selected');
      return; 
    }
    
    console.log('[DEBUG] Roster file selected:', rosterFile.name, 'size:', rosterFile.size);
    
    const swapFile = form.swap.files[0] || null;
    const vetFile = form.vetvto.files[0] || null;
    const lsFile = form.laborshare.files[0] || null;

    // Check if Papa Parse is available
    if (typeof Papa === 'undefined') {
      output.textContent = 'Error: CSV parser not loaded. Please refresh the page.';
      console.error('[DEBUG] PapaParse library not available');
      return;
    }

    console.log('[DEBUG] Starting CSV parsing...');
    Promise.all([
      parseCsv(rosterFile).catch(err => { console.error('[DEBUG] Roster parsing error:', err); return []; }),
      swapFile ? parseCsv(swapFile).catch(err => { console.error('[DEBUG] Swap parsing error:', err); return []; }) : Promise.resolve([]),
      vetFile ? parseCsv(vetFile).catch(err => { console.error('[DEBUG] VET parsing error:', err); return []; }) : Promise.resolve([]),
      lsFile ? parseCsv(lsFile).catch(err => { console.error('[DEBUG] Labor share parsing error:', err); return []; }) : Promise.resolve([]),
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

      // Start analytics session
      ANALYTICS.endSession(); // End any existing session
      ANALYTICS.startSession({
        date: dateStr,
        shift: shiftSel,
        site: siteSel,
        plannedHC: plannedHC,
        notes: `Roster: ${rosterFile.name}, Badges: ${Object.keys(STATE.badges).length}`
      });

      // persist compact snapshot so user can reload without re-uploading CSV
      try{
        const snap = { badges: STATE.badges, meta: { date: dateStr, shift: shiftSel, site: siteSel, plannedHC } };
        localStorage.setItem('vlab:lastRoster', JSON.stringify(snap));
        console.debug('[save] saved roster snapshot to localStorage (vlab:lastRoster)');
      }catch(_){ /* ignore storage failures */ }
    }).catch(err => { 
      console.error('[DEBUG] Form submission error:', err); 
      output.textContent = `Error processing files: ${err.message || err}. Please check CSV headers and try again.`; 
    });
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

      // Start analytics session for loaded roster
      if (snap.meta) {
        ANALYTICS.endSession(); // End any existing session
        ANALYTICS.startSession({
          date: snap.meta.date,
          shift: snap.meta.shift,
          site: snap.meta.site,
          plannedHC: snap.meta.plannedHC,
          notes: 'Loaded from saved roster'
        });
      }
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

  // Analytics Dashboard Management
  const analyticsModal = document.getElementById('analyticsModal');
  const analyticsBtn = document.getElementById('analyticsBtn');
  const closeAnalyticsBtn = document.getElementById('closeAnalyticsBtn');
  const exportAnalyticsBtn = document.getElementById('exportAnalyticsBtn');
  const clearAnalyticsBtn = document.getElementById('clearAnalyticsBtn');

  // Analytics tab management
  const analyticsTabs = document.querySelectorAll('.analytics-tab');
  const analyticsTabContents = document.querySelectorAll('.analytics-tab-content');

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
    });
  });

  function openAnalytics() {
    analyticsModal.classList.remove('hidden');
    loadAnalyticsContent('overview'); // Load initial content
  }

  function closeAnalytics() {
    analyticsModal.classList.add('hidden');
  }

  function loadAnalyticsContent(tabName) {
    switch(tabName) {
      case 'overview':
        loadOverviewContent();
        break;
      case 'performance':
        loadPerformanceContent();
        break;
      case 'assignments':
        loadAssignmentsContent();
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

  function loadAssignmentsContent() {
    const assignmentHistory = document.getElementById('assignmentHistory');
    const assignmentPatterns = document.getElementById('assignmentPatterns');
    const assignmentRecommendations = document.getElementById('assignmentRecommendations');

    // Recent Assignment History (Last 20)
    const recentHistory = STATE.analytics.history.slice(-20).reverse();
    assignmentHistory.innerHTML = recentHistory.map(entry => `
      <div class="history-item">
        <div class="history-timestamp">${new Date(entry.timestamp).toLocaleString()}</div>
        <div class="history-action">
          ${entry.employeeName} ${entry.action === 'assign' ? 'assigned to' : 
            entry.action === 'unassign' ? 'unassigned from' : 'moved to'} 
          ${entry.toLocation.toUpperCase()}
        </div>
      </div>
    `).join('') || '<p>No assignment history available</p>';

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

  // Enhanced export analytics with multiple formats
  exportAnalyticsBtn?.addEventListener('click', () => {
    // Create comprehensive analytics export
    const currentDate = new Date().toISOString().split('T')[0];
    
    // 1. Full Analytics Export (JSON)
    const analyticsData = {
      exportDate: new Date().toISOString(),
      version: '1.0',
      metadata: {
        totalSessions: STATE.analytics.sessions.length,
        totalAssignments: STATE.analytics.history.length,
        totalEmployees: Object.keys(STATE.analytics.performance).length,
        dataRange: {
          firstRecord: STATE.analytics.history.length > 0 ? STATE.analytics.history[0].timestamp : null,
          lastRecord: STATE.analytics.history.length > 0 ? STATE.analytics.history[STATE.analytics.history.length - 1].timestamp : null
        }
      },
      sessions: STATE.analytics.sessions,
      assignments: STATE.analytics.history,
      employeePerformance: STATE.analytics.performance,
      insights: generateWorkforceInsights(),
      recommendations: ANALYTICS.getOptimizationSuggestions(),
      summary: {
        topPerformers: Object.values(STATE.analytics.performance)
          .sort((a, b) => b.performanceScore - a.performanceScore)
          .slice(0, 5)
          .map(emp => ({
            name: emp.name,
            employeeId: emp.employeeId,
            performanceScore: emp.performanceScore,
            versatility: emp.versatility,
            totalAssignments: emp.totalAssignments
          })),
        processStatistics: generateProcessStatistics(),
        productivityMetrics: calculateOverallProductivityMetrics()
      }
    };
    
    // Export full data as JSON
    const jsonBlob = new Blob([JSON.stringify(analyticsData, null, 2)], {type: 'application/json'});
    const jsonLink = document.createElement('a');
    jsonLink.href = URL.createObjectURL(jsonBlob);
    jsonLink.download = `vlab-analytics-full-${currentDate}.json`;
    jsonLink.click();
    
    // 2. Performance Report (CSV)
    const csvData = generatePerformanceCSV();
    const csvBlob = new Blob([csvData], {type: 'text/csv'});
    const csvLink = document.createElement('a');
    csvLink.href = URL.createObjectURL(csvBlob);
    csvLink.download = `vlab-performance-report-${currentDate}.csv`;
    csvLink.click();
    
    // 3. Assignment History (CSV)
    const assignmentCSV = generateAssignmentHistoryCSV();
    const assignmentBlob = new Blob([assignmentCSV], {type: 'text/csv'});
    const assignmentLink = document.createElement('a');
    assignmentLink.href = URL.createObjectURL(assignmentBlob);
    assignmentLink.download = `vlab-assignment-history-${currentDate}.csv`;
    assignmentLink.click();
    
    // 4. Executive Summary (HTML Report)
    const htmlReport = generateExecutiveReport();
    const htmlBlob = new Blob([htmlReport], {type: 'text/html'});
    const htmlLink = document.createElement('a');
    htmlLink.href = URL.createObjectURL(htmlBlob);
    htmlLink.download = `vlab-executive-summary-${currentDate}.html`;
    htmlLink.click();
    
    alert('Analytics export completed! 4 files have been downloaded:\n1. Full Analytics Data (JSON)\n2. Performance Report (CSV)\n3. Assignment History (CSV)\n4. Executive Summary (HTML)');
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
    if (STATE.analytics.history.length === 0) return 'No assignment history available';
    
    const headers = [
      'Timestamp', 'Date', 'Employee ID', 'Employee Name', 'Shift Code',
      'Site', 'Action', 'From Location', 'To Location', 'Session ID'
    ];
    
    const rows = STATE.analytics.history.map(entry => [
      entry.timestamp,
      entry.date,
      entry.employeeId,
      entry.employeeName,
      entry.shiftCode,
      entry.site,
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
    closeAnalytics();
    alert('Analytics data cleared successfully.');
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
    
    // Confirm lock action
    const confirmMessage = `Lock ${assignedBadges.length} assignments and activate smart rotation system?\n\nThis will:\n• Lock current assignments\n• Generate smart assignment queue for next shift\n• Show rotation management panel\n• Track fairness and create alerts\n\nProceed?`;
    
    if (!confirm(confirmMessage)) return;
    
    try {
      // Lock assignments and activate rotation system
      const lockRecord = ANALYTICS.ROTATION.lockAssignments();
      
      if (lockRecord) {
        alert(`✅ Smart Rotation System Activated!\n\n• Assignments locked and analyzed\n• Smart assignment queue generated\n• Rotation management panel opened\n• Fairness alerts created\n\nCheck the rotation panel on the right for smart recommendations.`);
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

}); // End of DOMContentLoaded
