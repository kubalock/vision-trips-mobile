/* Vision Trips — customer experience. No dependencies. Everything degrades gracefully without JS. */
(function () {
  'use strict';
  var VT = window.VT || {};
  var doc = document;
  var $ = function (sel, root) { return (root || doc).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function rest(path, options, withoutNonce) {
    options = options || {};
    var headers = { 'Accept': 'application/json' };
    if (VT.nonce && !withoutNonce) headers['X-WP-Nonce'] = VT.nonce;
    if (options.body) headers['Content-Type'] = 'application/json';
    var url = VT.rest + 'trip/' + encodeURIComponent(VT.token) + '/' + path;
    return fetch(url, {
      method: options.method || 'GET',
      headers: headers,
      credentials: 'same-origin',
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { j = null; }
        // A stale REST nonce (page left open for a day) makes WordPress refuse even public routes: retry without it.
        if (r.status === 403 && j && j.code === 'rest_cookie_invalid_nonce' && !withoutNonce) { return rest(path, options, true); }
        if (!r.ok || !j) {
          var msg = (j && j.message) ? j.message : ('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
          diag('REST ' + path + ' failed — ' + msg, url);
          throw new Error(j && j.message ? j.message : 'Something went wrong.');
        }
        return j;
      });
    });
  }
  /* Admin-only diagnostics: console + the Content sources panel. Customers never see these. */
  function diag(message, detail) {
    if (!VT.admin) return;
    try { console.warn('[Vision Trips] ' + message, detail || ''); } catch (e) {}
    addRequests([{ method: 'JS', endpoint: detail || '', status: 0, ms: 0, ok: false, error: message }]);
  }

  /* ---- Async sections (Places, Widgety, AI, flights, weather) ----
     Each wrapper renders a skeleton first. In production the HTML comes from the REST API; in the preview build
     it sits in an inline <template> and is swapped in after a short delay so the loading state can be reviewed. */
  var SK_TEXT = '<div class="vt-sk vt-sk--text" aria-hidden="true"><span class="vt-sk__line"></span><span class="vt-sk__line"></span><span class="vt-sk__line"></span></div>';
  function landed(el, html, provenance, pending) {
    // Still being written in the background: keep a shimmering placeholder rather than an empty gap.
    if (!html && pending) { el.innerHTML = SK_TEXT; el.dataset.loaded = '1'; delete el.dataset.loading; return; }
    el.innerHTML = html || '';
    el.dataset.loaded = '1';
    delete el.dataset.loading;
    el.classList.add('is-landed');
    if (!html) {
      var s = el.closest('section');
      var keep = ['weather', 'flights'].indexOf(el.dataset.section) !== -1 || el.dataset.section.indexOf('airline-') === 0 || el.dataset.section.indexOf('airport-') === 0;
      if (s && !keep && s.querySelectorAll('.vt-async[data-loaded="0"]').length === 0 && !s.querySelector('.vt-async.is-landed:not(:empty)')) s.hidden = true;
    }
    enhance(el);
    if (provenance && provenance.length) addSources(provenance);
  }
  function loadSection(el, done) {
    done = done || function () {};
    if (el.dataset.loaded === '1' || el.dataset.loading) { done(); return; }
    el.dataset.loading = '1';
    if (el.dataset.preview === '1') {
      var t = el.querySelector('template[data-fragment]');
      setTimeout(function () { landed(el, t ? t.innerHTML : ''); done(); }, 500 + Math.random() * 500);
      return;
    }
    rest('section/' + el.dataset.section).then(function (j) {
      if (el.dataset.polls && el.dataset.polls !== '0' && el.innerHTML === (j.html || '')) { el.dataset.loaded = '1'; delete el.dataset.loading; }
      else landed(el, j.html, j.provenance, j.pending);
      if (j.requests && j.requests.length) addRequests(j.requests);
      var refresh = parseInt(el.dataset.refresh || '0', 10);
      if (refresh > 0) setTimeout(function () { el.dataset.loaded = '0'; enqueue(el); }, refresh * 1000);
      // AI copy still being written in the background: quietly re-check a few times.
      var polls = parseInt(el.dataset.polls || '0', 10);
      if (j.pending && polls < 30) { el.dataset.polls = String(polls + 1); setTimeout(function () { el.dataset.loaded = '0'; enqueue(el); }, polls < 3 ? 8000 : 12000); }
      done();
    }).catch(function (err) {
      // Never show an error to a customer: the section simply isn't there.
      diag('Section "' + el.dataset.section + '" hidden: ' + (err && err.message ? err.message : err));
      delete el.dataset.loading;
      landed(el, '');
      done();
    });
  }
  function addSources(rows) {
    var body = $('[data-sources-body]');
    if (!body) return;
    rows.forEach(function (r) {
      var tr = doc.createElement('tr'); tr.className = r.ok ? 'is-ok' : 'is-missing';
      if (r.ref) tr.dataset.ref = r.ref;
      [r.section, r.source, r.detail].forEach(function (c, i) { var td = doc.createElement('td'); td.textContent = c || ''; if (i === 2 && r.ref) { var fb = doc.createElement('span'); fb.className = 'vt-fb'; fb.innerHTML = '<button type="button" data-fb="good">Good</button><button type="button" data-fb="rewrite">Rewrite…</button><button type="button" data-fb="never">Never</button>'; td.appendChild(fb); } tr.appendChild(td); });
      body.appendChild(tr);
    });
  }
  /* Admin feedback on AI copy */
  doc.addEventListener('click', function (e) {
    var b = e.target.closest('[data-fb]');
    if (!b) return;
    var tr = b.closest('tr'); var ref = tr && tr.dataset.ref; if (!ref) return;
    var verdict = b.dataset.fb, note = '';
    if (verdict === 'rewrite') { note = prompt('What should change? (e.g. shorter, more factual, mention the pool, no mention of the spa)'); if (note === null) return; }
    fetch(VT.rest + 'ai/feedback', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': VT.nonce }, body: JSON.stringify({ ref: ref, verdict: verdict, note: note || '' }) })
      .then(function (r) { return r.json(); }).then(function (j) { var s = doc.createElement('span'); s.className = 'vt-fb__done'; s.textContent = j.message || 'Saved'; b.parentNode.replaceWith(s); }).catch(function () { alert('Could not save feedback.'); });
  });

  /* ---- Engagement events: short names, short details, batched, sent with sendBeacon ---- */
  var evQueue = [], evTimer = null;
  function track(name, detail) {
    if (!VT.events) return;
    evQueue.push({ name: name, detail: (detail || '').toString().slice(0, 80) });
    if (evQueue.length >= 10) flushEvents(); else if (!evTimer) evTimer = setTimeout(flushEvents, 4000);
  }
  function flushEvents() {
    evTimer = null;
    if (!evQueue.length || !VT.events) return;
    var payload = JSON.stringify({ events: evQueue.splice(0, 25) });
    var url = VT.rest + 'trip/' + encodeURIComponent(VT.token) + '/events';
    if (navigator.sendBeacon) { try { navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' })); return; } catch (e) {} }
    fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
  }
  function initEvents() {
    if (!VT.events) return;
    track('page_view', VT.stage || '');
    doc.addEventListener('click', function (e) {
      var a = e.target.closest('a, button, summary');
      if (!a) return;
      if (a.matches('.vt-nav a')) track('nav_tap', a.dataset.nav || '');
      else if (a.hasAttribute('data-open-accept')) track('accept_start', '');
      else if (a.matches('.vt-docs a')) track('doc_open', (a.querySelector('strong') || a).textContent.trim());
      else if (a.matches('[data-pay-payment], .vt-pay .vt-btn--primary')) track('pay_click', '');
      else if (a.matches('[data-refer]')) track('refer_tap', '');
      else if (a.matches('[data-share]')) track('share_tap', '');
      else if (a.matches('[data-ask]')) { var li = a.closest('.vt-extra'); if (li) track(li.classList.contains('vt-extra--idea') ? 'idea_ask' : 'upsell_add', (li.querySelector('strong') || li).textContent.trim()); else track('ask_tap', (a.dataset.askPrefill || '').slice(0, 60)); }
      else if (a.matches('.vt-home__card') && /review/i.test(a.getAttribute('href') || '')) track('review_tap', '');
      else if (a.matches('a[href*="/ics/"]')) track('calendar_add', '');
    });
    doc.addEventListener('toggle', function (e) {
      var d = e.target;
      if (!(d instanceof HTMLElement) || !d.open) return;
      if (d.matches('.vt-el__details')) { var kind = d.closest('.vt-el') ? d.closest('.vt-el').querySelector('.vt-el__kind') : null; track('card_open', kind ? kind.textContent : ''); }
      else if (d.matches('[data-fold]')) track('fold_open', d.id);
      else if (d.matches('.vt-more')) { var sp = d.querySelector('summary span'); track('section_open', sp ? sp.textContent : ''); }
    }, true);
    window.addEventListener('pagehide', flushEvents);
    doc.addEventListener('visibilitychange', function () { if (doc.visibilityState === 'hidden') flushEvents(); });
  }
  function addRequests(rows) {
    var body = $('[data-requests-body]');
    if (!body) return;
    rows.forEach(function (r) {
      var tr = doc.createElement('tr'); tr.className = r.ok ? 'is-ok' : 'is-missing';
      [r.method, r.endpoint, (r.ok ? 'OK ' : 'FAILED ') + r.status + (r.error ? ' · ' + r.error : ''), r.ms + ' ms'].forEach(function (c) { var td = doc.createElement('td'); td.textContent = c; tr.appendChild(td); });
      body.appendChild(tr);
    });
  }
  /* Sections load strictly one after another, in page order (stays → cruise → destinations → weather → flights…),
     so a slow third party never starves the others and the page fills top to bottom. Guides inside an itinerary
     card join the queue when the card is opened. */
  var queue = [], draining = false;
  function enqueue(el) {
    if (el.dataset.loaded === '1' || el.dataset.queued === '1') return;
    el.dataset.queued = '1';
    queue.push(el);
    drain();
  }
  function drain() {
    if (draining) return;
    var el = queue.shift();
    if (!el) return;
    draining = true;
    var done = function () { draining = false; delete el.dataset.queued; setTimeout(drain, 60); };
    try { loadSection(el, done); } catch (e) { diag('loader error: ' + e); done(); }
  }
  function initAsync() {
    var pending = $$('.vt-async[data-loaded="0"]');
    // Main sections first (stays → cruise → destinations → weather → flights), then the airline/airport guides,
    // so the guides start as soon as the flights are known and appear in their cards without any refresh.
    pending.filter(function (el) { return !el.dataset.guide; }).forEach(enqueue);
    pending.filter(function (el) { return el.dataset.guide; }).forEach(enqueue);
    // Opening a card bumps its guide to the front of the queue.
    $$('.vt-async[data-guide]').forEach(function (el) {
      var d = el.closest('details');
      if (d) d.addEventListener('toggle', function () { if (d.open && el.dataset.loaded !== '1') { queue = queue.filter(function (q) { return q !== el; }); queue.unshift(el); delete el.dataset.queued; enqueue(el); } });
    });
    // Sections rendered inline from cache whose AI copy is still being written: re-check once or twice.
    $$('.vt-async[data-poll="1"]').forEach(function (el) { el.dataset.polls = '1'; setTimeout(function () { el.dataset.loaded = '0'; enqueue(el); }, 10000); });
    $$('.vt-async[data-loaded="1"][data-refresh]').forEach(function (el) { var r = parseInt(el.dataset.refresh, 10); if (r > 0) setTimeout(function () { el.dataset.loaded = '0'; enqueue(el); }, r * 1000); });
  }

  /* ---- Lazy map iframes ---- */
  function enhance(root) {
    $$('details.vt-map', root).forEach(function (d) {
      d.addEventListener('toggle', function () {
        var f = $('iframe[data-src]', d);
        if (d.open && f) { f.src = f.dataset.src; f.removeAttribute('data-src'); }
      });
    });
    $$('[data-lightbox]', root).forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openLightbox(a); });
    });
  }

  /* ---- Lightbox ---- */
  var lb = $('#vt-lightbox'), lbImg = $('#vt-lightbox-img'), lbSet = [], lbIdx = 0;
  function openLightbox(a) {
    var group = a.closest('[data-gallery]') || doc;
    lbSet = $$('[data-lightbox]', group).map(function (x) { return x.href; });
    lbIdx = Math.max(0, lbSet.indexOf(a.href));
    showLb();
    lb.hidden = false;
    doc.body.style.overflow = 'hidden';
    $('.vt-lightbox__close', lb).focus();
  }
  function showLb() { lbImg.src = lbSet[lbIdx] || ''; }
  function closeLb() { lb.hidden = true; doc.body.style.overflow = ''; lbImg.src = ''; }
  if (lb) {
    lb.addEventListener('click', function (e) {
      if (e.target.closest('[data-lightbox-close]') || e.target === lb) closeLb();
      if (e.target.closest('[data-lightbox-prev]')) { lbIdx = (lbIdx - 1 + lbSet.length) % lbSet.length; showLb(); }
      if (e.target.closest('[data-lightbox-next]')) { lbIdx = (lbIdx + 1) % lbSet.length; showLb(); }
    });
    doc.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowLeft') { lbIdx = (lbIdx - 1 + lbSet.length) % lbSet.length; showLb(); }
      if (e.key === 'ArrowRight') { lbIdx = (lbIdx + 1) % lbSet.length; showLb(); }
    });
  }

  /* ---- Countdown ---- */
  function initCountdown() {
    var cd = $('[data-countdown]');
    if (!cd) return;
    var target = new Date(cd.dataset.countdown).getTime();
    if (isNaN(target)) return;
    var d = $('[data-cd="d"]', cd), h = $('[data-cd="h"]', cd), m = $('[data-cd="m"]', cd);
    function tick() {
      var diff = target - Date.now();
      if (diff <= 0) { cd.hidden = true; return; }
      var days = Math.floor(diff / 864e5), hours = Math.floor(diff % 864e5 / 36e5), mins = Math.floor(diff % 36e5 / 6e4);
      d.textContent = days; h.textContent = String(hours).padStart(2, '0'); m.textContent = String(mins).padStart(2, '0');
    }
    tick(); setInterval(tick, 30000);
  }

  /* ---- Bottom nav scroll-spy ---- */
  function initNav() {
    var links = $$('.vt-nav a[data-nav]');
    if (!links.length || !('IntersectionObserver' in window)) return;
    var map = {};
    links.forEach(function (a) { var t = $('#' + a.dataset.nav); if (t) map[a.dataset.nav] = a; });
    var setActive = function (id) { links.forEach(function (a) { a.classList.toggle('is-active', a.dataset.nav === id); }); };
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) setActive(en.target.id); });
    }, { rootMargin: '-35% 0px -55% 0px', threshold: 0.01 });
    Object.keys(map).forEach(function (id) { io.observe($('#' + id)); });
    setActive('top');
  }

  /* ---- Share ---- */
  $$('[data-share]').forEach(function (b) {
    b.addEventListener('click', function () {
      var data = { title: VT.name || doc.title, text: 'Our trip: ' + (VT.name || ''), url: location.href };
      if (navigator.share) { navigator.share(data).catch(function () {}); }
      else if (navigator.clipboard) { navigator.clipboard.writeText(location.href).then(function () { b.title = 'Link copied'; }); }
    });
  });

  /* ---- Recommend us: share the member's details with a friend ---- */
  $$('[data-refer]').forEach(function (b) {
    b.addEventListener('click', function () {
      var text = b.dataset.referText || '';
      if (navigator.share) { navigator.share({ text: text }).catch(function () {}); }
      else if (navigator.clipboard) { navigator.clipboard.writeText(text).then(function () { var s = b.querySelector('span'); if (s) s.textContent = 'Copied — paste it into a message.'; }); }
    });
  });

  /* ---- Multi-select picker: search box + removable chips over a native <select multiple> ---- */
  function initPickers() {
    $$('[data-picker]').forEach(function (box) {
      var sel = box.querySelector('select');
      if (!sel) return;
      var opts = Array.prototype.slice.call(sel.options);
      sel.hidden = true;
      var chips = doc.createElement('div'); chips.className = 'vt-picker__chips';
      var input = doc.createElement('input'); input.type = 'search'; input.className = 'vt-picker__input'; input.placeholder = box.dataset.placeholder || 'Type to search'; input.setAttribute('autocomplete', 'off'); input.setAttribute('aria-label', sel.getAttribute('aria-label') || 'Search');
      var list = doc.createElement('ul'); list.className = 'vt-picker__list'; list.setAttribute('role', 'listbox'); list.hidden = true;
      box.appendChild(chips); box.appendChild(input); box.appendChild(list);
      function render() {
        chips.innerHTML = '';
        opts.filter(function (o) { return o.selected; }).forEach(function (o) {
          var c = doc.createElement('button'); c.type = 'button'; c.className = 'vt-picker__chip'; c.innerHTML = '<span></span><b aria-hidden="true">×</b>'; c.querySelector('span').textContent = o.text; c.setAttribute('aria-label', 'Remove ' + o.text);
          c.addEventListener('click', function () { o.selected = false; render(); suggest(); });
          chips.appendChild(c);
        });
        if (!chips.children.length) { var e = doc.createElement('span'); e.className = 'vt-picker__empty'; e.textContent = 'None chosen yet'; chips.appendChild(e); }
      }
      function suggest() {
        var q = input.value.trim().toLowerCase();
        list.innerHTML = '';
        var matches = opts.filter(function (o) { return !o.selected && (q === '' || o.text.toLowerCase().indexOf(q) !== -1); }).slice(0, q === '' ? 8 : 12);
        if (!matches.length || (q === '' && doc.activeElement !== input)) { list.hidden = true; return; }
        matches.forEach(function (o) {
          var li = doc.createElement('li'); li.setAttribute('role', 'option'); li.tabIndex = 0; li.textContent = o.text;
          var pick = function () { o.selected = true; input.value = ''; render(); suggest(); input.focus(); };
          li.addEventListener('click', pick); li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
          list.appendChild(li);
        });
        list.hidden = false;
      }
      input.addEventListener('input', suggest);
      input.addEventListener('focus', suggest);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var first = list.querySelector('li'); if (first) first.click(); } if (e.key === 'Escape') { list.hidden = true; } });
      doc.addEventListener('click', function (e) { if (!box.contains(e.target)) list.hidden = true; });
      render();
    });
  }

  /* ---- Long personal notes fold ---- */
  $$('[data-note-more]').forEach(function (b) { b.addEventListener('click', function () { var n = $('[data-note-long]'); if (n) n.classList.add('is-open'); b.remove(); }); });

  /* ---- Live flights: manual refresh, at most once every two minutes ---- */
  var lastFlightRefresh = 0;
  doc.addEventListener('click', function (e) {
    var b = e.target.closest('[data-flight-refresh]');
    if (!b) return;
    var el = b.closest('.vt-async');
    if (!el) return;
    var wait = 120000 - (Date.now() - lastFlightRefresh);
    if (wait > 0) { b.textContent = 'Try again in ' + Math.ceil(wait / 1000) + 's'; setTimeout(function () { b.innerHTML = b.dataset.label || 'Refresh'; }, 2000); return; }
    lastFlightRefresh = Date.now();
    b.dataset.label = b.innerHTML; b.disabled = true; b.textContent = 'Refreshing…';
    el.dataset.loaded = '0'; enqueue(el);
  });

  /* ---- Share with fellow travellers ---- */
  $$('[data-share-trip]').forEach(function (b) {
    b.addEventListener('click', function () {
      var status = $('[data-share-status]'); b.disabled = true;
      rest('share', { method: 'POST', body: {} }).then(function (j) {
        track('share_tap', 'traveller-link');
        if (navigator.share) { navigator.share({ title: VT.name || 'Our trip', text: j.text, url: j.url }).catch(function () {}); }
        else if (navigator.clipboard) { navigator.clipboard.writeText(j.text); }
        if (status) { status.hidden = false; status.textContent = navigator.share ? 'Link ready — choose where to send it.' : 'Link copied — paste it into a message.'; }
      }).catch(function (ex) { if (status) { status.hidden = false; status.textContent = ex.message; } }).then(function () { b.disabled = false; });
    });
  });

  /* ---- Checklist memory (per device, this trip only) ---- */
  function initChecklist() {
    var key = 'vt-check-' + (VT.ref || '');
    var done = {};
    try { done = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { done = {}; }
    $$('.vt-check__item').forEach(function (li) {
      var k = li.dataset.check, btn = $('.vt-check__tick', li);
      if (done[k]) { li.classList.add('is-done'); btn.setAttribute('aria-pressed', 'true'); }
      btn.addEventListener('click', function () {
        var on = !li.classList.contains('is-done');
        li.classList.toggle('is-done', on); btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        done[k] = on;
        try { localStorage.setItem(key, JSON.stringify(done)); } catch (e) {}
      });
    });
    var expand = $('[data-expand-days]');
    if (expand) expand.addEventListener('click', function () { $('.vt-days').classList.remove('is-collapsed'); expand.remove(); });
  }

  /* ---- Ask a question ---- */
  function initAsk() {
    var form = $('[data-ask-form]');
    $$('[data-ask]').forEach(function (a) {
      a.addEventListener('click', function () {
        if (!form) return;
        var ta = $('textarea', form);
        if (a.dataset.askPrefill && ta && !ta.value) ta.value = a.dataset.askPrefill;
        setTimeout(function () { if (ta) ta.focus({ preventScroll: true }); }, 400);
      });
    });
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = $('.vt-ask__status', form), btn = $('button[type=submit]', form);
      status.hidden = false; status.classList.remove('is-error'); status.textContent = 'Sending…'; btn.disabled = true;
      rest('question', { method: 'POST', body: { message: form.message.value, email: form.email.value } }).then(function () {
        status.textContent = 'Sent. We\'ll come back to you as soon as we can.'; form.message.value = '';
      }).catch(function (err) { status.classList.add('is-error'); status.textContent = err.message; }).then(function () { btn.disabled = false; });
    });
  }

  /* ---- Custom payment ---- */
  function initCustomPay() {
    var form = $('[data-custom-pay]');
    if (!form) return;
    var input = form.amount, btn = $('button[type=submit]', form), err = $('[data-pay-error]', form);
    var max = parseFloat(input.max || '0');
    input.addEventListener('input', function () { var v = parseFloat(input.value); btn.disabled = !(v > 0 && v <= max + 0.009 && /^\d+(\.\d{1,2})?$/.test(input.value)); });
    form.addEventListener('submit', function (e) {
      e.preventDefault(); btn.disabled = true; err.hidden = true;
      var tab = window.open('', '_blank');
      track('custom_pay', '');
      rest('pay', { method: 'POST', body: { amount: input.value } }).then(function (j) {
        if (tab) { tab.opener = null; tab.location.replace(j.url); } else { location.assign(j.url); }
      }).catch(function (ex) { if (tab) tab.close(); err.hidden = false; err.textContent = ex.message; btn.disabled = false; });
    });
  }

  /* ---- Pay now without a stored link: create the Mint link for that exact scheduled amount ---- */
  $$('[data-pay-payment]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true; var label = btn.textContent; btn.textContent = 'One moment…';
      var tab = window.open('', '_blank');
      rest('pay', { method: 'POST', body: { payment: btn.dataset.payPayment } }).then(function (j) {
        if (tab) { tab.opener = null; tab.location.replace(j.url); } else { location.assign(j.url); }
      }).catch(function (ex) { if (tab) tab.close(); alert(ex.message); }).then(function () { btn.disabled = false; btn.textContent = label; });
    });
  });

  /* ---- Quotation acceptance ---- */
  function initAccept() {
    var modal = $('#vt-accept-modal');
    if (!modal) return;
    var card = $('[data-accept-form]', modal), submit = $('[data-accept-submit]', modal), err = $('[data-accept-error]', modal);
    var reads = $$('.vt-read', modal), read = {};
    var openers = $$('[data-open-accept]');
    function open(e) { if (e) e.preventDefault(); modal.hidden = false; doc.body.style.overflow = 'hidden'; $('summary', reads[0]).focus(); }
    function close() { modal.hidden = true; doc.body.style.overflow = ''; }
    openers.forEach(function (b) { b.addEventListener('click', open); });
    if (location.hash === '#accept-now') open();
    $$('[data-close-accept]', modal).forEach(function (b) { b.addEventListener('click', close); });
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    doc.addEventListener('keydown', function (e) { if (!modal.hidden && e.key === 'Escape') close(); });

    function markRead(d) {
      var k = d.dataset.read;
      if (read[k]) return;
      read[k] = true; d.classList.add('is-read'); check();
    }
    reads.forEach(function (d) {
      var body = $('[data-read-scroll]', d);
      var done = function () { if (body.scrollHeight - body.scrollTop - body.clientHeight < 24) markRead(d); };
      body.addEventListener('scroll', done, { passive: true });
      d.addEventListener('toggle', function () { if (d.open) { setTimeout(function () { if (body.scrollHeight <= body.clientHeight + 24) markRead(d); }, 50); } });
    });
    var name = $('input[name=name]', card), email = $('input[name=email]', card), agreed = $('input[name=agreed]', card);
    function check() {
      var all = reads.every(function (d) { return read[d.dataset.read]; });
      submit.disabled = !(all && name.value.trim().length > 2 && /\S+@\S+\.\S+/.test(email.value) && agreed.checked);
    }
    [name, email, agreed].forEach(function (i) { i.addEventListener('input', check); i.addEventListener('change', check); });
    submit.addEventListener('click', function () {
      submit.disabled = true; err.hidden = true; var label = submit.textContent; submit.textContent = 'Recording your acceptance…';
      rest('accept', { method: 'POST', body: { name: name.value.trim(), email: email.value.trim(), agreed: agreed.checked, read: read } }).then(function (j) {
        track('accept_complete', ''); flushEvents();
        if (j.payUrl) { submit.textContent = 'Taking you to the deposit payment…'; location.assign(j.payUrl); return; }
        var body = $('.vt-modal__body', modal);
        var html = '<p class="vt-h3">' + (j.message || 'Thank you.') + '</p>';
        if (j.bank) { html += '<p>You can pay your ' + (j.amount || 'deposit') + ' by bank transfer:</p><dl class="vt-kv vt-kv--tight"><div><dt>Account name</dt><dd>' + j.bank.name + '</dd></div><div><dt>Sort code</dt><dd>' + j.bank.sort + '</dd></div><div><dt>Account number</dt><dd>' + j.bank.number + '</dd></div><div><dt>Reference</dt><dd><strong>' + j.bank.reference + '</strong></dd></div></dl>'; }
        body.innerHTML = html; $('.vt-modal__foot', modal).hidden = true;
      }).catch(function (ex) { err.hidden = false; err.textContent = ex.message; submit.disabled = false; submit.textContent = label; });
    });
  }

  /* ---- Offline: cache the trip for the road, tell the customer when they're reading a saved copy ---- */
  function initOffline() {
    if (VT.sw && 'serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register(VT.sw, { scope: VT.swScope || '/' }).catch(function () {});
    }
    var banner;
    var update = function () {
      if (!navigator.onLine) {
        if (!banner) { banner = doc.createElement('div'); banner.className = 'vt-offline'; banner.setAttribute('role', 'status'); banner.textContent = 'You\'re offline — showing your trip as last saved'; doc.body.appendChild(banner); }
      } else if (banner) { banner.remove(); banner = null; }
    };
    window.addEventListener('online', update); window.addEventListener('offline', update); update();
  }

  /* ---- Stale copy: try for a fresh one quietly, reload only when it's there ---- */
  function initStale() {
    if (!$('[data-stale]')) return;
    var tries = 0;
    (function again() {
      tries++;
      setTimeout(function () {
        fetch(location.href, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
          if (r.ok && r.headers.get('X-Vision-State') === 'ok') { location.reload(); } else if (tries < 6) { again(); }
        }).catch(function () { if (tries < 6) again(); });
      }, 20000 + tries * 10000);
    })();
  }

  /* ---- Folds: open on desktop, open when linked to ---- */
  function initFolds() {
    var folds = $$('details[data-fold]');
    if (!folds.length) return;
    if (window.matchMedia && window.matchMedia('(min-width: 900px)').matches) folds.forEach(function (d) { d.open = true; });
    var openTarget = function () { var id = location.hash.replace('#', ''); if (!id) return; var d = doc.getElementById(id); if (d && d.tagName === 'DETAILS') d.open = true; };
    window.addEventListener('hashchange', openTarget); openTarget();
    doc.addEventListener('click', function (e) { var a = e.target.closest('a[href^="#"]'); if (!a) return; var d = doc.getElementById(a.getAttribute('href').slice(1)); if (d && d.tagName === 'DETAILS') d.open = true; });
  }

  /* ---- Init ---- */
  function ready(fn) { if (doc.readyState !== 'loading') fn(); else doc.addEventListener('DOMContentLoaded', fn); }
  ready(function () {
    enhance(doc);
    initAsync();
    initOffline();
    initStale();
    initFolds();
    initEvents();
    initCountdown();
    initNav();
    initChecklist();
    initPickers();
    initAsk();
    initCustomPay();
    initAccept();
    if (!reduced) { $$('.vt-progress span').forEach(function (s) { var w = s.style.width; s.style.width = '0'; requestAnimationFrame(function () { s.style.width = w; }); }); }
  });
})();
