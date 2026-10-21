/* 农历 → 公历（用于「农历九月廿八」生日）
 * 算法：Meeus 朔望月 + 太阳视黄经，按「冬至所在月为十一月、无中气置闰」规则。
 * 只依赖公历日期，不依赖设备时区（全部按北京时间 UTC+8 计算）。
 */
(function (global) {
  var RAD = Math.PI / 180, SYN = 29.530588861;
  var DELTA_T = 69 / 86400; // 2020s 的 ΔT 约 69 秒

  function jdFromBJ(y, m, d) { // 北京时间某日 00:00 的 JD(UT)
    return Date.UTC(y, m - 1, d) / 86400000 + 2440587.5 - 8 / 24;
  }
  function bjDayNumber(jd) { // 该时刻对应的北京日期序号（整数天）
    return Math.floor((jd + 8 / 24 - 2440587.5) * 86400000 / 86400000 + 1e-9);
  }
  function bjFromDayNumber(n) {
    var dt = new Date(n * 86400000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  function todayBJDayNumber() {
    var dt = new Date(Date.now() + 8 * 3600000);
    return Math.floor(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) / 86400000);
  }

  function newMoonJD(k) {
    var T = k / 1236.85;
    var jde = 2451550.09766 + SYN * k + 0.00015437 * T * T
      - 0.000000150 * T * T * T + 0.00000000073 * T * T * T * T;
    var E = 1 - 0.002516 * T - 0.0000074 * T * T;
    var M = 2.5534 + 29.10535670 * k - 0.0000014 * T * T - 0.00000011 * T * T * T;
    var Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T * T * T - 0.000000058 * T * T * T * T;
    var F = 160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T * T * T + 0.000000011 * T * T * T * T;
    var Om = 124.7746 - 1.56375588 * k + 0.0020672 * T * T + 0.00000215 * T * T * T;
    var d = -0.40720 * Math.sin(Mp * RAD)
      + 0.17241 * E * Math.sin(M * RAD)
      + 0.01608 * Math.sin(2 * Mp * RAD)
      + 0.01039 * Math.sin(2 * F * RAD)
      + 0.00739 * E * Math.sin((Mp - M) * RAD)
      - 0.00514 * E * Math.sin((Mp + M) * RAD)
      + 0.00208 * E * E * Math.sin(2 * M * RAD)
      - 0.00111 * Math.sin((Mp - 2 * F) * RAD)
      - 0.00057 * Math.sin((Mp + 2 * F) * RAD)
      + 0.00056 * E * Math.sin((2 * Mp + M) * RAD)
      - 0.00042 * Math.sin(3 * Mp * RAD)
      + 0.00042 * E * Math.sin((M + 2 * F) * RAD)
      + 0.00038 * E * Math.sin((M - 2 * F) * RAD)
      - 0.00024 * E * Math.sin((2 * Mp - M) * RAD)
      - 0.00017 * Math.sin(Om * RAD)
      - 0.00007 * Math.sin((Mp + 2 * M) * RAD)
      + 0.00004 * Math.sin((2 * Mp - 2 * F) * RAD)
      + 0.00004 * Math.sin(3 * M * RAD)
      + 0.00003 * Math.sin((Mp + M - 2 * F) * RAD)
      + 0.00003 * Math.sin((2 * Mp + 2 * F) * RAD)
      - 0.00003 * Math.sin((Mp + M + 2 * F) * RAD)
      + 0.00003 * Math.sin((Mp - M + 2 * F) * RAD)
      - 0.00002 * Math.sin((Mp - M - 2 * F) * RAD)
      - 0.00002 * Math.sin((3 * Mp + M) * RAD)
      + 0.00002 * Math.sin(4 * Mp * RAD);
    var P = [
      [299.77 + 0.107408 * k - 0.009173 * T * T, 0.000325],
      [251.88 + 0.016321 * k, 0.000165],
      [251.83 + 26.651886 * k, 0.000164],
      [349.42 + 36.412478 * k, 0.000126],
      [84.66 + 18.206239 * k, 0.000110],
      [141.74 + 53.303771 * k, 0.000062],
      [207.14 + 2.453732 * k, 0.000060],
      [154.84 + 7.306860 * k, 0.000056],
      [34.52 + 27.261239 * k, 0.000047],
      [207.19 + 0.121824 * k, 0.000042],
      [291.34 + 1.844379 * k, 0.000040],
      [161.72 + 24.198154 * k, 0.000037],
      [239.56 + 25.513099 * k, 0.000035],
      [331.55 + 3.592518 * k, 0.000023]
    ];
    for (var i = 0; i < P.length; i++) d += P[i][1] * Math.sin(P[i][0] * RAD);
    return jde + d - DELTA_T;
  }

  function sunLon(jd) {
    var T = (jd - 2451545.0) / 36525;
    var L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    var M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    var C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M * RAD)
      + (0.019993 - 0.000101 * T) * Math.sin(2 * M * RAD)
      + 0.000289 * Math.sin(3 * M * RAD);
    var Om = 125.04 - 1934.136 * T;
    return (L0 + C - 0.00569 - 0.00478 * Math.sin(Om * RAD)) % 360;
  }
  function solarTermJD(guessJD, target) {
    var jd = guessJD;
    for (var i = 0; i < 20; i++) {
      var diff = ((sunLon(jd) - target + 180) % 360 + 360) % 360 - 180;
      jd -= diff / 0.9856473;
      if (Math.abs(diff) < 1e-7) break;
    }
    return jd - DELTA_T;
  }

  // 从 y-1 年冬至所在月（十一月）开始的一个农历年
  function sui(y) {
    var ws1 = solarTermJD(jdFromBJ(y - 1, 12, 21), 270);
    var ws2 = solarTermJD(jdFromBJ(y, 12, 21), 270);
    var kEst = Math.floor((ws1 - 2451550.09766) / SYN);
    var m11 = -1e9, m11n = -1e9, k, t;
    for (k = kEst - 2; k <= kEst + 2; k++) {
      t = newMoonJD(k);
      if (t <= ws1 && t > m11) m11 = t;
    }
    var k2 = Math.floor((ws2 - 2451550.09766) / SYN);
    for (k = k2 - 2; k <= k2 + 2; k++) {
      t = newMoonJD(k);
      if (t <= ws2 && t > m11n) m11n = t;
    }
    var kStart = Math.round((m11 - 2451550.09766) / SYN);
    var kEnd = Math.round((m11n - 2451550.09766) / SYN);
    var starts = [];
    for (k = kStart; k <= kEnd; k++) starts.push(newMoonJD(k));
    // 中气
    var zhongqi = [];
    for (var i = 0; i <= 12; i++) {
      var target = (270 + 30 * i) % 360;
      zhongqi.push(solarTermJD(ws1 + i * 30.44, target));
    }
    var leapIdx = -1;
    if (starts.length - 1 === 13) {
      for (i = 0; i < 13; i++) {
        var has = false;
        for (var j = 0; j < zhongqi.length; j++) {
          if (zhongqi[j] >= starts[i] && zhongqi[j] < starts[i + 1]) { has = true; break; }
        }
        if (!has) { leapIdx = i; break; }
      }
    }
    var months = [], num = 11;
    for (i = 0; i < starts.length - 1; i++) {
      if (leapIdx === i) {
        months.push({ start: starts[i], leap: true, num: num });
      } else {
        months.push({ start: starts[i], leap: false, num: num });
        num = num % 12 + 1;
      }
    }
    return months;
  }

  function lunarYearMonths(y) {
    var ms = sui(y), idx = -1, i;
    for (i = 0; i < ms.length; i++) {
      if (ms[i].num === 1 && !ms[i].leap) { idx = i; break; }
    }
    return ms.slice(idx);
  }

  // 农历 y 年 m 月 d 日 => {y,m,d}
  function lunarToSolar(y, m, d) {
    var ms = lunarYearMonths(y);
    var i, found = null;
    for (i = 0; i < ms.length; i++) {
      if (ms[i].num === m && !ms[i].leap) { found = ms[i]; break; }
    }
    if (!found) return null;
    return bjFromDayNumber(bjDayNumber(found.start) + d - 1);
  }

  // 某公历年的农历九月廿八
  function birthdayOfYear(y) {
    return lunarToSolar(y, 9, 28);
  }

  // 今天离下一次农历九月廿八还有几天；返回 {days, date:{y,m,d}, isToday}
  function nextBirthday() {
    var today = todayBJDayNumber();
    var nowBJ = bjFromDayNumber(today);
    var target = birthdayOfYear(nowBJ.y);
    if (!target) target = birthdayOfYear(nowBJ.y + 1);
    var targetDay = Math.floor(Date.UTC(target.y, target.m - 1, target.d) / 86400000);
    if (targetDay < today) {
      target = birthdayOfYear(nowBJ.y + 1);
      targetDay = Math.floor(Date.UTC(target.y, target.m - 1, target.d) / 86400000);
    }
    return { days: targetDay - today, date: target, isToday: targetDay === today };
  }

  var API = {
    lunarToSolar: lunarToSolar,
    birthdayOfYear: birthdayOfYear,
    nextBirthday: nextBirthday,
    todayBJDayNumber: todayBJDayNumber
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.LunarBirthday = API;
})(typeof window !== 'undefined' ? window : globalThis);
