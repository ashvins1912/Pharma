const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

let whatsappClient = null;

try {
    whatsappClient = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        }
    });

    whatsappClient.on('qr', (qr) => {
        console.log('⚡ Scan this QR code with your phone to connect WhatsApp automation:');
        qrcode.generate(qr, { small: true });
    });

    whatsappClient.on('ready', () => console.log('✅ WhatsApp Background Automation Engine Connected!'));
    whatsappClient.initialize();
} catch (e) {
    console.log("Headless background browser framework skipped or blocked on cloud container platform.");
}

const sendCustomWhatsAppAlert = async (order, statusUpdateText, deliveryMobile = null) => {
    try {
        const targetNumber = "919589916475";
        const customerId = `${targetNumber}@c.us`;
        const itemsList = order.items.map(item => `• ${item.name} (x${item.quantity})`).join('\n');

        let messageBody = "";

        switch(statusUpdateText) {
            case 'Placed':
                messageBody = `🎉 *ORDER PLACED SUCCESSFULLY!*\n\n🆔 *Order ID:* #${order._id.toString().slice(-6)}\n💵 *Total Final Amount:* ₹${order.finalTotal}\n🚚 *Status:* Processing COD Delivery\n\n🛒 *ITEMS ORDERED:*\n${itemsList}`;
                break;
            case 'Ready to Dispatch':
                messageBody = `🔬 *ORDER VERIFIED & SECURED*\n\nYour medicine order reference #${order._id.toString().slice(-6)} has been verified by the pharmacist and is *Ready to Dispatch*!`;
                break;
            case 'Dispatched':
                messageBody = `🚚 *OUT FOR DELIVERY!*\n\nYour medicine order is on its way!\n🆔 *Order ID:* #${order._id.toString().slice(-6)}\n👨‍✈️ *Rider Number:* ${deliveryMobile}\n💰 *Amount to Collect:* ₹${order.finalTotal}\n📍 *Maps Navigation link:* https://google.com{order.coordinates?.lat},${order.coordinates?.lng}`;
                break;
            case 'Delivered':
                messageBody = `🏁 *ORDER SAFELY DELIVERED*\n\nThank you for choosing FreeMed Rx! Your order #${order._id.toString().slice(-6)} has been successfully delivered and Cash on Delivery payment collected.`;
                break;
        }

        if (whatsappClient && whatsappClient.info) {
            await whatsappClient.sendMessage(customerId, messageBody);
            if (deliveryMobile && statusUpdateText === 'Dispatched') {
                const agentId = `${deliveryMobile.replace('+', '').trim()}@c.us`;
                await whatsappClient.sendMessage(agentId, `🚨 *NEW OPTIMIZED DELIVERY BATCH RUNNING ASSIGNED*\n\nDrop off location point address text: ${order.deliveryAddress}\nCollect COD Amount: ₹${order.finalTotal}\n📍 GPS Node Google Nav Link: https://google.com{order.coordinates?.lat},${order.coordinates?.lng}`);
            }
            console.log(`✉️ Alert dispatched successfully for state: ${statusUpdateText}`);
        }
    } catch (err) {
        console.error("WhatsApp delivery issue:", err.message);
    }
};

module.exports = { sendCustomWhatsAppAlert };
