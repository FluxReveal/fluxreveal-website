/*
 * Badehusappen – brukergrensesnitt (prøveversjon)
 * ---------------------------------------------------------------
 * Viser kalender, booking, innsjekk, Mine bookinger og statistikk.
 * All data hentes og lagres via Store (js/store.js). Reglene sjekkes
 * med RulesEngine (js/rules-engine.js) for rask tilbakemelding, og
 * Store sjekker dem på nytt før noe lagres – slik Workeren skal gjøre.
 */
(function () {
  "use strict";
  const R = window.RulesEngine, S = window.Store;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const HOUSES = ["A", "B", "C", "D"];
  const HOUSE_KEY = "ht14-badehusappen-hus", MODE_KEY = "ht14-badehusappen-visning";
  const PLABEL = { FULL: "Heldag", AM: "Formiddag", PM: "Kveld" };
  const PTIME = { FULL: "08–24", AM: "08–14", PM: "14–24" };
  const STATUS = { BOOKED: "Booket", CHECKED_IN: "Sjekket inn", COMPLETED: "Brukt", NOT_CONFIRMED: "Ikke bekreftet",
    CANCELLED: "Avbestilt", CANCELLED_LATE: "Sent avbestilt" };
  const WD_SHORT = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];
  const MON_SHORT = ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];

  let rules, mode = localStorage.getItem(MODE_KEY) || "week", anchor, view = "kalender", statAnchor;
  let myHouse = localStorage.getItem(HOUSE_KEY) || null;

  /* ---------- Testklokke: ?tid=2027-07-05T10:00 (kun for prøving) ---------- */
  const tidParam = new URLSearchParams(location.search).get("tid");
  if (tidParam && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(tidParam)) {
    const [d, t] = tidParam.split("T"), [h, m] = t.split(":").map(Number);
    S.setClock(() => ({ date: d, minutes: h * 60 + m }));
    $("#clockNote").textContent = `(Testklokke: ${R.dateLabel(d)} ${d.slice(0, 4)} kl. ${t})`;
  }

  /* ---------- Små hjelpere ---------- */
  const now = () => S.now();
  const d2 = s => { const [y, m, d] = s.split("-").map(Number); return { y, m, d }; };
  const shortDate = s => { const p = d2(s); return `${p.d}. ${MON_SHORT[p.m - 1]}`; };
  function isoWeek(s) {
    const p = d2(s), t = new Date(Date.UTC(p.y, p.m - 1, p.d)), day = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - day + 3);
    const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((t - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  }
  function toast(text) {
    const t = $("#toast"); t.textContent = text; t.classList.add("show");
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 3200);
  }
  const houseChip = h => `<span class="chip h${h}">Hus ${h}</span>`;
  function setMyHouse(h) {
    myHouse = h; localStorage.setItem(HOUSE_KEY, h);
    $("#myHouseLabel").textContent = "Hus " + h;
  }
  async function allBookings() { return S.history({}); }
  function activeOn(list, date) { return list.filter(b => b.date === date && R.isActive(b.displayStatus)); }
  const lastBookable = () => R.addMonths(now().date, rules.bookingWindow.months);

  /* ---------- Kalender ---------- */
  async function renderCalendar() {
    const n = now();
    if (mode === "week") {
      const from = R.mondayOf(anchor), to = R.addDays(from, 6);
      $("#calTitle").textContent = `Uke ${isoWeek(from)} · ${shortDate(from)} – ${shortDate(to)}`;
      const list = await S.calendar({ from, to });
      let html = '<ol class="week">';
      for (let i = 0; i < 7; i++) {
        const date = R.addDays(from, i), act = activeOn(list, date);
        const full = act.find(b => b.period === "FULL");
        const past = R.hasEnded(rules, date, "PM", n);
        const slot = (b, p) => b
          ? `<span class="slot taken h${b.household}${b.displayStatus === "NOT_CONFIRMED" ? " nc" : ""}${p === "FULL" ? " full" : ""}"><span class="t">${PTIME[p]}</span> Hus ${b.household}${b.displayStatus !== "BOOKED" ? " · " + STATUS[b.displayStatus].toLowerCase() : ""}</span>`
          : `<span class="slot"><span class="t">${PTIME[p]}</span> Ledig</span>`;
        const slots = full ? slot(full, "FULL")
          : slot(act.find(b => b.period === "AM"), "AM") + slot(act.find(b => b.period === "PM"), "PM");
        const aria = full ? `heldag Hus ${full.household}` : ["AM", "PM"].map(p => { const b = act.find(x => x.period === p); return `${PLABEL[p].toLowerCase()} ${b ? "Hus " + b.household : "ledig"}`; }).join(", ");
        html += `<li><button type="button" class="day${date === n.date ? " today" : ""}${past ? " past" : ""}" data-date="${date}" aria-label="${esc(R.dateLabel(date))}${date === n.date ? " (i dag)" : ""}: ${esc(aria)}">
          <span class="dnum"><small>${WD_SHORT[i]}</small><b>${d2(date).d}</b></span><span class="slots">${slots}</span></button></li>`;
      }
      $("#calendar").innerHTML = html + "</ol>";
    } else {
      const p = d2(anchor), first = `${p.y}-${String(p.m).padStart(2, "0")}-01`;
      const last = R.addDays(R.addMonths(first, 1), -1);
      const from = R.mondayOf(first), to = R.addDays(R.mondayOf(last), 6);
      $("#calTitle").textContent = `${R.MONTHS[p.m - 1].replace(/^./, c => c.toUpperCase())} ${p.y}`;
      const list = await S.calendar({ from, to });
      let html = '<div class="month">' + WD_SHORT.map(w => `<div class="wd" aria-hidden="true">${w}</div>`).join("");
      for (let date = from; date <= to; date = R.addDays(date, 1)) {
        const act = activeOn(list, date), full = act.find(b => b.period === "FULL");
        const am = full || act.find(b => b.period === "AM"), pm = full || act.find(b => b.period === "PM");
        const past = R.hasEnded(rules, date, "PM", now());
        const aria = `${R.dateLabel(date)}: ` + (full ? `heldag Hus ${full.household}` : `formiddag ${am ? "Hus " + am.household : "ledig"}, kveld ${pm ? "Hus " + pm.household : "ledig"}`);
        html += `<button type="button" class="mcell${date.slice(0, 7) !== first.slice(0, 7) ? " out" : ""}${date === now().date ? " today" : ""}${past ? " past" : ""}${am || pm ? " has" : ""}" data-date="${date}" aria-label="${esc(aria)}">
          <span class="n">${d2(date).d}</span><span class="half${am ? " taken h" + am.household : ""}"></span><span class="half${pm ? " taken h" + pm.household : ""}"></span></button>`;
      }
      $("#calendar").innerHTML = html + "</div>";
    }
    $("#modeWeek").setAttribute("aria-pressed", mode === "week");
    $("#modeMonth").setAttribute("aria-pressed", mode === "month");
    $("#calendar").querySelectorAll("[data-date]").forEach(b => b.addEventListener("click", () => openDay(b.dataset.date)));
  }

  /* ---------- Ark: én dag ---------- */
  const sheet = $("#sheet");
  function openSheet(title, html) {
    $("#sheetTitle").textContent = title; $("#sheetBody").innerHTML = html;
    if (!sheet.open) sheet.showModal();
  }
  function closeSheet() { if (sheet.open) sheet.close(); }

  function bookingItem(b, n) {
    const mine = b.household === myHouse;
    let acts = "";
    if (mine) {
      if (R.validateCheckin(b, myHouse, rules, n).ok) acts += `<button type="button" class="primary" data-act="checkin" data-id="${b.id}">Sjekk inn</button>`;
      if (b.displayStatus === "BOOKED") acts += `<button type="button" class="secondary" data-act="cancel" data-id="${b.id}">Avbestill</button>`;
      if (b.displayStatus === "NOT_CONFIRMED") acts += `<button type="button" class="primary" data-act="confirm" data-id="${b.id}">Vi brukte badehuset</button>`;
    }
    const extra = b.source === "CHECKIN" ? " · spontan" : "";
    return `<li class="pitem" id="item-${b.id}"><div class="row">${houseChip(b.household)} <span>${PLABEL[b.period]} ${PTIME[b.period]}</span><span class="stat">${STATUS[b.displayStatus]}${extra}</span></div>
      ${acts ? `<div class="acts">${acts}</div>` : ""}</li>`;
  }

  async function openDay(date, keep) {
    const n = now(), all = await allBookings(), day = all.filter(b => b.date === date);
    const act = day.filter(b => R.isActive(b.displayStatus)), gone = day.filter(b => !R.isActive(b.displayStatus));
    let html = "";
    html += act.length ? `<ul class="plist">${act.map(b => bookingItem(b, n)).join("")}</ul>` : `<p class="muted">Ingen har booket denne dagen ennå.</p>`;
    if (gone.length) html += `<p class="muted">Avbestilt: ${gone.map(b => `Hus ${b.household} ${PLABEL[b.period].toLowerCase()} (${STATUS[b.status].toLowerCase()})`).join(", ")}</p>`;
    if (act.length && myHouse && !act.some(b => b.household === myHouse) && act.length) html += "";
    // Bookingskjema
    const types = ["FULL", "AM", "PM"].map(p => ({ p, free: !act.some(b => R.overlaps(rules, b.period, p)), ended: R.isOver(rules, date, p, n) }));
    const can = types.filter(t => t.free && !t.ended);
    if (date > lastBookable()) {
      html += `<div class="msg no">Denne datoen kan ikke bookes ennå. Du kan booke maks ${rules.bookingWindow.months} måneder frem – den åpner ${R.dateLabel(R.addMonths(date, -rules.bookingWindow.months))}.</div>`;
    } else if (can.length) {
      const sel = can[0].p;
      html += `<h3 class="label">Book for</h3><div class="pick" role="group" aria-label="Velg hus">${HOUSES.map(h =>
        `<button type="button" class="h${h}" data-house="${h}" aria-pressed="${h === myHouse}">Hus ${h}</button>`).join("")}</div>
        <h3 class="label">Hvor lenge?</h3><div class="types" role="group" aria-label="Velg periode">${types.map(t =>
        `<button type="button" data-type="${t.p}" aria-pressed="${t.p === sel}" ${t.free && !t.ended ? "" : "disabled"}><span>${PLABEL[t.p]}${t.p === "FULL" ? " (vanligst)" : ""}</span><span class="t">${PTIME[t.p]}${!t.free ? " · opptatt" : t.ended ? " · over" : ""}</span></button>`).join("")}</div>
        <div id="ruleMsg" aria-live="polite"></div>
        <button type="button" class="primary wide" id="bookBtn">Book</button>`;
    } else if (!R.hasEnded(rules, date, "PM", n)) {
      html += `<p class="muted">Hele dagen er booket.</p>`;
    }
    openSheet(R.dateLabel(date).replace(/^./, c => c.toUpperCase()) + (date === n.date ? " · i dag" : ""), html);
    wireDay(date, all);
  }

  function wireDay(date, all) {
    const body = $("#sheetBody");
    let house = myHouse, type = (body.querySelector('[data-type][aria-pressed="true"]') || {}).dataset?.type;
    const check = () => {
      const box = $("#ruleMsg"), btn = $("#bookBtn"); if (!box) return;
      if (!house) { box.innerHTML = `<div class="msg ok">Velg hvilket hus du booker for.</div>`; btn.disabled = true; btn.textContent = "Book"; return; }
      const res = R.validateBooking({ date, period: type, household: house }, all, rules, now());
      btn.disabled = !res.ok;
      btn.textContent = `Book ${PLABEL[type].toLowerCase()} for Hus ${house}`;
      if (!res.ok) { box.innerHTML = `<div class="msg no">${esc(res.message)}</div>`; return; }
      const wd = R.weekday(date), summer = rules.summer.months.includes(R.monthOf(date)) && rules.summer.weekendDays.includes(wd);
      const info = res.lifted ? (summer ? "Under 7 dager igjen – da er det førstemann til mølla, og bookingen teller ikke i sommerkvoten." : "Dette går fint.")
        : res.quota ? `Dette går fint. Bookingen blir Hus ${house} sin ${R.WD_NB[wd]} i ${R.MONTHS[R.monthOf(date) - 1]}.`
        : "Dette går fint.";
      box.innerHTML = `<div class="msg ok">${esc(info)}</div>`;
    };
    body.querySelectorAll("[data-house]").forEach(b => b.addEventListener("click", () => {
      house = b.dataset.house; body.querySelectorAll("[data-house]").forEach(x => x.setAttribute("aria-pressed", x === b)); check();
    }));
    body.querySelectorAll("[data-type]").forEach(b => b.addEventListener("click", () => {
      type = b.dataset.type; body.querySelectorAll("[data-type]").forEach(x => x.setAttribute("aria-pressed", x === b)); check();
    }));
    const bookBtn = $("#bookBtn");
    if (bookBtn) bookBtn.addEventListener("click", async () => {
      try {
        bookBtn.disabled = true;
        const b = await S.createBooking({ date, period: type, household: house });
        setMyHouse(house);
        closeSheet(); await refresh();
        toast(`Booket! Hus ${b.household} · ${PLABEL[b.period].toLowerCase()} ${R.dateLabel(b.date)} 🎉`);
      } catch (e) { $("#ruleMsg").innerHTML = `<div class="msg no">${esc(e.message)}</div>`; bookBtn.disabled = false; }
    });
    check();
    wireActions(body, () => openDay(date));
  }

  /** Knapper på en booking: sjekk inn, avbestill (med forhåndsvisning), bekreft bruk. */
  function wireActions(scope, after) {
    scope.querySelectorAll("[data-act]").forEach(btn => btn.addEventListener("click", async () => {
      const id = btn.dataset.id, act = btn.dataset.act;
      try {
        if (act === "checkin") { await S.checkIn(id, { household: myHouse }); toast("Sjekket inn – kos dere! ♨️"); }
        if (act === "confirm") { await S.confirmUsage(id, { household: myHouse }); toast("Takk! Registrert som brukt."); }
        if (act === "cancel") {
          const { booking } = await S.getBooking(id);
          const pre = R.validateCancel(booking, myHouse, rules, now());
          const box = btn.closest(".acts");
          box.innerHTML = `<div class="msg ${pre.ok ? (pre.late ? "no" : "ok") : "no"}" style="width:100%">${esc(pre.ok ? pre.message : pre.message)}</div>
            ${pre.ok ? `<button type="button" class="danger" data-yes>Ja, avbestill</button>` : ""}<button type="button" class="ghost" data-no>Behold bookingen</button>`;
          box.querySelector("[data-no]").addEventListener("click", after);
          const yes = box.querySelector("[data-yes]");
          if (yes) yes.addEventListener("click", async () => {
            try { const r = await S.cancelBooking(id, { household: myHouse }); await refresh(); await after(); toast(r.status === "CANCELLED_LATE" ? "Avbestilt (sen avbestilling)." : "Avbestilt."); }
            catch (e) { toast(e.message); }
          });
          return;
        }
        await refresh(); await after();
      } catch (e) { toast(e.message); }
    }));
  }

  /* ---------- Sjekk inn nå ---------- */
  async function openCheckin() {
    const n = now(), all = await allBookings();
    const mineToday = all.filter(b => b.date === n.date && b.household === myHouse && R.validateCheckin(b, myHouse, rules, n).ok);
    const opts = R.spontaneousOptions(all, rules, n);
    let html = "";
    if (mineToday.length) html += `<p>Dere har en booking nå:</p><ul class="plist">${mineToday.map(b => bookingItem(b, n)).join("")}</ul>`;
    if (opts.length) {
      html += `<p>${mineToday.length ? "Eller sjekk inn" : "Er badehuset ledig og dere vil bruke det nå? Sjekk inn"} uten booking:</p>
        <h3 class="label">Hvem er dere?</h3><div class="pick" role="group" aria-label="Velg hus">${HOUSES.map(h => `<button type="button" class="h${h}" data-house="${h}" aria-pressed="${h === myHouse}">Hus ${h}</button>`).join("")}</div>
        <h3 class="label">Hvor lenge?</h3><div class="types" role="group" aria-label="Velg periode">${opts.map((p, i) => `<button type="button" data-type="${p}" aria-pressed="${i === 0}"><span>${PLABEL[p]}</span><span class="t">${PTIME[p]}</span></button>`).join("")}</div>
        <button type="button" class="primary wide" id="spontBtn">Sjekk inn</button>
        <p class="muted">Spontan innsjekk teller i statistikken, men ikke i sommerkvoten. Dere sjekkes ut automatisk når perioden er over.</p>`;
    } else if (!mineToday.length) {
      html += n.minutes < 8 * 60 ? `<p>Badehuset kan brukes fra kl. 08:00. Kom tilbake da – eller book en dag i kalenderen.</p>`
        : `<p>Akkurat nå er badehuset opptatt eller dagen er over. Se kalenderen for ledige dager.</p>`;
    }
    openSheet("Sjekk inn nå", html);
    const body = $("#sheetBody");
    let house = myHouse, type = opts[0];
    body.querySelectorAll("[data-house]").forEach(b => b.addEventListener("click", () => { house = b.dataset.house; body.querySelectorAll("[data-house]").forEach(x => x.setAttribute("aria-pressed", x === b)); }));
    body.querySelectorAll("[data-type]").forEach(b => b.addEventListener("click", () => { type = b.dataset.type; body.querySelectorAll("[data-type]").forEach(x => x.setAttribute("aria-pressed", x === b)); }));
    const sb = $("#spontBtn");
    if (sb) sb.addEventListener("click", async () => {
      if (!house) { toast("Velg hvilket hus dere er."); return; }
      try { const b = await S.spontaneousCheckIn({ period: type, household: house }); setMyHouse(house); closeSheet(); await refresh(); toast(`Sjekket inn til ${rules.periods[b.period].end === "24:00" ? "00:00" : rules.periods[b.period].end} – kos dere! ♨️`); }
      catch (e) { toast(e.message); }
    });
    wireActions(body, () => { closeSheet(); });
  }

  /* ---------- Mine bookinger ---------- */
  async function renderMine() {
    const box = $("#mine");
    if (!myHouse) { box.innerHTML = `<p>Velg hvilket hus du hører til, så ser du husets bookinger her.</p><div class="pick">${HOUSES.map(h => `<button type="button" class="h${h}" data-house="${h}">Hus ${h}</button>`).join("")}</div>`;
      box.querySelectorAll("[data-house]").forEach(b => b.addEventListener("click", () => { setMyHouse(b.dataset.house); renderMine(); })); return; }
    const n = now(), all = (await allBookings()).filter(b => b.household === myHouse);
    const need = all.filter(b => b.displayStatus === "NOT_CONFIRMED");
    const coming = all.filter(b => b.displayStatus === "BOOKED" || b.displayStatus === "CHECKED_IN");
    const past = all.filter(b => ["COMPLETED", "CANCELLED", "CANCELLED_LATE"].includes(b.displayStatus)).reverse().slice(0, 30);
    const li = b => `<li class="pitem"><div class="row"><b>${esc(R.dateLabel(b.date).replace(/^./, c => c.toUpperCase()))}</b><span class="stat">${STATUS[b.displayStatus]}</span></div>
      <div class="row muted">${PLABEL[b.period]} ${PTIME[b.period]}${b.source === "CHECKIN" ? " · spontan" : ""}${b.quota ? " · i sommerkvoten" : ""}</div>${bookingItemActs(b, n)}</li>`;
    let html = `<p class="muted">Viser ${houseChip(myHouse)}. Alle i huset ser og kan endre de samme bookingene.</p>`;
    html += quotaSummary(all, n);
    if (need.length) html += `<h2>Ble badehuset brukt?</h2><ul class="list">${need.map(li).join("")}</ul>`;
    html += `<h2>Kommende</h2>` + (coming.length ? `<ul class="list">${coming.map(li).join("")}</ul>` : `<p class="muted">Ingen kommende bookinger. Trykk på en dag i kalenderen for å booke.</p>`);
    if (past.length) html += `<h2>Tidligere</h2><ul class="list">${past.map(li).join("")}</ul>`;
    box.innerHTML = html;
    wireActions(box, renderMine);
  }
  function bookingItemActs(b, n) {
    const m = bookingItem(b, n).match(/<div class="acts">[\s\S]*?<\/div>/);
    return m ? m[0] : "";
  }
  /** Sommerkvoten for sommermåneder innenfor bookingvinduet. */
  function quotaSummary(mine, n) {
    const out = [], end = lastBookable();
    for (let d = n.date.slice(0, 7) + "-01"; d <= end; d = R.addMonths(d, 1)) {
      const m = R.monthOf(d), y = R.yearOf(d);
      if (!rules.summer.months.includes(m)) continue;
      const parts = rules.summer.weekendDays.map(wd => {
        const used = [...new Set(mine.filter(b => R.countsForQuota(b) && R.monthOf(b.date) === m && R.yearOf(b.date) === y && R.weekday(b.date) === wd).map(b => b.date))];
        return `${R.WD_NB[wd]}: ${used.length ? "brukt (" + used.map(shortDate).join(", ") + ")" : "ledig"}`;
      });
      out.push(`<li class="card"><b>${R.MONTHS[m - 1].replace(/^./, c => c.toUpperCase())} ${y}</b><br><span class="muted">${parts.join(" · ")}</span></li>`);
    }
    return out.length ? `<h2>Sommerkvote</h2><ul class="list">${out.join("")}</ul>` : "";
  }

  /* ---------- Statistikk ---------- */
  async function renderStats() {
    const { y, m } = statAnchor;
    $("#statMonth").textContent = `${R.MONTHS[m - 1].replace(/^./, c => c.toUpperCase())} ${y}`;
    const s = await S.stats({ year: y, month: m });
    const card = (title, data) => {
      const max = Math.max(1, ...HOUSES.map(h => data[h].used + data[h].notConfirmed + data[h].upcoming));
      return `<div class="card"><b>${title}</b><div class="bars">${HOUSES.map(h => {
        const d = data[h], extra = [d.notConfirmed ? `${d.notConfirmed} ikke bekreftet` : "", d.upcoming ? `${d.upcoming} booket` : ""].filter(Boolean).join(", ");
        return `<div class="bar"><span>${houseChip(h)}</span><span class="track" aria-hidden="true"><span class="fill h${h}" style="display:block;width:${(d.used / max) * 100}%"></span><span class="fill nc h${h}" style="display:block;width:${(d.notConfirmed / max) * 100}%"></span></span><span><b>${d.used}</b> ${extra ? `<small>(${extra})</small>` : ""}</span></div>`;
      }).join("")}</div></div>`;
    };
    $("#stats").innerHTML = `<div class="statgrid">${card(`${R.MONTHS[m - 1].replace(/^./, c => c.toUpperCase())}`, s.month)}${card(`Sesongen ${y} (juni–august)`, s.season)}${card(`Hele ${y}`, s.year)}</div>`;
  }

  /* ---------- Navigasjon ---------- */
  async function refresh() {
    if (view === "kalender") await renderCalendar();
    if (view === "mine") await renderMine();
    if (view === "statistikk") await renderStats();
  }
  function show(v) {
    view = v;
    document.querySelectorAll(".view").forEach(s => { s.hidden = s.id !== "view-" + v; });
    document.querySelectorAll(".tabs button").forEach(b => b.toggleAttribute("aria-current", b.dataset.view === v));
    document.querySelectorAll(".tabs button[aria-current]").forEach(b => b.setAttribute("aria-current", "page"));
    window.scrollTo(0, 0);
    refresh();
  }
  function step(dir) {
    anchor = mode === "week" ? R.addDays(anchor, 7 * dir) : R.addMonths(anchor.slice(0, 8) + "01", dir);
    renderCalendar();
  }

  async function init() {
    try { rules = await S.getRules(); }
    catch (e) { $("#calendar").innerHTML = `<p class="msg no">${esc(e.message)}</p>`; return; }
    for (const h of HOUSES) document.documentElement.style.setProperty("--" + h, rules.households[h].color);
    $("#legend").innerHTML = HOUSES.map(h => `<span><span class="dot h${h}"></span>Hus ${h}</span>`).join("") + `<span>Stripete = ikke bekreftet</span>`;
    anchor = now().date;
    const p = d2(anchor); statAnchor = { y: p.y, m: p.m };
    if (myHouse) $("#myHouseLabel").textContent = "Hus " + myHouse;
    $("#prevBtn").addEventListener("click", () => step(-1));
    $("#nextBtn").addEventListener("click", () => step(1));
    $("#todayBtn").addEventListener("click", () => { anchor = now().date; renderCalendar(); });
    $("#modeWeek").addEventListener("click", () => { mode = "week"; localStorage.setItem(MODE_KEY, mode); renderCalendar(); });
    $("#modeMonth").addEventListener("click", () => { mode = "month"; localStorage.setItem(MODE_KEY, mode); renderCalendar(); });
    $("#checkinNowBtn").addEventListener("click", openCheckin);
    $("#sheetClose").addEventListener("click", closeSheet);
    sheet.addEventListener("click", e => { if (e.target === sheet) closeSheet(); });
    $("#statPrev").addEventListener("click", () => { statAnchor = statAnchor.m === 1 ? { y: statAnchor.y - 1, m: 12 } : { y: statAnchor.y, m: statAnchor.m - 1 }; renderStats(); });
    $("#statNext").addEventListener("click", () => { statAnchor = statAnchor.m === 12 ? { y: statAnchor.y + 1, m: 1 } : { y: statAnchor.y, m: statAnchor.m + 1 }; renderStats(); });
    document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
    $("#myHouseBtn").addEventListener("click", () => {
      openSheet("Hvilket hus hører du til?", `<p class="muted">Huset du velger, huskes på denne enheten. Du kan alltid velge et annet hus når du booker.</p><div class="pick">${HOUSES.map(h => `<button type="button" class="h${h}" data-house="${h}" aria-pressed="${h === myHouse}">Hus ${h}</button>`).join("")}</div>`);
      $("#sheetBody").querySelectorAll("[data-house]").forEach(b => b.addEventListener("click", () => { setMyHouse(b.dataset.house); closeSheet(); refresh(); }));
    });
    $("#resetBtn").addEventListener("click", async () => {
      if (!confirm("Vil du slette alle prøvebookingene på denne enheten?")) return;
      await S.reset(); toast("Prøvedata er nullstilt."); show("kalender");
    });
    // Oppdater visningen jevnlig, så status (pågår/ferdig) følger klokka.
    setInterval(() => { if (!sheet.open) refresh(); }, 60000);
    await renderCalendar();
  }
  init();

  // Enkel service worker (nett først), så appen åpner også uten nett.
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
