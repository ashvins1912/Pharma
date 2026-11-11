const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

export const renderPaymentSnoozePage = token => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ashvin Pharmacy</title></head><body>
<main><h1>Payment reminder preferences</h1><p>Choose below to postpone payment reminders for 24 hours.</p>
<button id="confirm" type="button">Will do later</button><p id="result" role="status"></p></main>
<script>
const token = ${JSON.stringify(escapeHtml(token))};
document.getElementById('confirm').addEventListener('click', async () => {
  const button = document.getElementById('confirm');
  button.disabled = true;
  try {
    const csrfCookie = document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]*)/);
    const csrfToken = csrfCookie ? decodeURIComponent(csrfCookie[1]) : '';
    const response = await fetch(location.pathname, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrfToken }, body: JSON.stringify({ token }) });
    const result = await response.json();
    document.getElementById('result').textContent = response.ok ? 'Reminders postponed for 24 hours.' : (result.message || 'This action link is invalid or expired.');
  } catch { document.getElementById('result').textContent = 'Could not update your preference. Please try again.'; }
  button.disabled = false;
});
</script></body></html>`;
