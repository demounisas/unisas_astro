/* Small motion layer for the Odoo module pages (CRM, Sales, Inventory, Purchase).
   Sections fade up as they scroll into view, card grids stagger in, and headline
   numbers count up once. Does nothing for visitors who prefer reduced motion. */
(function () {
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var targets = [];
  function add(el, i) { if (el && targets.indexOf(el) < 0) { el.style.setProperty('--rd', i || 0); targets.push(el); } }
  function isGrid(el) { var d = getComputedStyle(el).display; return d === 'grid' || d === 'flex'; }

  document.querySelectorAll('main section > .container').forEach(function (box) {
    [].forEach.call(box.children, function (child) {
      if (child.tagName === 'SCRIPT') return;
      var kids = [].filter.call(child.children, function (k) { return k.tagName !== 'SCRIPT'; });
      // a two- or three-column layout: reveal each column, one after another
      if (isGrid(child) && kids.length > 1 && kids.length <= 4 && !/^(UL|OL)$/.test(child.tagName)) kids.forEach(add);
      // a list of cards: stagger each card
      else if (/^(UL|OL)$/.test(child.tagName) && isGrid(child) && kids.length > 2) kids.forEach(function (k, i) { add(k, Math.min(i, 6)); });
      else add(child, 0);
    });
  });

  // numbers in KPI tiles count up when they appear
  var counters = [].slice.call(document.querySelectorAll('.pu-kpis b, .iv-kpis b, .crm-kpi b, .crm-kpi strong'));
  function countUp(el) {
    var m = el.textContent.trim().match(/^([^\d]*)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return;
    var raw = m[2], end = parseFloat(raw.replace(/,/g, '')), dec = (raw.split('.')[1] || '').length, indian = /\d,\d\d,/.test(raw), t0 = null;
    function fmt(v) {
      var s = v.toFixed(dec);
      if (raw.indexOf(',') < 0) return s;
      return Number(s).toLocaleString(indian ? 'en-IN' : 'en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }
    function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / 1100), e = 1 - Math.pow(1 - p, 3);
      el.textContent = m[1] + fmt(end * e) + m[3];
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('is-in');
      io.unobserve(en.target);
      en.target.querySelectorAll && [].forEach.call(en.target.querySelectorAll('[data-count]'), function (c) { c.removeAttribute('data-count'); countUp(c); });
      if (en.target.hasAttribute('data-count')) { en.target.removeAttribute('data-count'); countUp(en.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  counters.forEach(function (c) { c.setAttribute('data-count', ''); });
  targets.forEach(function (el) {
    el.classList.add('reveal-ready'); io.observe(el);
    // drop the stagger delay once revealed, so hover effects respond at once
    el.addEventListener('transitionend', function () { if (el.classList.contains('is-in')) el.style.setProperty('--rd', 0); });
  });
  // counters that sit outside any revealed block still count when seen
  counters.forEach(function (c) { if (!c.closest('.reveal-ready')) io.observe(c); });
})();
