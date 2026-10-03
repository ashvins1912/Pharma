const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

export const renderDeliveryActionPage = (token, action) => {
    const labels = {
        cash_received: 'Confirm cash received',
        payment_pending: 'Confirm delivery with payment pending',
        not_reachable: 'Record customer not reachable'
    };
    const buttonLabel = labels[action];
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ashvin Pharmacy Delivery</title></head>
<body><main><h1>Delivery update</h1><p>Confirm this delivery action for the assigned order.</p>
<button id="confirm" type="button">${buttonLabel}</button><p id="result" role="status"></p></main>
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
    document.getElementById('result').textContent = response.ok ? 'Delivery update recorded.' : (result.message || 'This action link is invalid or expired.');
  } catch { document.getElementById('result').textContent = 'Could not record this update. Please try again.'; }
  button.disabled = false;
});
</script></body></html>`;
};
