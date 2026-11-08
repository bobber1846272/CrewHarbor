/* CrewHarbor · website: menu op telefoon, balk bij scrollen, rustig inschuiven van blokken */
(function () {
  'use strict';
  const top = document.getElementById('top');
  const btn = document.querySelector('.menu-btn');
  if (btn && top) {
    btn.addEventListener('click', () => { const open = top.classList.toggle('open'); btn.setAttribute('aria-expanded', open); });
    top.addEventListener('click', e => { if (e.target.closest('.nav a')) { top.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
  }
  const onScroll = () => top && top.classList.toggle('scrolled', window.scrollY > 12);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const items = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) { items.forEach(el => el.classList.add('in')); return; }
  document.documentElement.classList.add('rv-on');
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  items.forEach((el, i) => { el.style.transitionDelay = (i % 3) * 70 + 'ms'; io.observe(el); });
})();
