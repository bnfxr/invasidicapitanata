(function () {
  "use strict";

  var DATA = window.GESI_DATA;
  if (!DATA) {
    document.body.innerHTML = "<p style='padding:2rem;font-family:sans-serif'>Dati non caricati.</p>";
    return;
  }

  var RES = DATA.order.slice();
  var SERIES = {};
  var META = {};
  RES.forEach(function (n) {
    SERIES[n] = DATA.reservoirs[n].series;
    META[n] = DATA.reservoirs[n].meta || {};
  });

  var PALETTE = {
    light: { Occhito: "#2f6f9f", Capacciotti: "#3f7d52", Capaccio: "#a97c1f", Osento: "#9c4a44" },
    dark: { Occhito: "#6fb0d6", Capacciotti: "#6fc08a", Capaccio: "#d9b25a", Osento: "#d98b84" }
  };
  var MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  var MONTHS_IT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  var TILES = {
    light: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    dark: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
  };
  var TILES_ATTR = "Tiles &copy; <a href='https://www.esri.com/'>Esri</a>";

  var state = {
    metric: "volume",
    range: "all",
    selected: new Set(RES),
    annualReservoir: RES[0],
    annualMetric: "volume"
  };

  function theme() { return document.documentElement.dataset.theme === "dark" ? "dark" : "light"; }
  function colors() { return PALETTE[theme()]; }
  function isNarrow() { return window.innerWidth <= 720; }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function d(iso) { return new Date(iso + "T00:00:00"); }
  function fmt(n, dec) {
    if (n === null || n === undefined || isNaN(n)) return "—";
    return n.toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  function fmtLevel(v) { return fmt(v, 2); }
  function fmtMm3(v) { return v === null || v === undefined ? "—" : fmt(v / 1e6, 2); }
  function fmtDateIt(iso) {
    if (!iso) return "—";
    var p = iso.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  function usable(name) { return META[name] && META[name].usable_capacity_m3; }
  function pctOf(name, volume) {
    var cap = usable(name);
    if (!cap || volume === null || volume === undefined) return null;
    return (volume / cap) * 100;
  }
  function mainLastDate() {
    var dates = RES.map(function (n) { return DATA.stats[n] && DATA.stats[n].last_date; }).filter(Boolean);
    return dates.sort().pop();
  }
  function minusYears(iso, years) {
    var dt = d(iso);
    dt.setFullYear(dt.getFullYear() - years);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }
  function pointOnOrBefore(name, targetIso) {
    var rows = SERIES[name], lo = 0, hi = rows.length - 1, res = null;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (rows[mid][0] <= targetIso) { res = rows[mid]; lo = mid + 1; } else { hi = mid - 1; }
    }
    return res;
  }
  function historicalAvg(name, iso, metric) {
    var md = iso.slice(5), year = iso.slice(0, 4), vals = [];
    SERIES[name].forEach(function (row) {
      if (row[0].slice(5) !== md || row[0].slice(0, 4) === year) return;
      var v = metric === "level" ? row[1] : row[2];
      if (v !== null && v !== undefined) vals.push(v);
    });
    if (!vals.length) return null;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }
  function yValue(name, row) {
    if (state.metric === "level") return row[1];
    if (state.metric === "volume") return row[2] === null ? null : row[2] / 1e6;
    return pctOf(name, row[2]);
  }
  function annualYValue(name, row) {
    return state.annualMetric === "level" ? row[1] : (row[2] === null ? null : row[2] / 1e6);
  }
  function calDoy(iso) {
    var p = iso.split("-");
    return MONTH_STARTS[parseInt(p[1], 10) - 1] + parseInt(p[2], 10) - 1;
  }
  function metricLabel() {
    return state.metric === "level" ? "Livello (m s.l.m.)" : state.metric === "volume" ? "Disponibilità (Mm³)" : "Capacità (%)";
  }
  function fmtMetricValue(v) {
    if (v === null || v === undefined) return "—";
    if (state.metric === "level") return fmt(v, 2) + " m";
    if (state.metric === "volume") return fmt(v, 2) + " Mm³";
    return fmt(v, 1) + "%";
  }
  function lerpColor(a, b, t) {
    var pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
    var pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
    var c = pa.map(function (v, i) { return Math.round(v + (pb[i] - v) * t); });
    return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
  }
  function yearRamp(count) {
    var light = theme() === "dark" ? ["#37444f", "#8ec2e6"] : ["#c6d7e3", "#12446b"];
    var out = [];
    for (var i = 0; i < count; i++) {
      out.push(count <= 1 ? light[1] : lerpColor(light[0], light[1], i / (count - 1)));
    }
    return out;
  }
  function withAlpha(rgbStr, a) {
    var m = rgbStr.match(/(\d+)\D+(\d+)\D+(\d+)/);
    return m ? "rgba(" + m[1] + "," + m[2] + "," + m[3] + "," + a + ")" : rgbStr;
  }

  function renderHeader() {
    var last = mainLastDate();
    document.getElementById("meta-updated").textContent = fmtDateIt(last);
    document.getElementById("meta-range").textContent = fmtDateIt("2018-01-01") + " – " + fmtDateIt(last);
    document.getElementById("generated-at").textContent = fmtDateIt(DATA.generated_at.slice(0, 10)) + " alle " + DATA.generated_at.slice(11, 16);
  }

  function renderCards() {
    var last = mainLastDate();
    var prevIso = minusYears(last, 1);
    var C = colors();
    var box = document.getElementById("cards");
    box.innerHTML = "";
    RES.forEach(function (name) {
      var cur = pointOnOrBefore(name, last);
      if (!cur) return;
      var prev = pointOnOrBefore(name, prevIso);
      var pct = pctOf(name, cur[2]);
      var avgVol = historicalAvg(name, last, "volume");
      var vsAvg = avgVol ? (cur[2] / avgVol) * 100 : null;
      var volDiff = prev && cur[2] != null && prev[2] != null ? (cur[2] - prev[2]) / 1e6 : null;
      var cls = volDiff == null ? "flat" : (Math.abs(volDiff) < 0.01 ? "flat" : (volDiff > 0 ? "up" : "down"));

      var card = document.createElement("article");
      card.className = "card";
      card.style.setProperty("--series", C[name]);
      var html = "";
      html += "<div class='card__top'><h3>" + name + "</h3><span class='card__river'>" + (META[name].river || "") + "</span></div>";
      html += "<div class='card__main'><span class='value'>" + fmtMm3(cur[2]) + "</span><span class='unit'>Mm³</span></div>";
      html += "<div class='card__row'><span>% capacità utilizzabile</span><b>" + (pct == null ? "—" : fmt(pct, 1) + "%") + "</b></div>";
      html += "<div class='meter'><span style='width:" + (pct == null ? 0 : Math.min(100, Math.max(0, pct))) + "%'></span></div>";
      html += "<div class='card__row'><span>Livello</span><b>" + fmtLevel(cur[1]) + " m</b></div>";
      html += "<div class='card__row'><span>vs media 2018–" + (parseInt(last.slice(0, 4), 10) - 1) + "</span><b>" + (vsAvg == null ? "—" : fmt(vsAvg, 0) + "%") + "</b></div>";
      if (volDiff != null) {
        html += "<div class='card__delta " + cls + "'>" + (volDiff >= 0 ? "+" : "−") + fmt(Math.abs(volDiff), 2) + " Mm³ rispetto a un anno fa</div>";
      }
      card.innerHTML = html;
      box.appendChild(card);
    });
  }

  var mainChart = null;
  function renderMainChart() {
    var C = colors();
    var cutoff = state.range === "all" ? null : minusYears(mainLastDate(), parseInt(state.range, 10));
    var datasets = RES.filter(function (n) { return state.selected.has(n); }).map(function (name) {
      var points = [];
      SERIES[name].forEach(function (row) {
        if (cutoff && row[0] < cutoff) return;
        var y = yValue(name, row);
        if (y === null || y === undefined) return;
        points.push({ x: row[0], y: y });
      });
      return {
        label: name, data: points, borderColor: C[name], backgroundColor: C[name], borderWidth: 1.8,
        pointRadius: 0, pointHoverRadius: 3, tension: 0.12, spanGaps: true
      };
    });

    var tickColor = cssVar("--muted"), gridColor = cssVar("--grid");
    var narrow = isNarrow();
    var fontS = narrow ? 12 : 11;
    var yTicks = { color: tickColor, font: { size: fontS } };
    if (state.metric === "pct") yTicks.callback = function (v) { return v + "%"; };
    else if (state.metric === "volume") yTicks.callback = function (v) { return fmt(v, 0); };

    if (mainChart) mainChart.destroy();
    mainChart = new Chart(document.getElementById("mainChart"), {
      type: "line",
      data: { datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, font: { size: fontS }, color: cssVar("--ink") } },
          tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label + ": " + fmtMetricValue(ctx.parsed.y); } } }
        },
        scales: {
          x: {
            type: "time", time: { tooltipFormat: "dd/MM/yyyy" },
            ticks: { color: tickColor, font: { size: fontS }, maxRotation: 0, autoSkip: true, maxTicksLimit: narrow ? 5 : 6, callback: function (v) { return new Date(v).toLocaleDateString("it-IT", { month: "short", year: "2-digit" }); } },
            grid: { color: gridColor }
          },
          y: { title: { display: true, text: metricLabel(), color: tickColor }, ticks: yTicks, grid: { color: gridColor } }
        }
      }
    });
  }

  var annualChart = null;
  function renderAnnualChart() {
    var name = state.annualReservoir;
    var years = {};
    SERIES[name].forEach(function (row) {
      var y = annualYValue(name, row);
      if (y === null || y === undefined) return;
      var year = row[0].slice(0, 4);
      (years[year] = years[year] || []).push({ x: calDoy(row[0]), y: y });
    });
    var yearKeys = Object.keys(years).sort();
    var maxYear = yearKeys[yearKeys.length - 1];
    var pastYears = yearKeys.filter(function (y) { return y !== maxYear; });
    var ramp = yearRamp(pastYears.length);
    var accent = theme() === "dark" ? "#e8a15a" : "#c05a17";
    var datasets = yearKeys.map(function (year) {
      var isCurrent = year === maxYear;
      var idx = pastYears.indexOf(year);
      var t = pastYears.length <= 1 ? 1 : idx / (pastYears.length - 1);
      return {
        label: year, data: years[year].sort(function (a, b) { return a.x - b.x; }),
        borderColor: isCurrent ? accent : withAlpha(ramp[idx], 0.5 + 0.5 * t),
        borderWidth: isCurrent ? 3.2 : 1.0 + 1.3 * t,
        pointRadius: 0, pointHoverRadius: 3, tension: 0.12, spanGaps: true, order: isCurrent ? 0 : 1
      };
    }).sort(function (a, b) {
      if (a.order !== b.order) return b.order - a.order;
      return a.label < b.label ? -1 : 1;
    });

    var tickColor = cssVar("--muted"), gridColor = cssVar("--grid");
    var narrowA = isNarrow();
    var fontA = narrowA ? 12 : 11;
    var yTicks = { color: tickColor, font: { size: fontA } };
    if (state.annualMetric === "volume") yTicks.callback = function (v) { return fmt(v, 0); };

    if (annualChart) annualChart.destroy();
    annualChart = new Chart(document.getElementById("annualChart"), {
      type: "line",
      data: { datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 12, font: { size: fontA }, color: cssVar("--ink") } },
          tooltip: {
            callbacks: {
              title: function (items) { return MONTHS_IT[monthOfDoy(items[0].parsed.x)] + " · " + items[0].dataset.label; },
              label: function (ctx) { return state.annualMetric === "level" ? fmt(ctx.parsed.y, 2) + " m" : fmt(ctx.parsed.y, 2) + " Mm³"; }
            }
          }
        },
        scales: {
          x: {
            type: "linear", min: 0, max: 365,
            afterBuildTicks: function (axis) { axis.ticks = MONTH_STARTS.map(function (v) { return { value: v }; }); },
            ticks: { color: tickColor, font: { size: fontA }, autoSkip: false, maxRotation: 0, callback: function (v) { return MONTH_STARTS.indexOf(v) >= 0 ? MONTHS_IT[MONTH_STARTS.indexOf(v)] : null; } },
            grid: { color: function (ctx) { return MONTH_STARTS.indexOf(ctx.tick.value) >= 0 ? gridColor : "transparent"; } }
          },
          y: {
            title: { display: true, text: state.annualMetric === "level" ? "Livello (m s.l.m.)" : "Disponibilità (Mm³)", color: tickColor },
            ticks: yTicks, grid: { color: gridColor }
          }
        }
      }
    });
  }

  function monthOfDoy(x) {
    for (var i = MONTH_STARTS.length - 1; i >= 0; i--) { if (x >= MONTH_STARTS[i]) return i; }
    return 0;
  }

  function renderSummaryTable() {
    var C = colors();
    var table = document.getElementById("summary-table");
    var head = "<thead><tr><th>Invaso</th><th>Attuale<br>(Mm³)</th><th>Minima<br>(Mm³)</th><th>Massima<br>(Mm³)</th></tr></thead>";
    var body = "<tbody>";
    RES.forEach(function (name) {
      var s = DATA.stats[name];
      if (!s) return;
      var cap = usable(name);
      var vmin = s.volume_min || {}, vmax = s.volume_max || {};
      var pCur = pctOf(name, s.latest_available_m3);
      var pMin = pctOf(name, vmin.value);
      var pMax = pctOf(name, vmax.value);
      var pctTag = function (p) { return p == null ? "" : " <span class='pct'>(" + fmt(p, 1) + "%)</span>"; };
      body += "<tr>";
      body += "<td><span class='name'><span class='swatch' style='--series:" + C[name] + "'></span>" + name + "</span>" +
        (cap ? "<div class='sub'>cap. " + fmtMm3(cap) + " Mm³</div>" : "") + "</td>";
      body += "<td><b>" + fmtMm3(s.latest_available_m3) + pctTag(pCur) + "</b><div class='sub'>" + fmtDateIt(s.last_date) + "</div></td>";
      body += "<td>" + fmtMm3(vmin.value) + pctTag(pMin) + "<div class='sub'>" + fmtDateIt(vmin.date) + "</div></td>";
      body += "<td>" + fmtMm3(vmax.value) + pctTag(pMax) + "<div class='sub'>" + fmtDateIt(vmax.date) + "</div></td>";
      body += "</tr>";
    });
    body += "</tbody>";
    table.innerHTML = head + body;
  }

  function renderYearlyTable() {
    var table = document.getElementById("yearly-table");
    var yearsMap = {};
    RES.forEach(function (name) {
      var sum = {}, cnt = {};
      SERIES[name].forEach(function (row) {
        var y = row[0].slice(0, 4), v = row[2];
        if (v === null || v === undefined) return;
        sum[y] = (sum[y] || 0) + v; cnt[y] = (cnt[y] || 0) + 1;
      });
      Object.keys(sum).forEach(function (y) { yearsMap[y] = yearsMap[y] || {}; yearsMap[y][name] = sum[y] / cnt[y]; });
    });
    var years = Object.keys(yearsMap).sort().reverse();
    var head = "<thead><tr><th>Anno (media Mm³)</th>" + RES.map(function (n) { return "<th>" + n + "</th>"; }).join("") + "</tr></thead>";
    var body = "<tbody>";
    years.forEach(function (y) {
      body += "<tr><td>" + y + "</td>";
      RES.forEach(function (n) {
        var v = yearsMap[y][n];
        if (v === undefined) { body += "<td>—</td>"; return; }
        var pct = pctOf(n, v);
        body += "<td>" + fmtMm3(v) + (pct == null ? "" : "<div class='sub'>" + fmt(pct, 0) + "%</div>") + "</td>";
      });
      body += "</tr>";
    });
    body += "</tbody>";
    table.innerHTML = head + body;
  }

  function renderSourceList() {
    var dl = document.getElementById("source-list");
    var s = DATA.source || {};
    var rows = [
      ["Ente", s.name || "Consorzio per la Bonifica della Capitanata"],
      ["Servizio", "GESI — Gestione Sistema Idrico"],
      ["API", s.api || "https://gesi.bonificacapitanata.it/api/v1/open_data/levels"],
      ["Pagina ufficiale", s.page || "https://www.bonificacapitanata.it/disponibilita-idrica/"]
    ];
    dl.innerHTML = rows.map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + r[1] + "</dd>"; }).join("");
  }

  function renderGallery() {
    var box = document.getElementById("gallery");
    if (!box) return;
    var C = colors();
    box.innerHTML = "";
    RES.forEach(function (name) {
      var p = META[name].photo;
      if (!p) return;
      var fig = document.createElement("figure");
      fig.className = "gallery__item";
      fig.innerHTML =
        "<img src='" + p.asset + "' alt='" + p.caption + "' loading='lazy' />" +
        "<figcaption>" +
        "<span class='gallery__name' style='--series:" + C[name] + "'>" + name + "</span>" +
        "<span class='gallery__place'>" + (META[name].municipality || "") + "</span>" +
        "<span class='gallery__cap'>" + p.caption + "</span>" +
        "<span class='gallery__credit'>" + p.author + " · <a href='" + p.source_url + "' target='_blank' rel='noopener'>Wikimedia Commons</a> · <a href='" + p.license_url + "' target='_blank' rel='noopener'>" + p.license + "</a>" + (p.generic ? " · immagine generica" : "") + "</span>" +
        "</figcaption>";
      box.appendChild(fig);
    });
  }

  function renderPhotoCredits() {
    var el = document.getElementById("photo-credits");
    if (!el) return;
    var parts = RES.map(function (name) {
      var p = META[name].photo;
      if (!p) return null;
      return "“" + p.caption + "” di " + p.author + " (<a href='" + p.source_url + "' target='_blank' rel='noopener'>Wikimedia Commons</a>, " + p.license + ")" + (p.generic ? " — immagine generica" : "");
    }).filter(Boolean);
    el.innerHTML = "Foto: " + parts.join("; ") + ".";
  }

  function buildChecks() {
    var C = colors();
    var box = document.getElementById("reservoir-chips");
    box.innerHTML = "";
    RES.forEach(function (name) {
      var label = document.createElement("label");
      label.className = "check" + (state.selected.has(name) ? "" : " off");
      label.innerHTML = "<input type='checkbox'" + (state.selected.has(name) ? " checked" : "") + "><span class='swatch' style='--series:" + C[name] + "'></span>" + name;
      label.querySelector("input").addEventListener("change", function (e) {
        if (e.target.checked) state.selected.add(name);
        else if (state.selected.size > 1) state.selected.delete(name);
        else e.target.checked = true;
        label.classList.toggle("off", !state.selected.has(name));
        renderMainChart();
      });
      box.appendChild(label);
    });
  }

  function wireSeg(id, stateKey, dataKey, onChange, numeric) {
    var seg = document.getElementById(id);
    if (!seg) return;
    seg.addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var raw = btn.dataset[dataKey];
      state[stateKey] = numeric && raw !== "all" ? parseInt(raw, 10) : raw;
      onChange();
    });
  }

  function applyThemeLabel() {
    var btn = document.getElementById("theme-toggle");
    btn.textContent = theme() === "dark" ? "Tema chiaro" : "Tema scuro";
  }

  function renderCharts() {
    renderMainChart();
    renderAnnualChart();
  }

  var map = null, tileLayer = null, geoLayer = null;
  function currentValue(name) {
    var row = pointOnOrBefore(name, mainLastDate());
    return row || [];
  }
  function renderMap() {
    if (!window.L || !document.getElementById("map")) return;
    var C = colors();
    if (!map) {
      map = L.map("map", { scrollWheelZoom: false, attributionControl: true });
      if (DATA.geo) {
        geoLayer = L.geoJSON(DATA.geo, {
          interactive: false,
          style: { color: cssVar("--map-line"), weight: 1.4, fill: false, dashArray: "4 4" }
        }).addTo(map);
      }
      var group = L.featureGroup();
      RES.forEach(function (name) {
        var m = META[name];
        if (m.lat == null || m.lon == null) return;
        var row = currentValue(name);
        var pct = pctOf(name, row[2]);
        var marker = L.circleMarker([m.lat, m.lon], {
          radius: 7, color: "#ffffff", weight: 1.5, fillColor: C[name], fillOpacity: 1
        });
        marker.bindPopup(
          "<strong>" + name + "</strong><br>" + (m.municipality || "") +
          "<br>Disponibilità: <b>" + fmtMm3(row[2]) + " Mm³</b>" +
          (pct == null ? "" : " (" + fmt(pct, 0) + "%)") +
          (m.province && m.province !== "Foggia" ? "<br><em>provincia di " + m.province + " (" + m.region + ")</em>" : "")
        );
        marker.addTo(group);
      });
      group.addTo(map);
      if (group.getLayers().length) {
        var b = group.getBounds();
        if (geoLayer) b.extend(geoLayer.getBounds());
        map.fitBounds(b, { padding: [10, 10] });
        map.setMaxBounds(b.pad(0.25));
        map.setMinZoom(map.getBoundsZoom(b.pad(0.45)));
      }
      map.__group = group;
    }
    if (geoLayer) geoLayer.setStyle({ color: cssVar("--map-line") });
    if (tileLayer) map.removeLayer(tileLayer);
    tileLayer = L.tileLayer(TILES[theme()], { attribution: TILES_ATTR, maxZoom: 16 });
    tileLayer.addTo(map);
    setTimeout(function () { map.invalidateSize(); }, 0);
  }

  function init() {
    applyThemeLabel();
    renderHeader();
    renderCards();
    buildChecks();
    renderSummaryTable();
    renderYearlyTable();
    renderSourceList();
    renderGallery();
    renderPhotoCredits();
    renderCharts();
    renderMap();

    wireSeg("metric-seg", "metric", "metric", renderMainChart);
    wireSeg("range-seg", "range", "range", renderMainChart, true);
    wireSeg("annual-metric-seg", "annualMetric", "metric", renderAnnualChart);

    var sel = document.getElementById("annual-reservoir");
    RES.forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name + " — " + (META[name].name || "");
      sel.appendChild(opt);
    });
    sel.addEventListener("change", function () { state.annualReservoir = sel.value; renderAnnualChart(); });

    var wasNarrow = isNarrow(), rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () {
        if (isNarrow() !== wasNarrow) { wasNarrow = isNarrow(); renderCharts(); }
      }, 200);
    });

    document.getElementById("theme-toggle").addEventListener("click", function () {
      var next = theme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) {}
      applyThemeLabel();
      renderCards();
      buildChecks();
      renderSummaryTable();
      renderGallery();
      renderCharts();
      renderMap();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
