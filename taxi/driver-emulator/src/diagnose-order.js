/* eslint-disable no-console */
// Диагностика: создаёт Vote-заказ как клиент и проверяет, видит ли его водитель
// через /drive/now (ready) и /drive (active). Временный скрипт для отладки видимости.
const {
  readConfig, apiPostUrlEncoded, isBackendError, normalizeErrorMessage, stringifyError,
} = require('./common');
const { ClientSimulator } = require('./client-simulator');
const { loginSession } = require('./order-generator');

function normalizeOrders(response) {
  const booking = response?.data?.booking ?? response?.booking ?? response?.data?.orders ?? response?.orders ?? [];
  if (Array.isArray(booking)) return booking;
  if (booking && typeof booking === 'object') return Object.values(booking);
  return [];
}

function summarize(order) {
  return {
    b_id: order?.b_id ?? order?.id,
    b_voting: order?.b_voting,
    b_car_class: order?.b_car_class,
    b_location_class: order?.b_location_class,
    b_state: order?.b_state,
    b_start_datetime: order?.b_start_datetime,
    b_start_address: order?.b_start_address,
  };
}

async function driverView(config, account, label, orderId) {
  console.log(`\n=== Водитель ${label} (${account.login}) ===`);
  let session;
  try {
    session = await loginSession(config.apiBase, account, label);
  } catch (error) {
    console.log(`  login failed: ${stringifyError(error)}`);
    return;
  }
  const auth = { token: session.token, u_hash: session.u_hash, array_type: 'list' };
  console.log(`  u_id=${session.user?.u_id ?? '(unknown)'}`);

  for (const endpoint of ['/drive/now', '/drive/now?filter=b_car_classes&filter=b_location_classes', '/drive']) {
    try {
      const response = await apiPostUrlEncoded(config.apiBase, endpoint, auth);
      if (isBackendError(response)) {
        console.log(`  ${endpoint} -> error: ${normalizeErrorMessage(response)}`);
        continue;
      }
      const orders = normalizeOrders(response);
      const ids = orders.map(o => String(o?.b_id ?? o?.id));
      const seesTarget = ids.includes(String(orderId));
      console.log(`  ${endpoint} -> ${orders.length} заказ(ов); наш ${orderId}: ${seesTarget ? 'ВИДЕН' : 'не виден'}`);
      if (seesTarget) console.log('    ', JSON.stringify(summarize(orders.find(o => String(o?.b_id ?? o?.id) === String(orderId)))));
    } catch (error) {
      console.log(`  ${endpoint} -> failed: ${stringifyError(error)}`);
    }
  }
}

async function main() {
  const config = readConfig();
  const client = new ClientSimulator(config);
  const orderId = await client.createVoteOrder({ caseName: 'DIAGNOSE' });
  console.log(`\nСоздан заказ ${orderId}. Проверяем видимость водителями...`);

  const drivers = Array.isArray(config.drivers) ? config.drivers : [];
  if (!drivers.length) {
    console.log('В config.drivers нет аккаунтов для проверки.');
    return;
  }
  for (let i = 0; i < Math.min(2, drivers.length); i += 1) {
    await driverView(config, drivers[i], `#${i + 1}`, orderId);
  }
}

main().catch(error => {
  console.error(`diagnose failed: ${stringifyError(error)}`);
  process.exit(1);
});
