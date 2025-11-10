// router.js - lightweight section router with dynamic partial loading and caching
(function(){
  // Minimal router: only toggles between inline Home and Site Boards.
  function setActive(id){
    document.querySelectorAll('.app-section').forEach(sec => sec.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  window.showSection = function(sectionId){
    if (sectionId === 'section-home') {
      setActive('section-home');
    } else {
      setActive('section-site-boards');
    }
  };

  window.navigateToSite = function(site){
    setActive('section-site-boards');
    const headerSel = document.getElementById('headerSiteSelector');
    const formSel = document.getElementById('site');
    if (headerSel) headerSel.value = site;
    if (formSel) formSel.value = site;
    try{
      window.STATE && (STATE.currentSite = site);
      window.applySiteFilter && applySiteFilter();
      window.renderAllBadges && renderAllBadges();
      window.setCounts && setCounts();
    }catch(e){ console.warn('[router] site switch failed', e); }
  };
})();
