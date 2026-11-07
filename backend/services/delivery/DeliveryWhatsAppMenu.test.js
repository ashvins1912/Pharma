import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeliveryActionMenu, getDeliveryActionFromListReply, isDeliveryMenuAction } from './DeliveryWhatsAppMenu.js';

test('delivery menu exposes only supported state-machine actions', () => {
    const menu = buildDeliveryActionMenu({ _id: '65f000000000000000000001' });
    assert.equal(menu.buttonText, 'Select Action');
    assert.equal(menu.sections[0].title, 'Select Status');
    assert.deepEqual(menu.sections[0].rows.map(row => row.id), [
        'cash_received', 'payment_pending', 'not_reachable'
    ]);
    assert.equal(isDeliveryMenuAction('cancel_request'), false);
});

test('delivery menu reply parser supports direct and ephemeral replies', () => {
    const response = { singleSelectReply: { selectedRowId: 'cash_received' }, contextInfo: { stanzaId: 'outgoing-1' } };
    assert.equal(getDeliveryActionFromListReply({ message: { listResponseMessage: response } }), response);
    assert.equal(getDeliveryActionFromListReply({
        message: { ephemeralMessage: { message: { listResponseMessage: response } } }
    }), response);
    assert.equal(getDeliveryActionFromListReply({ message: { conversation: 'Delivered' } }), null);
});
