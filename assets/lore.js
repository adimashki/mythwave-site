/* Lore pages: comic reader + image lightbox. No dependencies. */
(function () {
  /* ---------- lightbox: any [data-zoom] image or [data-zoom-link] anchor ---------- */
  var box = document.createElement('div');
  box.className = 'lightbox';
  box.hidden = true;
  box.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close">&times;</button><div class="lightbox-scroll"><img alt=""></div><p class="lightbox-hint">Pinch or scroll to zoom · Esc to close</p>';
  document.body.appendChild(box);
  var boxImg = box.querySelector('img'), scroller = box.querySelector('.lightbox-scroll'), lastFocus = null;

  function openBox(src, alt) {
    lastFocus = document.activeElement;
    boxImg.src = src; boxImg.alt = alt || '';
    box.hidden = false; document.body.classList.add('lightbox-open');
    scroller.scrollTop = 0;
    box.querySelector('.lightbox-close').focus();
  }
  function closeBox() {
    box.hidden = true; document.body.classList.remove('lightbox-open'); boxImg.src = '';
    if (lastFocus) lastFocus.focus();
  }
  box.addEventListener('click', function (e) { if (e.target === box || e.target === scroller || e.target.closest('.lightbox-close')) closeBox(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !box.hidden) closeBox(); });
  document.querySelectorAll('img[data-zoom]').forEach(function (img) {
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', function () { openBox(img.currentSrc || img.src, img.alt); });
  });
  document.querySelectorAll('[data-zoom-link]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); var i = a.querySelector('img'); openBox(a.getAttribute('href'), i ? i.alt : ''); });
  });

  /* ---------- comic reader ---------- */
  var reader = document.getElementById('reader');
  if (!reader) return;
  var data = Array.prototype.map.call(document.querySelectorAll('#reader-data li'), function (li) {
    return { src: li.dataset.src, title: li.dataset.title, text: li.textContent };
  });
  var img = document.getElementById('reader-img'), count = document.getElementById('reader-count'), title = document.getElementById('reader-title');
  var strip = reader.querySelector('.reader-strip'), thumbs = reader.querySelectorAll('.reader-thumb'), total = data.length, cur = 0;

  function show(n, push) {
    cur = (n + total) % total;
    var d = data[cur];
    img.src = d.src; img.alt = 'Page ' + (cur + 1) + ': ' + d.title + '. ' + d.text;
    count.textContent = 'Page ' + (cur + 1) + ' of ' + total; title.textContent = d.title;
    thumbs.forEach(function (t, i) { t.classList.toggle('is-current', i === cur); t.setAttribute('aria-current', i === cur ? 'true' : 'false'); });
    var t = thumbs[cur]; if (t) strip.scrollTo({ left: t.offsetLeft - strip.clientWidth / 2 + t.offsetWidth / 2, behavior: 'smooth' });
    if (data[cur + 1]) { var pre = new Image(); pre.src = data[cur + 1].src; }
    if (push !== false) history.replaceState(null, '', '#page-' + (cur + 1));
  }
  function goTo(n) { show(n); reader.scrollIntoView({ block: 'start', behavior: 'smooth' }); }

  reader.querySelector('.reader-prev').addEventListener('click', function () { show(cur - 1); });
  reader.querySelector('.reader-next').addEventListener('click', function () { show(cur + 1); });
  thumbs.forEach(function (t) { t.addEventListener('click', function () { show(+t.dataset.page - 1); }); });
  document.querySelectorAll('.reader-chapters [data-page]').forEach(function (b) { b.addEventListener('click', function () { goTo(+b.dataset.page - 1); }); });
  document.addEventListener('keydown', function (e) {
    if (!box.hidden || e.target.closest('input,textarea')) return;
    if (e.key === 'ArrowRight') show(cur + 1);
    if (e.key === 'ArrowLeft') show(cur - 1);
  });
  var x0 = null;
  img.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  img.addEventListener('touchend', function (e) {
    if (x0 === null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) show(dx < 0 ? cur + 1 : cur - 1);
  }, { passive: true });

  var m = location.hash.match(/^#page-(\d+)$/);
  show(m ? Math.min(Math.max(+m[1], 1), total) - 1 : 0, false);
})();
