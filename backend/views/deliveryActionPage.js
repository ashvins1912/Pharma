const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

export const renderDeliveryActionPage = (token, action) => {
    const labels = {
        accept: 'Accept Delivery Assignment',
        view_delivery: 'View Delivery Details',
        cash_received: 'Confirm cash received',
        cash_not_received: 'Confirm delivery (Cash not received)',
        payment_pending: 'Confirm delivery with payment pending',
        not_reachable: 'Record customer not reachable'
    };
    const buttonLabel = labels[action] || 'Confirm Action';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ashvin Pharmacy Delivery</title>
<style>
body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #1e293b; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem; }
main { background: #fff; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); max-width: 28rem; width: 100%; }
h1 { font-size: 1.25rem; font-weight: 800; margin: 0 0 0.5rem; }
p { font-size: 0.875rem; color: #64748b; margin: 0 0 1.5rem; }
button { width: 100%; background: #0284c7; color: #fff; border: none; padding: 0.75rem 1rem; border-radius: 0.75rem; font-weight: 700; font-size: 0.875rem; cursor: pointer; transition: background 0.2s; }
button:hover { background: #0369a1; }
button:disabled { opacity: 0.6; cursor: not-allowed; }
#result { margin-top: 1rem; font-size: 0.875rem; font-weight: 600; text-align: center; }
</style>
</head>
<body><main><h1>🛵 Delivery Update</h1><p>Confirm this delivery action for the assigned order.</p>
<button id="confirm" type="button">${escapeHtml(buttonLabel)}</button><p id="result" role="status"></p></main>
<script>
const token = ${JSON.stringify(escapeHtml(token))};
const action = ${JSON.stringify(action)};
document.getElementById('confirm').addEventListener('click', async () => {
  const button = document.getElementById('confirm'); button.disabled = true;
  try {
    const csrfCookie = document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/);
    const csrfToken = csrfCookie ? decodeURIComponent(csrfCookie[1]) : '';
    const response = await fetch(location.pathname, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrfToken }, body: JSON.stringify({ token, action }) });
    const result = await response.json();
    if (response.status === 401 || response.status === 403) {
      if (result.code === 'MFA_CHALLENGE_REQUIRED' || result.code === 'SESSION_REQUIRED') {
        document.getElementById('result').textContent = 'Authentication required. Redirecting to verify…';
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        setTimeout(() => { window.location.href = '/?auth_redirect=' + returnUrl; }, 1000);
        return;
      }
    }
    document.getElementById('result').textContent = response.ok ? 'Delivery update recorded.' : (result.message || 'This action link is invalid or expired.');
  } catch { document.getElementById('result').textContent = 'Could not record this update. Please try again.'; }
  button.disabled = false;
});
</script></body></html>`;
};
