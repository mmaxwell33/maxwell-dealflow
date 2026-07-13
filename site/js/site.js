/* ─────────────────────────────────────────────────────────────────────
   Shared marketing-site JS — loaded on every /site/* page.

   Two things:
     1. Sets the current year in the footer <span id="yr">
     2. Click/keyboard/touch support for the mega-menu navigation
        (CSS handles hover via :hover and :focus-within; this script
        adds click toggling for touch devices and Escape-to-close.)

   Page-specific scripts (hero carousel, Leaflet/MapLibre map init)
   stay inline on the pages that need them. This file is intentionally
   tiny and free of dependencies.
   ───────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  // ── Footer year ────────────────────────────────────────────────────
  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  // ── Flat-nav mobile hamburger (shared by every page) ────────────────
  var nav = document.getElementById('nav');
  var toggle = document.getElementById('navToggle');
  if (nav && toggle) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    var panel = document.getElementById('navPanel');
    if (panel) {
      panel.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') {
          nav.classList.remove('is-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }
  }

  // ── Mega-menu click + keyboard support ─────────────────────────────
  //    (kept for the upcoming Communities dropdown; no-ops on pages
  //     without .mega-menu items)
  var items = document.querySelectorAll('.mega-menu .mega-item');
  if (!items.length) return;

  function closeAll(except) {
    items.forEach(function (it) {
      if (it === except) return;
      it.classList.remove('is-open');
      var t = it.querySelector('.mega-trigger');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
  }

  items.forEach(function (item) {
    var trigger = item.querySelector('.mega-trigger');
    if (!trigger) return;

    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      var isOpen = item.classList.contains('is-open');
      closeAll(item);
      if (isOpen) {
        item.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
      } else {
        item.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // Close when clicking outside
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.mega-menu')) closeAll(null);
  });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAll(null);
  });
}());
