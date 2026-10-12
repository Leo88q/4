'use strict';
/**
 * Rewarded-видео (CONCEPT.md §10, Soft Launch) — «спонсорский просмотр».
 *
 * Честные ограничения:
 *  - награда — ТОЛЬКО Пигменты (выразительные материалы); Киноварь, Индекс
 *    и оценка реставрации не покупаются — pay-to-win запрещён (§4.4/§6.4);
 *  - дневной лимит на игрока; выдача фиксируется в Книге Слоёв;
 *  - демо-режим: просмотр подтверждается локально. В проде провайдер (AdMob /
 *    Unity Ads) присылает S2S-колбэк с подписью — без него награда не выдаётся
 *    (интеграционная точка, см. docs/api.md).
 */

export const REWARDED = {
  pigmentGrant: 20, // спонсорский грант за просмотр
  dailyCap: 3,      // просмотров в день на игрока
};

function today(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Сколько просмотров уже оплачено сегодня (источник — Книга). */
export function watchedToday(bookEntries = [], playerId, nowMs = Date.now()) {
  const date = today(nowMs);
  return bookEntries.filter((e) => e.type === 'rewarded'
    && e.playerId === playerId
    && e.payload?.date === date).length;
}

export function rewardedState(bookEntries = [], playerId, nowMs = Date.now()) {
  const watched = watchedToday(bookEntries, playerId, nowMs);
  return {
    grant: REWARDED.pigmentGrant,
    dailyCap: REWARDED.dailyCap,
    watchedToday: watched,
    left: Math.max(0, REWARDED.dailyCap - watched),
    date: today(nowMs),
  };
}
