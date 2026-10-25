/*
 * Badehusappen – regelmotor
 * ---------------------------------------------------------------
 * Rene funksjoner uten sideeffekter. Den samme fila skal senere
 * brukes både i nettleseren og i Cloudflare Workeren.
 *
 * Tid: Alt regnes i Europe/Oslo som «veggklokke»: en dato
 * ("2027-07-10") og minutter etter midnatt (0–1440). 24:00 betyr
 * slutten av dagen (avklaring 10), også ved sommertid.
 *
 * Reglene leses fra rules.json – ingen regelverdier er hardkodet her.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RulesEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- Dato og tid (Europe/Oslo) ---------- */

  const WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli",
    "august", "september", "oktober", "november", "desember"];
  const WD_NB = { mon: "mandag", tue: "tirsdag", wed: "onsdag", thu: "torsdag",
    fri: "fredag", sat: "lørdag", sun: "søndag" };

  /** Nå i Oslo: { date: "YYYY-MM-DD", minutes: 0–1439 } */
  function osloNow(d = new Date(), tz = "Europe/Oslo") {
    const p = {};
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(d).forEach(x => { p[x.type] = x.value; });
    return { date: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour) * 60 + (+p.minute) };
  }

  const pad = n => String(n).padStart(2, "0");
  function parseDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    return { y, m: mo, d, t };
  }
  const isDate = s => parseDate(s) !== null;
  const fmt = t => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  function addDays(s, n) { const p = parseDate(s); p.t.setUTCDate(p.t.getUTCDate() + n); return fmt(p.t); }
  /** Antall kalenderdager fra b til a (a − b). */
  function diffDays(a, b) { return Math.round((parseDate(a).t - parseDate(b).t) / 86400000); }
  /** Samme dato n kalendermåneder senere (31. nov finnes ikke → 30. nov). */
  function addMonths(s, n) {
    const p = parseDate(s);
    const y = p.y + Math.floor((p.m - 1 + n) / 12), m = ((p.m - 1 + n) % 12 + 12) % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return `${y}-${pad(m + 1)}-${pad(Math.min(p.d, last))}`;
  }
  const weekday = s => WD[parseDate(s).t.getUTCDay()];
  const monthOf = s => parseDate(s).m;
  const yearOf = s => parseDate(s).y;
  /** Helgenøkkel = fredagens dato for helgen datoen hører til (avklaring 3). */
  function weekendKey(s) {
    const w = weekday(s);
    if (w === "fri") return s;
    if (w === "sat") return addDays(s, -1);
    if (w === "sun") return addDays(s, -2);
    return null;
  }
  /** Mandagen i uka datoen ligger i. */
  function mondayOf(s) { const i = parseDate(s).t.getUTCDay(); return addDays(s, -((i + 6) % 7)); }
  /** «lørdag 10. juli» */
  function dateLabel(s, withWeekday = true) {
    const p = parseDate(s);
    return (withWeekday ? WD_NB[weekday(s)] + " " : "") + `${p.d}. ${MONTHS[p.m - 1]}`;
  }
  const hm = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

  /* ---------- Perioder og statuser ---------- */

  function range(rules, period) {
    const p = rules.periods[period];
    return { start: hm(p.start), end: hm(p.end) };
  }
  /** FULL overlapper AM og PM; AM og PM overlapper ikke hverandre. */
  function overlaps(rules, p1, p2) {
    const a = range(rules, p1), b = range(rules, p2);
    return a.start < b.end && b.start < a.end;
  }
  const cmp = (d1, m1, d2, m2) => (d1 < d2 ? -1 : d1 > d2 ? 1 : m1 - m2);
  /** Er perioden over (nå ≥ slutt)? */
  function hasEnded(rules, date, period, now) {
    return cmp(now.date, now.minutes, date, range(rules, period).end) >= 0;
  }
  /** Har perioden startet (nå ≥ start)? */
  function hasStarted(rules, date, period, now) {
    return cmp(now.date, now.minutes, date, range(rules, period).start) >= 0;
  }
  /**
   * Er perioden «over» for nye bookinger og innsjekk? Det er den når den er
   * slutt, eller når en del av den er slutt (heldag etter kl. 14 – da er
   * formiddagen over, og man velger kveld i stedet).
   */
  function isOver(rules, date, period, now) {
    if (hasEnded(rules, date, period, now)) return true;
    const r = range(rules, period);
    return Object.keys(rules.periods).some(q => {
      const x = range(rules, q);
      return q !== period && x.start >= r.start && x.end <= r.end && hasEnded(rules, date, q, now);
    });
  }
  const ACTIVE = ["BOOKED", "CHECKED_IN", "COMPLETED", "NOT_CONFIRMED"];
  const isActive = st => ACTIVE.includes(st);

  /** Visningsstatus beregnet fra klokka (automatisk utsjekk / ikke bekreftet). */
  function effectiveStatus(b, rules, now) {
    if (!hasEnded(rules, b.date, b.period, now)) return b.status;
    if (b.status === "CHECKED_IN") return "COMPLETED";
    if (b.status === "BOOKED") return "NOT_CONFIRMED";
    return b.status;
  }
  /** Teller i sommerkvoten: quota=true og aktiv eller sent avbestilt. */
  const countsForQuota = b => b.quota === true && (isActive(b.status) || b.status === "CANCELLED_LATE");

  /* ---------- Hjelpere for meldinger ---------- */
  const fail = (error, message, extra) => Object.assign({ ok: false, error, message }, extra || {});
  const ok = extra => Object.assign({ ok: true }, extra || {});
  const periodName = (rules, p) => ({ FULL: "heldag", AM: "formiddagen", PM: "kvelden" }[p] || rules.periods[p].label);

  /* ---------- Booking ---------- */

  /**
   * Sjekker en ny booking. req = { date, period, household }.
   * Returnerer { ok:true, quota, lifted } eller { ok:false, error, message }.
   * Rekkefølgen følger LLD: input → passert → vindu → ledig → 7 dager → sommer.
   */
  function validateBooking(req, bookings, rules, now) {
    const today = now.date;
    if (!isDate(req.date) || !rules.periods[req.period] || !rules.households[req.household])
      return fail("INVALID_INPUT", "Noe gikk galt med valget ditt. Prøv igjen.");
    if (hasEnded(rules, req.date, req.period, now))
      return fail("IN_PAST", "Denne perioden er allerede over.");
    if (isOver(rules, req.date, req.period, now))
      return fail("IN_PAST", "Formiddagen er allerede over – velg kveld i stedet.");
    const last = addMonths(today, rules.bookingWindow.months);
    if (req.date > last)
      return fail("OUTSIDE_WINDOW", `Du kan booke maks ${rules.bookingWindow.months} måneder frem i tid – akkurat nå til og med ${dateLabel(last)}. Denne datoen åpner ${dateLabel(addMonths(req.date, -rules.bookingWindow.months))}.`);

    const clash = bookings.find(b => b.date === req.date && isActive(b.status) && overlaps(rules, b.period, req.period));
    if (clash) {
      const free = ["AM", "PM"].filter(p => !bookings.some(b => b.date === req.date && isActive(b.status) && overlaps(rules, b.period, p)));
      let msg = clash.household === req.household
        ? `Hus ${req.household} har allerede ${periodName(rules, clash.period)} denne dagen.`
        : `${cap(periodName(rules, clash.period))} er allerede booket av Hus ${clash.household}.`;
      if (free.length === 1) msg += ` ${cap(periodName(rules, free[0]))} er fortsatt ledig.`;
      return fail("SLOT_TAKEN", msg, { taken: clash.household });
    }

    const daysBefore = diffDays(req.date, today);
    if (daysBefore < rules.liftSummerRulesWhenDaysBefore)
      return ok({ quota: rules.shortNoticeCountsTowardQuota, lifted: true });          // Å1

    if (!rules.summer.months.includes(monthOf(req.date))) return ok({ quota: false });  // Å4
    const wd = weekday(req.date);
    if (!rules.summer.weekendDays.includes(wd)) return ok({ quota: false });

    const mine = bookings.filter(b => b.household === req.household && countsForQuota(b));
    const opens = dateLabel(addDays(req.date, -(rules.liftSummerRulesWhenDaysBefore - 1)));
    const tail = ` Fra ${opens} (under 7 dager før) er det førstemann til mølla, så da kan dere ta den hvis den er ledig.`;

    // 1) Maks én av hver helgedag per måned – teller DAGER. En annen periode
    //    samme dato som husstanden allerede har, teller ikke som en ny dag.
    const sameWd = distinct(mine.filter(b => b.date !== req.date && monthOf(b.date) === monthOf(req.date)
      && yearOf(b.date) === yearOf(req.date) && weekday(b.date) === wd));
    if (sameWd.length >= rules.summer.maxPerWeekdayPerMonth[wd])
      return fail("QUOTA_WEEKDAY", `Hus ${req.household} har allerede en ${WD_NB[wd]} i ${MONTHS[monthOf(req.date) - 1]} (${dateLabel(sameWd[0], false)}). Om sommeren kan hvert hus ha én fredag, én lørdag og én søndag per måned.` + tail, { rule: "summer.maxPerWeekdayPerMonth" });

    // 2) Maks én helgedag per helg (fre–søn), også over månedsskifte (Å3).
    const wk = weekendKey(req.date);
    const sameWeekend = distinct(mine.filter(b => b.date !== req.date && weekendKey(b.date) === wk));
    if (sameWeekend.length >= rules.summer.maxDaysPerWeekend)
      return fail("WEEKEND_LIMIT", `Hus ${req.household} har allerede ${dateLabel(sameWeekend[0])} denne helgen. Om sommeren kan hvert hus ta én dag per helg.` + tail, { rule: "summer.maxDaysPerWeekend" });

    return ok({ quota: true });
  }
  const distinct = list => [...new Set(list.map(b => b.date))].sort();
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---------- Avbestilling ---------- */

  /** Å6: alle i husstanden kan avbestille husstandens bookinger. */
  function validateCancel(b, household, rules, now) {
    if (!b) return fail("NOT_FOUND", "Fant ikke bookingen.");
    if (effectiveStatus(b, rules, now) !== "BOOKED")
      return fail("NOT_CANCELLABLE", "Denne bookingen kan ikke avbestilles.");
    if (rules.cancelPermission === "household" && b.household !== household)
      return fail("FORBIDDEN", `Bare Hus ${b.household} kan avbestille denne bookingen.`);
    const daysBefore = diffDays(b.date, now.date);
    const late = daysBefore <= rules.lateCancellationDays;
    return ok({
      late, status: late ? "CANCELLED_LATE" : "CANCELLED",
      message: late
        ? (b.quota ? "Det er 7 dager eller mindre igjen, så dette er en sen avbestilling. Dagen blir ledig for andre, men teller fortsatt i sommerkvoten deres."
                   : "Dagen blir ledig for andre. (Sen avbestilling, men denne bookingen telte ikke i kvoten.)")
        : "Dagen blir ledig for andre og teller ikke lenger i kvoten."
    });
  }

  /* ---------- Innsjekk og bekreftelse ---------- */

  function validateCheckin(b, household, rules, now) {
    if (!b) return fail("NOT_FOUND", "Fant ikke bookingen.");
    if (b.household !== household) return fail("FORBIDDEN", `Dette er Hus ${b.household} sin booking.`);
    if (effectiveStatus(b, rules, now) !== "BOOKED") return fail("NOT_CHECKIN", "Denne bookingen kan ikke sjekkes inn.");
    if (b.date !== now.date || !hasStarted(rules, b.date, b.period, now))
      return fail("TOO_EARLY", `Du kan sjekke inn når perioden starter (kl. ${rules.periods[b.period].start}).`);
    return ok();
  }

  /** Periodene man kan sjekke inn spontant på nå (pågår og er ledige). */
  function spontaneousOptions(bookings, rules, now) {
    return Object.keys(rules.periods).filter(p =>
      hasStarted(rules, now.date, p, now) && !isOver(rules, now.date, p, now) &&
      !bookings.some(b => b.date === now.date && isActive(b.status) && overlaps(rules, b.period, p)));
  }
  function validateSpontaneous(req, bookings, rules, now) {
    if (!rules.periods[req.period] || !rules.households[req.household]) return fail("INVALID_INPUT", "Noe gikk galt med valget ditt. Prøv igjen.");
    if (!spontaneousOptions(bookings, rules, now).includes(req.period))
      return fail("SLOT_TAKEN", "Den perioden er ikke ledig akkurat nå.");
    return ok({ quota: rules.spontaneousCheckinCountsTowardQuota });                       // Å2
  }

  function validateConfirm(b, household, rules, now) {
    if (!b) return fail("NOT_FOUND", "Fant ikke bookingen.");
    if (b.household !== household) return fail("FORBIDDEN", `Dette er Hus ${b.household} sin booking.`);
    if (effectiveStatus(b, rules, now) !== "NOT_CONFIRMED") return fail("NOT_CONFIRMABLE", "Denne bookingen trenger ingen bekreftelse.");
    return ok();
  }

  /* ---------- Statistikk ---------- */

  /**
   * Perioder per husstand. AM = 1, PM = 1, FULL = 2 (rules.periods[*].units).
   * Å7: COMPLETED og CHECKED_IN = bruk. NOT_CONFIRMED vises separat.
   * BOOKED (fremover) vises også separat. Avbestilte teller ikke som bruk.
   */
  function stats(bookings, rules, now, year, month) {
    const empty = () => Object.fromEntries(Object.keys(rules.households).map(h => [h, { used: 0, notConfirmed: 0, upcoming: 0 }]));
    const out = { month: empty(), season: empty(), year: empty() };
    for (const b of bookings) {
      if (yearOf(b.date) !== year) continue;
      const st = effectiveStatus(b, rules, now);
      const key = (st === "COMPLETED" || st === "CHECKED_IN") ? "used"
        : st === "NOT_CONFIRMED" ? "notConfirmed" : st === "BOOKED" ? "upcoming" : null;
      if (!key || !out.year[b.household]) continue;
      const u = rules.periods[b.period].units;
      out.year[b.household][key] += u;
      if (rules.summer.months.includes(monthOf(b.date))) out.season[b.household][key] += u;
      if (monthOf(b.date) === month) out.month[b.household][key] += u;
    }
    return out;
  }

  return {
    osloNow, isDate, addDays, diffDays, addMonths, weekday, weekendKey, mondayOf, monthOf, yearOf,
    dateLabel, MONTHS, WD_NB, range, overlaps, hasEnded, isOver, hasStarted, isActive, effectiveStatus,
    countsForQuota, validateBooking, validateCancel, validateCheckin, spontaneousOptions,
    validateSpontaneous, validateConfirm, stats
  };
});
