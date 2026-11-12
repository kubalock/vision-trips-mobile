/**
 * Vision Trips — "Send App Invite" Airtable automation script.
 *
 * Trigger:  "When a record matches conditions" on Bookings, condition {Send App Invite} is checked
 *           (or "When a button is clicked" if Send App Invite is a button field).
 * Action:   "Run a script" with this code and these input variables (left-hand panel):
 *             bookingRecordId  → the triggering record's Airtable record ID
 *             apiUrl           → static text, e.g. https://api.example.com/v1
 *             scope            → optional static text: primary_customer (default) or fellow_traveller
 *             sendEmail        → optional static text: "false" to create a link without emailing it
 *             writeLink        → optional static text: "true" to copy the link into {App Trip Link}
 *           The automation key (the API's VISION_AUTOMATION_KEY) must come from Airtable's secret store
 *           (input.secret('VISION_AUTOMATION_KEY')) or, where secrets are unavailable, an input variable named
 *           visionKey typed into the automation configuration. Never paste the key into this file.
 *
 * Fields used on Bookings: {App Invite Customer} (link to Customers, one record), {Send App Invite} (checkbox or
 * button), {App Invite Status} (single select), {App Invite Sent At} (date/time), optional {App Trip Link} (URL),
 * optional {App Invite Requested At} (formula: LAST_MODIFIED_TIME({Send App Invite})) used to make retries idempotent.
 */
const config = input.config();
const BOOKINGS_TABLE = 'Bookings';
const FIELDS = {
  customer: 'App Invite Customer',
  trigger: 'Send App Invite',
  status: 'App Invite Status',
  sentAt: 'App Invite Sent At',
  link: 'App Trip Link',
  requestedAt: 'App Invite Requested At',
};

const table = base.getTable(BOOKINGS_TABLE);
const has = (name) => table.fields.some((field) => field.name === name);
const triggerIsCheckbox = has(FIELDS.trigger) && table.getField(FIELDS.trigger).type === 'checkbox';
const booking = await table.selectRecordAsync(config.bookingRecordId, { fields: [FIELDS.customer, ...(has(FIELDS.requestedAt) ? [FIELDS.requestedAt] : [])] });

async function finish(status, extra = {}) {
  await table.updateRecordAsync(config.bookingRecordId, {
    [FIELDS.status]: { name: status },
    ...(triggerIsCheckbox ? { [FIELDS.trigger]: false } : {}),
    ...extra,
  });
  output.set('status', status);
}

if (!booking) throw new Error('Booking record not found.');
const customers = booking.getCellValue(FIELDS.customer) || [];
if (customers.length !== 1) {
  await finish('Failed – choose one customer');
} else {
  const apiUrl = String(config.apiUrl || '').replace(/\/+$/, '');
  const key = typeof input.secret === 'function' ? await input.secret('VISION_AUTOMATION_KEY') : config.visionKey;
  if (!apiUrl.startsWith('https://') || !key) {
    await finish('Failed – automation not configured');
  } else {
    await table.updateRecordAsync(config.bookingRecordId, { [FIELDS.status]: { name: 'Sending' } });
    const requestedAt = has(FIELDS.requestedAt) ? booking.getCellValueAsString(FIELDS.requestedAt) : '';
    const body = {
      baseId: base.id,
      bookingRecordId: booking.id,
      customerRecordId: customers[0].id,
      scope: config.scope === 'fellow_traveller' ? 'fellow_traveller' : 'primary_customer',
      sendEmail: String(config.sendEmail ?? 'true').toLowerCase() !== 'false',
      // Same request time → same key, so an Airtable retry of this run never sends a second email.
      ...(requestedAt ? { idempotencyKey: `airtable:${booking.id}:${customers[0].id}:${Date.parse(requestedAt) || requestedAt.replace(/[^0-9]/g, '')}` } : {}),
    };
    let response;
    let result = {};
    try {
      response = await fetch(`${apiUrl}/customer-invitations`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vision-Key': key }, body: JSON.stringify(body) });
      result = await response.json().catch(() => ({}));
    } catch (error) {
      response = null;
    }
    if (!response || !response.ok) {
      // Never surface the key or the request headers; the API's own messages are safe for agents.
      const reasons = { customer_not_linked: 'Failed – customer not on booking', customer_email_missing: 'Failed – customer has no email', record_not_found: 'Failed – record not found', delivery_failed: 'Failed – email not sent' };
      await finish(reasons[result.code] || (response && response.status === 403 ? 'Failed – automation not configured' : 'Failed – try again'));
      output.set('error', typeof result.message === 'string' ? result.message : `HTTP ${response ? response.status : 'network error'}`);
    } else {
      const status = result.status === 'sent' ? 'Sent' : result.status === 'created' ? 'Link created' : 'Already sent';
      const writeLink = String(config.writeLink ?? 'false').toLowerCase() === 'true' && has(FIELDS.link) && result.url;
      await finish(status, {
        ...(result.sentAt ? { [FIELDS.sentAt]: result.sentAt } : {}),
        ...(writeLink ? { [FIELDS.link]: result.url } : {}),
      });
      output.set('invitationId', result.invitationId);
    }
  }
}
