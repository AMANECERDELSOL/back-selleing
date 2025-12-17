import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { getOne, runQuery } from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Binance Pay configuration
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;
const BINANCE_MERCHANT_ID = process.env.BINANCE_MERCHANT_ID;

// Generate Binance Pay signature
function generateSignature(timestamp, nonce, body) {
    const payload = timestamp + '\n' + nonce + '\n' + body + '\n';
    return crypto.createHmac('sha512', BINANCE_SECRET_KEY).update(payload).digest('hex').toUpperCase();
}

// Create Binance Pay order
router.post('/create', authenticateToken, async (req, res) => {
    try {
        const { order_id, amount, currency = 'USDT' } = req.body;

        if (!order_id || !amount) {
            return res.status(400).json({ error: 'ID de orden y monto son requeridos.' });
        }

        // Verify order exists and belongs to user
        const order = getOne('SELECT * FROM orders WHERE id = ? AND buyer_id = ?', [order_id, req.user.id]);

        if (!order) {
            return res.status(404).json({ error: 'Orden no encontrada.' });
        }

        // Prepare Binance Pay request
        const timestamp = Date.now();
        const nonce = crypto.randomBytes(16).toString('hex');

        const requestBody = {
            env: {
                terminalType: 'WEB'
            },
            merchantTradeNo: `ORDER_${order_id}_${timestamp}`,
            orderAmount: parseFloat(amount).toFixed(2),
            currency: currency,
            goods: {
                goodsType: '02', // Virtual goods
                goodsCategory: 'Digital Products',
                referenceGoodsId: order_id.toString(),
                goodsName: 'Digital Products Order'
            },
            returnUrl: `${req.headers.origin || 'http://localhost:3000'}/orders/${order_id}`,
            cancelUrl: `${req.headers.origin || 'http://localhost:3000'}/orders/${order_id}`
        };

        const body = JSON.stringify(requestBody);
        const signature = generateSignature(timestamp, nonce, body);

        // Make request to Binance Pay API
        // NOTE: This is a simplified example. In production, you'll need to use the actual Binance Pay API endpoint
        // and handle the response properly. For now, we'll simulate a successful response.

        // Uncomment this when you have valid Binance API credentials:
        /*
        const response = await axios.post('https://bpay.binanceapi.com/binancepay/openapi/v2/order', requestBody, {
          headers: {
            'Content-Type': 'application/json',
            'BinancePay-Timestamp': timestamp,
            'BinancePay-Nonce': nonce,
            'BinancePay-Certificate-SN': BINANCE_API_KEY,
            'BinancePay-Signature': signature
          }
        });
        */

        // Simulated response for development
        const simulatedResponse = {
            status: 'SUCCESS',
            code: '000000',
            data: {
                prepayId: `SIMULATED_${timestamp}`,
                terminalType: 'WEB',
                expireTime: timestamp + 3600000, // 1 hour
                qrcodeLink: `https://qr.binance.com/payment/${timestamp}`,
                qrContent: `binancepay://payment?prepayId=SIMULATED_${timestamp}`,
                checkoutUrl: `https://pay.binance.com/checkout/SIMULATED_${timestamp}`,
                deeplink: `bnc://app.binance.com/payment/${timestamp}`,
                universalUrl: `https://app.binance.com/payment/${timestamp}`
            }
        };

        // Update order with Binance payment info
        runQuery(`
      UPDATE orders SET binance_txid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [simulatedResponse.data.prepayId, order_id]);

        res.json({
            message: 'Orden de pago creada exitosamente.',
            payment: simulatedResponse.data
        });
    } catch (error) {
        console.error('Error creating Binance Pay order:', error);
        res.status(500).json({ error: 'Error al crear orden de pago.' });
    }
});

// Binance Pay webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    try {
        // Verify webhook signature
        const signature = req.headers['binancepay-signature'];
        const timestamp = req.headers['binancepay-timestamp'];
        const nonce = req.headers['binancepay-nonce'];

        // In production, verify the signature here
        // const expectedSignature = generateSignature(timestamp, nonce, req.body);
        // if (signature !== expectedSignature) {
        //   return res.status(401).json({ error: 'Invalid signature' });
        // }

        const payload = JSON.parse(req.body.toString());

        // Handle payment notification
        if (payload.bizStatus === 'PAY_SUCCESS') {
            const merchantTradeNo = payload.data.merchantTradeNo;
            const orderId = merchantTradeNo.split('_')[1]; // Extract order ID

            // Update order and transaction status
            runQuery(`
        UPDATE orders SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `, [orderId]);

            runQuery(`
        UPDATE transactions SET status = 'verified', updated_at = CURRENT_TIMESTAMP 
        WHERE order_id = ?
      `, [orderId]);

            console.log(`Payment verified for order ${orderId}`);
        }

        res.json({ returnCode: 'SUCCESS', returnMessage: null });
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ returnCode: 'FAIL', returnMessage: error.message });
    }
});

// Check payment status
router.get('/:order_id/status', authenticateToken, (req, res) => {
    try {
        const transaction = getOne(`
      SELECT * FROM transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1
    `, [req.params.order_id]);

        if (!transaction) {
            return res.status(404).json({ error: 'Transacción no encontrada.' });
        }

        res.json({ transaction });
    } catch (error) {
        console.error('Error checking payment status:', error);
        res.status(500).json({ error: 'Error al verificar estado de pago.' });
    }
});

export default router;
