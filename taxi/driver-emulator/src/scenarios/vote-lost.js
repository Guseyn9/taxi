/* eslint-disable no-console */
//
// Сценарий — Vote Lost (Проигрыш голосования)
//
//   Создать Vote заказ
//   -> дождаться, пока проголосует САМ тестер
//   -> дождаться отклик ДРУГОГО водителя
//   -> выбрать другого водителя
//
// Ожидаемая реакция Driver UI тестера:
//   Новый заказ -> Голосование (мой отклик отправлен) -> Не выбран / проиграл голосование
//
// Отличие от vote-not-selected: здесь явно фиксируется последовательность
// "тестер проголосовал -> выбран другой", чтобы на реальном Driver UI был виден
// именно переход в состояние проигрыша. Нужен минимум два отклика: тестер + ещё один
// водитель (бот из simulator.js `npm start` или второй реальный аккаунт).
//
const CASE_NAME = 'Vote Lost';

async function run({ client, testerUserId, log }) {
  const orderId = await client.createVoteOrder({ caseName: CASE_NAME });

  if (!testerUserId) {
    log('Не задан --tester: для кейса проигрыша нужно знать u_id тестера, чтобы выбрать ИМЕННО другого. Укажите --tester=<u_id>.');
  }

  // Шаг 1 — ждём отклик самого тестера (он "голосует" в Driver UI).
  log('Шаг 1: ждём отклик водителя-тестера (проголосуйте в Driver UI)...');
  await client.waitForResponses(orderId, { min: 1, includeUserId: testerUserId });
  const afterTester = await client.getCandidates(orderId);
  const tester = client.resolveTester(afterTester, testerUserId);
  if (!tester) {
    log('Тестер не откликнулся — проигрыш показать не на ком. Откликнитесь в Driver UI и перезапустите кейс.');
    return;
  }
  log(`Тестер ${tester} проголосовал.`);

  // Шаг 2 — ждём второго (другого) водителя.
  log('Шаг 2: ждём отклик другого водителя (бот `npm start` или второй аккаунт)...');
  const all = await client.waitForResponses(orderId, { min: 2, includeUserId: testerUserId });
  const other = client.resolveOther(all, tester);
  if (!other) {
    log('Другой водитель не откликнулся — выбрать "другого" не из кого. Запустите бота-водителя (npm start) и перезапустите кейс.');
    return;
  }

  // Шаг 3 — выбираем другого: тестер проигрывает голосование.
  await client.selectDriver(orderId, other);
  log(`Готово. Исполнителем выбран ДРУГОЙ водитель ${other}. На Driver UI тестера (${tester}) должно быть "Не выбран / голосование проиграно" (order ${orderId}).`);
}

module.exports = { key: 'vote-lost', name: CASE_NAME, run };
