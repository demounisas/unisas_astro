/* Sends lead-form submissions to the Wix backend (/_functions/lead), which commits
   them to Supabase, then emails the admin and appends to Google Sheets.
   Registered after the validation script, so invalid forms never reach this handler. */
(function(){
  var ENDPOINT = window.UNISAS_LEAD_ENDPOINT || '/api/lead';

  var KEYS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','gbraid','wbraid','fbclid'];
  var STORE = 'unisas_touch';

  // Remember how the visitor arrived: they often land on one page and submit on another.
  // A new paid/UTM click replaces the stored touch; otherwise the first touch is kept for 30 days.
  function readTouch(){ try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch(e){ return null; } }
  function captureTouch(){
    var q = new URLSearchParams(location.search), utm = {};
    KEYS.forEach(function(k){ if(q.get(k)) utm[k] = q.get(k); });
    var ref = '';
    try { ref = document.referrer && new URL(document.referrer).hostname !== location.hostname ? document.referrer : ''; } catch(e){}
    var stored = readTouch();
    if(stored && Date.now() - stored.at < 30 * 864e5 && !Object.keys(utm).length) return stored;
    var touch = { utm: Object.keys(utm).length ? utm : null, referrer: ref, landing_page: location.href, at: Date.now() };
    try { localStorage.setItem(STORE, JSON.stringify(touch)); } catch(e){}
    return touch;
  }
  var touch = captureTouch();

  document.addEventListener('submit', function(e){
    var form = e.target;
    if(!form.classList || !form.classList.contains('lead-form')) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // replaces the page's redirect-only handler
    if(form.dataset.sending) return;

    var data = {};
    Array.prototype.forEach.call(form.elements, function(el){
      if(el.name && !el.disabled) data[el.name] = el.value;
    });
    data.page_url = location.href;
    data.referrer = touch.referrer;
    data.utm = touch.utm;
    data.landing_page = touch.landing_page;

    var btn = form.querySelector('button[type="submit"]');
    var label = btn && btn.innerHTML;
    form.dataset.sending = '1';
    if(btn){ btn.disabled = true; btn.textContent = 'Sending…'; }

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function(r){
      if(!r.ok) throw new Error('HTTP ' + r.status);
      if(window.gtag) gtag('event', 'generate_lead');
      window.location.href = '/thank-you';
    }).catch(function(){
      delete form.dataset.sending;
      if(btn){ btn.disabled = false; btn.innerHTML = label; }
      var note = form.querySelector('.lead-form-error');
      if(!note){
        note = document.createElement('p');
        note.className = 'lead-form-error';
        note.setAttribute('role', 'alert');
        note.style.cssText = 'color:#b42318;margin:8px 0 0;font-size:14px';
        form.appendChild(note);
      }
      note.textContent = 'Sorry, we could not send your request. Please try again or call 044-46042744.';
    });
  }, true);
})();
