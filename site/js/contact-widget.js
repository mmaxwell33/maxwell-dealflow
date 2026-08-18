/* ════════════════════════════════════════════════════════════════════════════
   CONTACT WIDGET — maxwellmidodzi.com
   Floating button, bottom right, on every page. Opens WhatsApp, a phone call,
   or a text message.

   Why a script instead of markup in each page: the site is static HTML with no
   build step and ten pages. Pasting the markup ten times means ten places to
   update when the phone number or the wording changes, and that is exactly how
   a site ends up with three different phone numbers on it. Styles live in
   /site/css/site.css alongside the rest of the design system.

   Number is defined ONCE, below.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Single source of truth. E.164 for the tel/sms/WhatsApp links.
  var PHONE_E164 = '+17093250545';
  var PHONE_HUMAN = '709-325-0545';

  // Pre-filled WhatsApp opener. Trailing space is deliberate: the client's
  // cursor lands after "about " and they finish the sentence themselves.
  var WA_TEXT = 'Hi Maxwell, I found you through your website and have a question about ';

  var ICON_WHATSAPP = '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.464 3.488"/>';
  var ICON_PHONE = '<path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>';
  var ICON_SMS = '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>';
  var ICON_CLOSE = '<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>';

  function svg(paths, cls) {
    return '<svg' + (cls ? ' class="' + cls + '"' : '') +
           ' viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
  }

  function item(href, iconPaths, title, sub, extraClass, newTab) {
    return '<a class="mmc-item' + (extraClass ? ' ' + extraClass : '') + '" href="' + href + '"' +
           (newTab ? ' target="_blank" rel="noopener"' : '') + '>' +
           '<span class="mmc-ico">' + svg(iconPaths) + '</span>' +
           '<span class="mmc-tx"><b>' + title + '</b><span>' + sub + '</span></span></a>';
  }

  function build() {
    if (document.getElementById('mmc')) return; // never double-inject

    var wrap = document.createElement('div');
    wrap.className = 'mmc';
    wrap.id = 'mmc';
    wrap.innerHTML =
      '<div class="mmc-menu" id="mmc-menu">' +
        item('https://wa.me/' + PHONE_E164.replace('+', '') + '?text=' + encodeURIComponent(WA_TEXT),
             ICON_WHATSAPP, 'WhatsApp', 'Chat, replies same day', 'mmc-wa', true) +
        item('tel:' + PHONE_E164, ICON_PHONE, 'Call ' + PHONE_HUMAN, 'Straight to Maxwell') +
        item('sms:' + PHONE_E164, ICON_SMS, 'Text message', 'Prefer not to talk? Text') +
      '</div>' +
      '<button class="mmc-fab" id="mmc-fab" type="button" aria-expanded="false" ' +
        'aria-controls="mmc-menu" aria-label="Contact Maxwell">' +
        svg(ICON_PHONE, 'mmc-open-ico') + svg(ICON_CLOSE, 'mmc-x') +
      '</button>';

    document.body.appendChild(wrap);

    var fab = wrap.querySelector('#mmc-fab');
    function setOpen(on) {
      wrap.classList.toggle('is-open', on);
      fab.setAttribute('aria-expanded', on ? 'true' : 'false');
    }
    fab.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!wrap.classList.contains('is-open'));
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { setOpen(false); }
    });
    // Closing after a choice means returning to the page finds it tidy.
    wrap.addEventListener('click', function (e) {
      if (e.target.closest('.mmc-item')) setOpen(false);
    });

    // The cookie notice is fixed to the same bottom corner at a much higher
    // z-index, so on a phone it covers this menu completely. Raising the widget
    // above it is the wrong fix, that would hide the consent notice. Sit above
    // the bar while it is on screen, and drop back down once it is dismissed.
    // Only matters on a first visit, which is exactly when a new lead arrives.
    function clearCookieBar() {
      var bar = document.querySelector('.cookie-bar');
      var h = bar && bar.offsetHeight;
      var shown = h > 0 && getComputedStyle(bar).display !== 'none';
      wrap.style.bottom = shown ? (h + 26) + 'px' : '';
      return bar;
    }
    var bar = clearCookieBar();
    if (bar) {
      // Catches the bar being removed, hidden, or class-toggled on dismiss.
      new MutationObserver(clearCookieBar).observe(document.body, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style']
      });
      window.addEventListener('resize', clearCookieBar);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
