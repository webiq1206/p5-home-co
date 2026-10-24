/** Gate vendor loading by the actual browser host, including production builds used in QA. */
export function googleTagBootstrap(options: {
  hostname: string;
  measurementId: string;
  adsId: string;
  phoneConversionLabel?: string;
  phoneNumber?: string;
  callClickLabel?: string;
  textClickLabel?: string;
}): string {
  const config = JSON.stringify(options).replace(/</g, '\\u003c');
  return `(function () {
  var config = ${config};
  var host = window.location.hostname.toLowerCase();
  if (host !== config.hostname && host !== 'www.' + config.hostname) return;
  if (navigator.webdriver === true) return;
  if (window.location.pathname === '/estimate/qa-saved' || window.location.pathname.indexOf('/estimate/qa-saved/') === 0) return;
  try { if (sessionStorage.getItem('p5_analytics_disabled') === '1') return; } catch (e) {}
  if (document.getElementById('p5-google-tag')) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', config.measurementId);
  window.gtag('config', config.adsId);
  if (config.phoneConversionLabel && config.phoneNumber) {
    window.gtag('config', config.adsId + '/' + config.phoneConversionLabel, { phone_conversion_number: config.phoneNumber });
  }
  // One delegated listener for call and text clicks. The tag gate above is the
  // only switch, and the flag stops a second bootstrap from binding twice.
  if (config.callClickLabel && config.textClickLabel && !window.__p5ClickConversionBound && typeof document.addEventListener === 'function') {
    window.__p5ClickConversionBound = true;
    document.addEventListener('click', function (event) {
      var path = window.location.pathname || '';
      if (path === '/admin' || path.indexOf('/admin/') === 0 || path === '/portal' || path.indexOf('/portal/') === 0) return;
      var node = event.target;
      while (node && node !== document) {
        if (typeof node.getAttribute === 'function') {
          var href = String(node.getAttribute('href') || '');
          var head = href.slice(0, 4).toLowerCase();
          var label = head === 'tel:' ? config.callClickLabel : head === 'sms:' ? config.textClickLabel : '';
          if (label) {
            try { window.gtag('event', 'conversion', { send_to: config.adsId + '/' + label }); } catch (err) {}
            return;
          }
        }
        node = node.parentNode;
      }
    });
  }
  try { if (!sessionStorage.getItem('p5_entry_path')) sessionStorage.setItem('p5_entry_path', window.location.pathname); } catch (e) {}
  // Retain a privacy-bounded first and latest campaign touch for real visitors.
  // This is acquisition metadata only, never a lead or a conversion event.
  try {
    var query = new URLSearchParams(window.location.search || '');
    var allowed = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
    var touch = { landing_page: window.location.pathname || '/' };
    var hasCampaign = false;
    for (var i = 0; i < allowed.length; i++) {
      var key = allowed[i];
      var value = query.get(key);
      if (value && value.length <= 300 && /^[A-Za-z0-9._~:-]+$/.test(value)) {
        touch[key] = value;
        hasCampaign = true;
      }
    }
    var ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && /^https?:$/.test(ref.protocol) && ref.hostname.replace(/^www[.]/, '') !== config.hostname) touch.referrer = ref.origin;
    var firstKey = 'p5_attribution_first_v1';
    var latestKey = 'p5_attribution_latest_v1';
    if (!sessionStorage.getItem(firstKey)) sessionStorage.setItem(firstKey, JSON.stringify(touch));
    if (hasCampaign || !sessionStorage.getItem(latestKey)) sessionStorage.setItem(latestKey, JSON.stringify(touch));
  } catch (e) { /* No storage or invalid campaign data must never block a form. */ }
  var script = document.createElement('script');
  script.id = 'p5-google-tag';
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(config.measurementId);
  document.head.appendChild(script);
})();`;
}
