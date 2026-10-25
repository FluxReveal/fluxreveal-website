// Kjør: node --test tests/   (Node 18+, ingen avhengigheter)
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/rules-engine.js");
const rules = require("../rules.json");

const at = (date, hhmm = "10:00") => { const [h, m] = hhmm.split(":").map(Number); return { date, minutes: h * 60 + m }; };
let n = 0;
const bk = (date, period, household, extra = {}) =>
  Object.assign({ id: "t" + (++n), date, period, household, status: "BOOKED", quota: true, source: "BOOKING" }, extra);
const book = (date, period, household, bookings = [], now = at("2027-05-20")) =>
  R.validateBooking({ date, period, household }, bookings, rules, now);

test("dato-hjelpere", () => {
  assert.equal(R.weekday("2027-07-10"), "sat");
  assert.equal(R.weekendKey("2027-08-01"), "2027-07-30");      // søndag 1. aug → fredag 30. juli
  assert.equal(R.addMonths("2027-04-15", 3), "2027-07-15");
  assert.equal(R.addMonths("2026-11-30", 3), "2027-02-28");
  assert.equal(R.diffDays("2027-07-10", "2027-07-03"), 7);
  assert.equal(R.mondayOf("2026-10-25"), "2026-10-19");
});

test("Oslo-tid og sommertid", () => {
  assert.deepEqual(R.osloNow(new Date("2027-07-10T21:59:00Z")), { date: "2027-07-10", minutes: 23 * 60 + 59 }); // CEST
  assert.deepEqual(R.osloNow(new Date("2027-01-10T23:30:00Z")), { date: "2027-01-11", minutes: 30 });          // CET
  assert.deepEqual(R.osloNow(new Date("2026-10-25T01:30:00Z")), { date: "2026-10-25", minutes: 2 * 60 + 30 }); // etter omstilling
});

test("① perioder: heldag overlapper halvdager, formiddag og kveld gjør ikke", () => {
  assert.equal(R.overlaps(rules, "FULL", "AM"), true);
  assert.equal(R.overlaps(rules, "AM", "PM"), false);
  const ex = [bk("2027-07-10", "AM", "A")];
  assert.equal(book("2027-07-10", "PM", "C", ex).ok, true);
  const r = book("2027-07-10", "FULL", "C", ex);
  assert.equal(r.error, "SLOT_TAKEN");
  assert.match(r.message, /Hus A/);
  assert.match(r.message, /Kvelden er fortsatt ledig/);
});

test("avbestilte bookinger opptar ikke perioden", () => {
  assert.equal(book("2027-07-10", "FULL", "C", [bk("2027-07-10", "FULL", "A", { status: "CANCELLED" })]).ok, true);
  assert.equal(book("2027-07-10", "FULL", "C", [bk("2027-07-10", "FULL", "A", { status: "CANCELLED_LATE" })]).ok, true);
});

test("② bookingvindu: rullerende 3 måneder (Å5)", () => {
  const now = at("2027-04-15");
  assert.equal(book("2027-07-15", "FULL", "A", [], now).ok, true);
  assert.equal(book("2027-07-16", "FULL", "A", [], now).error, "OUTSIDE_WINDOW");
});

test("passert periode og pågående periode", () => {
  assert.equal(book("2027-07-10", "AM", "A", [], at("2027-07-10", "14:00")).error, "IN_PAST");
  assert.equal(book("2027-07-10", "AM", "A", [], at("2027-07-10", "13:59")).ok, true);
  assert.equal(book("2027-07-10", "PM", "A", [], at("2027-07-10", "23:59")).ok, true);   // 24:00 = slutt på dagen (Å10)
  assert.equal(book("2027-07-10", "FULL", "A", [], at("2027-07-10", "15:00")).error, "IN_PAST"); // formiddagen er over
});

test("③ sommerkvote: maks én fredag per måned, dager telles", () => {
  const ex = [bk("2027-07-09", "AM", "B")];
  assert.equal(book("2027-07-09", "PM", "B", ex).ok, true);                         // samme fredag = fortsatt 1
  const r = book("2027-07-16", "PM", "B", ex);
  assert.equal(r.error, "QUOTA_WEEKDAY");
  assert.match(r.message, /fredag i juli/);
  assert.equal(book("2027-07-16", "PM", "A", ex).ok, true);                         // et annet hus
  assert.equal(book("2027-08-06", "FULL", "B", ex).ok, true);                       // ny måned
});

test("④ helgebegrensning: én dag per helg", () => {
  const ex = [bk("2027-07-09", "FULL", "B")];
  assert.equal(book("2027-07-10", "FULL", "B", ex).error, "WEEKEND_LIMIT");
  assert.equal(book("2027-07-11", "FULL", "B", ex).error, "WEEKEND_LIMIT");
  assert.equal(book("2027-07-17", "FULL", "B", ex).ok, true);                       // neste helg, lørdag
});

test("Å3: helg over månedsskifte – kvote følger datoen, helgeregel følger helgen", () => {
  const ex = [bk("2027-07-30", "FULL", "C"), bk("2027-07-02", "FULL", "C", { status: "COMPLETED" })];
  assert.equal(book("2027-08-01", "FULL", "C", ex).error, "WEEKEND_LIMIT");
  assert.equal(book("2027-08-08", "FULL", "C", ex).ok, true);                       // august-søndag, annen helg
});

test("⑤ 7-dagersregel: under 7 dager → førstemann til mølla og ikke kvote (Å1)", () => {
  const now = at("2027-07-04");
  const ex = [bk("2027-07-02", "FULL", "A", { status: "COMPLETED" }), bk("2027-07-03", "FULL", "A")];
  const fre = book("2027-07-09", "FULL", "A", ex, now);                              // 5 dager før
  assert.equal(fre.ok, true); assert.equal(fre.lifted, true); assert.equal(fre.quota, false);
  const lor = book("2027-07-10", "FULL", "A", ex, now);                              // 6 dager før
  assert.equal(lor.ok, true);
  const son = book("2027-07-11", "FULL", "A", ex, now);                              // 7 dager før → regler gjelder
  assert.equal(son.ok, true);                                                          // ingen søndag i juli ennå, og helgen 9.–11. har bare kortvarsel-bookinger (quota false) i ex
  const ex2 = ex.concat([bk("2027-07-04", "FULL", "A")]);                             // søndag 4. juli med kvote
  assert.equal(book("2027-07-11", "FULL", "A", ex2, now).error, "QUOTA_WEEKDAY");
});

test("Å4: utenfor sommer ingen begrensninger", () => {
  const ex = [bk("2027-09-03", "FULL", "D")];
  assert.equal(book("2027-09-04", "FULL", "D", ex, at("2027-07-01")).ok, true);
  assert.equal(book("2027-09-10", "FULL", "D", ex, at("2027-07-01")).ok, true);
});

test("⑥ avbestilling: tidlig vs. sen, og sen teller i kvoten", () => {
  const b = bk("2027-07-10", "FULL", "A");
  assert.equal(R.validateCancel(b, "A", rules, at("2027-07-02")).status, "CANCELLED");      // 8 dager før
  assert.equal(R.validateCancel(b, "A", rules, at("2027-07-03")).status, "CANCELLED_LATE"); // 7 dager før
  assert.equal(R.validateCancel(b, "B", rules, at("2027-07-02")).error, "FORBIDDEN");       // Å6
  const late = [bk("2027-07-10", "FULL", "A", { status: "CANCELLED_LATE" })];
  assert.equal(book("2027-07-24", "FULL", "A", late).error, "QUOTA_WEEKDAY");                // teller fortsatt
  const early = [bk("2027-07-10", "FULL", "A", { status: "CANCELLED" })];
  assert.equal(book("2027-07-24", "FULL", "A", early).ok, true);                             // ut av kvoten
});

test("statusmaskin: automatisk utsjekk og ikke bekreftet", () => {
  const b = bk("2027-07-10", "AM", "A");
  assert.equal(R.effectiveStatus(b, rules, at("2027-07-10", "13:00")), "BOOKED");
  assert.equal(R.effectiveStatus(b, rules, at("2027-07-10", "14:00")), "NOT_CONFIRMED");
  assert.equal(R.effectiveStatus({ ...b, status: "CHECKED_IN" }, rules, at("2027-07-10", "14:00")), "COMPLETED");
  const pm = bk("2027-07-10", "PM", "A", { status: "CHECKED_IN" });
  assert.equal(R.effectiveStatus(pm, rules, at("2027-07-10", "23:59")), "CHECKED_IN");
  assert.equal(R.effectiveStatus(pm, rules, at("2027-07-11", "00:00")), "COMPLETED");
  assert.equal(R.validateConfirm(b, "A", rules, at("2027-07-11")).ok, true);
});

test("innsjekk: egen booking når perioden har startet, spontan når ledig", () => {
  const b = bk("2027-07-10", "PM", "A");
  assert.equal(R.validateCheckin(b, "A", rules, at("2027-07-10", "13:00")).error, "TOO_EARLY");
  assert.equal(R.validateCheckin(b, "A", rules, at("2027-07-10", "14:05")).ok, true);
  assert.equal(R.validateCheckin(b, "C", rules, at("2027-07-10", "14:05")).error, "FORBIDDEN");
  assert.deepEqual(R.spontaneousOptions([], rules, at("2027-07-10", "09:00")).sort(), ["AM", "FULL"]);
  assert.deepEqual(R.spontaneousOptions([], rules, at("2027-07-10", "07:00")), []);
  assert.deepEqual(R.spontaneousOptions([], rules, at("2027-07-10", "18:00")), ["PM"]);       // ikke heldag etter kl. 14
  assert.deepEqual(R.spontaneousOptions([b], rules, at("2027-07-10", "15:00")), []);
  assert.deepEqual(R.spontaneousOptions([b], rules, at("2027-07-10", "09:00")), ["AM"]);
  assert.equal(R.validateSpontaneous({ period: "AM", household: "D" }, [b], rules, at("2027-07-10", "09:00")).quota, false); // Å2
});

test("statistikk: perioder, NOT_CONFIRMED separat, avbestilt teller ikke (Å7)", () => {
  const now = at("2027-07-20");
  const list = [
    bk("2027-07-03", "FULL", "A", { status: "COMPLETED" }),
    bk("2027-07-10", "AM", "A"),                                  // passert uten innsjekk → NOT_CONFIRMED
    bk("2027-07-11", "PM", "B", { status: "CHECKED_IN" }),        // → COMPLETED
    bk("2027-07-17", "FULL", "C", { status: "CANCELLED_LATE" }),
    bk("2027-07-25", "FULL", "D"),                                 // fremover
    bk("2027-05-01", "AM", "A", { status: "COMPLETED" })
  ];
  const s = R.stats(list, rules, now, 2027, 7);
  assert.deepEqual(s.month.A, { used: 2, notConfirmed: 1, upcoming: 0 });
  assert.equal(s.month.B.used, 1);
  assert.deepEqual(s.month.C, { used: 0, notConfirmed: 0, upcoming: 0 });
  assert.equal(s.month.D.upcoming, 2);
  assert.equal(s.season.A.used, 2);
  assert.equal(s.year.A.used, 3);
});
