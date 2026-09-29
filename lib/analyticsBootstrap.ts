/** Gate vendor loading by the actual browser host, including production builds used in QA. */
export function googleTagBootstrap(options: {
  hostname: string;
  measurementId: string;
  adsId: string;
  phoneConversionLabel?: string;
  phoneNumber?: string;
}): string {
  const config = JSON.stringify(options).replace(/</g, '\\u003c');
  return `(function () {
  var config = ${config};
  var host = window.location.hostname.toLowerCase();
  if (host !== config.hostname && host !== 'www.' + config.hostname) return;
  if (navigator.webdriver === true) return;
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
  try { if (!sessionStorage.getItem('p5_entry_path')) sessionStorage.setItem('p5_entry_path', window.location.pathname); } catch (e) {}
  var script = document.createElement('script');
  script.id = 'p5-google-tag';
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(config.measurementId);
  document.head.appendChild(script);
})();`;
}
