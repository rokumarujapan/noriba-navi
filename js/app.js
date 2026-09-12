/*
 * のりばナビ — application logic.
 * Reads window.APP_DATA (see data.js) and renders:
 *   - a home screen: a top "route bar" (出発地 → 目的地, Yahoo!乗換案内式) plus a
 *     favorites list and the full destination list below it
 *   - a detail/result screen: nav summary, platform, next departures, full timetable
 *     button, and — below the departure times, only once a destination has been
 *     chosen — the map (platform pin, destination pin, and the route line where we
 *     have one)
 *   - an origin ("start point") picker modal: current location (GPS), tap-to-select
 *     on a small map, or free-text place search (OpenStreetMap Nominatim)
 * i18n: ja / en / zh / ko, switched live with no page reload.
 * Favorites persist via localStorage (this is a real hosted page, not a sandboxed
 * artifact preview, so localStorage is durable here).
 *
 * A note on the two Leaflet map instances (#map and #origin-map): both live inside
 * elements that start out hidden (a detail view that isn't shown yet, a modal tab
 * that isn't open yet). Leaflet mis-measures a container that is display:none at the
 * moment L.map() runs, so both maps are created lazily — the FIRST time their
 * container actually becomes visible — rather than eagerly on page load, and we
 * still call invalidateSize() defensively before every fitBounds/setView.
 */
(function () {
  'use strict';

  var DATA = window.APP_DATA;
  var FAV_KEY = 'noribanavi_favorites_v1';
  var LANG_KEY = 'noribanavi_lang_v1';

  // ---------------------------------------------------------------------
  // i18n strings
  // ---------------------------------------------------------------------
  var STR = {
    ja: {
      appTitle: 'のりばナビ',
      tagline: 'バスの「のりば番号」がひと目でわかる',
      searchPlaceholder: '行き先を入力・選択',
      favSectionTitle: 'お気に入り',
      favEmpty: 'お気に入りはまだありません。行き先の☆をタップして追加できます。',
      allDestTitleTemplate: '{origin} 発',
      backBtn: '← 戻る',
      gpsBtn: '現在地',
      gpsLocating: '現在地を取得中…',
      gpsDenied: '位置情報の利用が許可されませんでした。',
      gpsUnsupported: 'このブラウザは位置情報に対応していません。',
      routeLabel: '系統',
      platformLabel: 'のりば',
      travelMinTemplate: '約{min}分',
      navTemplate: '{origin} → {dest}',
      nextDepTitle: '次の便',
      etaTemplate: 'あと{min}分',
      etaHourMinTemplate: 'あと{h}時間{min}分',
      noMoreToday: '本日の運行は終了しました',
      viewTimetableBtn: '時刻表をすべて見る',
      favAdd: '☆ お気に入りに追加',
      favRemove: '★ お気に入りから削除',
      viaLabel: '経由',
      ttWeekday: '平日',
      ttSaturday: '土曜',
      ttHoliday: '日曜・祝日',
      ttCloseBtn: '閉じる',
      ttCountTemplate: '1日{n}本',
      mapNote: '地図データ: © OpenStreetMap contributors',
      attribution: 'バスデータ: 東京都交通局（公共交通オープンデータ協議会 経由）／ CC BY 4.0 ／ 地点検索: © OpenStreetMap Nominatim',
      platformNoteHeadsign: '※ 同じのりばでも行き先が異なる便が発着する場合があります。系統番号だけでなく行き先表示を必ず確認してください。',
      routeFromLabel: '出発地',
      routeToLabel: '目的地',
      originModalTitle: '出発地を選ぶ',
      originTabGps: '現在地',
      originTabMap: '地図でタップ',
      originTabText: 'テキスト検索',
      originGpsBtn: '📍 現在地を取得して設定',
      originMapHint: '地図をタップすると、その場所を出発地点に設定します。',
      originSearchPlaceholder: '駅名・地名を入力（例：五反田駅）',
      originSearchNoResults: '該当する場所が見つかりませんでした',
      originSearchError: '検索中にエラーが発生しました。時間をおいて再度お試しください。',
      originFoundNearTemplate: '選択した地点は「{name}」の対応エリア内です。',
      originOutOfAreaTemplate: 'この地点のバス乗り場データはまだありません。現在は「{name}」のデータのみ対応しています。',
      originCloseBtn: '閉じる',
      selectedPointLabel: '選択した地点',
      yourLocationLabel: '現在地'
    },
    en: {
      appTitle: 'Noriba Navi',
      tagline: 'Know exactly which bus platform to use',
      searchPlaceholder: 'Type or choose a destination',
      favSectionTitle: 'Favorites',
      favEmpty: 'No favorites yet. Tap the ☆ on a destination to add one.',
      allDestTitleTemplate: 'From {origin}',
      backBtn: '← Back',
      gpsBtn: 'My location',
      gpsLocating: 'Locating…',
      gpsDenied: 'Location access was not granted.',
      gpsUnsupported: 'This browser does not support geolocation.',
      routeLabel: 'Route',
      platformLabel: 'Platform',
      travelMinTemplate: '~{min} min',
      navTemplate: '{origin} → {dest}',
      nextDepTitle: 'Next departures',
      etaTemplate: 'in {min} min',
      etaHourMinTemplate: 'in {h}h {min}m',
      noMoreToday: 'No more departures today',
      viewTimetableBtn: 'View full timetable',
      favAdd: '☆ Add to favorites',
      favRemove: '★ Remove from favorites',
      viaLabel: 'Via',
      ttWeekday: 'Weekday',
      ttSaturday: 'Saturday',
      ttHoliday: 'Sunday / Holiday',
      ttCloseBtn: 'Close',
      ttCountTemplate: '{n} trips/day',
      mapNote: 'Map data: © OpenStreetMap contributors',
      attribution: 'Bus data: Tokyo Metropolitan Bureau of Transportation (via ODPT) / CC BY 4.0 / Place search: © OpenStreetMap Nominatim',
      platformNoteHeadsign: 'Note: the same platform can serve buses with different destinations. Always check the destination sign, not just the route number.',
      routeFromLabel: 'From',
      routeToLabel: 'To',
      originModalTitle: 'Choose your start point',
      originTabGps: 'My location',
      originTabMap: 'Tap on map',
      originTabText: 'Search by name',
      originGpsBtn: '📍 Use my current location',
      originMapHint: 'Tap anywhere on the map to set that as your start point.',
      originSearchPlaceholder: 'Type a station or place name (e.g. Gotanda Sta.)',
      originSearchNoResults: 'No matching places found',
      originSearchError: 'Something went wrong while searching. Please try again shortly.',
      originFoundNearTemplate: 'That point is within the "{name}" coverage area.',
      originOutOfAreaTemplate: 'There is no bus platform data for that area yet. Currently only "{name}" is supported.',
      originCloseBtn: 'Close',
      selectedPointLabel: 'Selected point',
      yourLocationLabel: 'Your location'
    },
    zh: {
      appTitle: '乘车站台导航',
      tagline: '一眼看清巴士的乘车站台号码',
      searchPlaceholder: '输入或选择目的地',
      favSectionTitle: '收藏',
      favEmpty: '暂无收藏。点击目的地旁的☆即可添加。',
      allDestTitleTemplate: '从 {origin} 出发',
      backBtn: '← 返回',
      gpsBtn: '当前位置',
      gpsLocating: '正在定位…',
      gpsDenied: '未授权使用位置信息。',
      gpsUnsupported: '此浏览器不支持定位功能。',
      routeLabel: '系统(路线)',
      platformLabel: '乘车站台',
      travelMinTemplate: '约{min}分钟',
      navTemplate: '{origin} → {dest}',
      nextDepTitle: '下一班',
      etaTemplate: '{min}分钟后',
      etaHourMinTemplate: '{h}小时{min}分钟后',
      noMoreToday: '今日已无班次',
      viewTimetableBtn: '查看完整时刻表',
      favAdd: '☆ 加入收藏',
      favRemove: '★ 取消收藏',
      viaLabel: '途经',
      ttWeekday: '平日',
      ttSaturday: '周六',
      ttHoliday: '周日/节假日',
      ttCloseBtn: '关闭',
      ttCountTemplate: '每日{n}班',
      mapNote: '地图数据: © OpenStreetMap contributors',
      attribution: '巴士数据: 东京都交通局（经由公共交通开放数据协议会）／ CC BY 4.0 ／ 地点搜索: © OpenStreetMap Nominatim',
      platformNoteHeadsign: '※ 同一站台也可能发往不同目的地的班次。请务必确认车头目的地显示，而非仅凭路线号码。',
      routeFromLabel: '出发地',
      routeToLabel: '目的地',
      originModalTitle: '选择出发地点',
      originTabGps: '当前位置',
      originTabMap: '地图点选',
      originTabText: '文字搜索',
      originGpsBtn: '📍 使用当前位置',
      originMapHint: '点击地图上的任意位置，即可将其设为出发地点。',
      originSearchPlaceholder: '输入车站或地名（如：五反田站）',
      originSearchNoResults: '未找到匹配的地点',
      originSearchError: '搜索时发生错误，请稍后再试。',
      originFoundNearTemplate: '所选地点在「{name}」的覆盖范围内。',
      originOutOfAreaTemplate: '该地区暂无巴士站台数据。目前仅支持「{name}」。',
      originCloseBtn: '关闭',
      selectedPointLabel: '所选地点',
      yourLocationLabel: '当前位置'
    },
    ko: {
      appTitle: '노리바 내비',
      tagline: '버스 승차장 번호를 한눈에',
      searchPlaceholder: '목적지를 입력하거나 선택',
      favSectionTitle: '즐겨찾기',
      favEmpty: '즐겨찾기가 없습니다. 목적지의 ☆를 눌러 추가하세요.',
      allDestTitleTemplate: '{origin} 출발',
      backBtn: '← 뒤로',
      gpsBtn: '현재 위치',
      gpsLocating: '위치 확인 중…',
      gpsDenied: '위치 정보 사용이 허용되지 않았습니다.',
      gpsUnsupported: '이 브라우저는 위치 정보를 지원하지 않습니다.',
      routeLabel: '노선',
      platformLabel: '승차장',
      travelMinTemplate: '약 {min}분',
      navTemplate: '{origin} → {dest}',
      nextDepTitle: '다음 출발',
      etaTemplate: '{min}분 후',
      etaHourMinTemplate: '{h}시간 {min}분 후',
      noMoreToday: '오늘 운행이 종료되었습니다',
      viewTimetableBtn: '전체 시간표 보기',
      favAdd: '☆ 즐겨찾기 추가',
      favRemove: '★ 즐겨찾기 삭제',
      viaLabel: '경유',
      ttWeekday: '평일',
      ttSaturday: '토요일',
      ttHoliday: '일요일/공휴일',
      ttCloseBtn: '닫기',
      ttCountTemplate: '하루 {n}회',
      mapNote: '지도 데이터: © OpenStreetMap contributors',
      attribution: '버스 데이터: 도쿄도 교통국(공공교통 오픈데이터 협의회 경유) / CC BY 4.0 / 장소 검색: © OpenStreetMap Nominatim',
      platformNoteHeadsign: '※ 같은 승차장이라도 목적지가 다른 버스가 있을 수 있습니다. 노선 번호만이 아니라 행선지 표시를 꼭 확인하세요.',
      routeFromLabel: '출발지',
      routeToLabel: '목적지',
      originModalTitle: '출발지 선택',
      originTabGps: '현재 위치',
      originTabMap: '지도에서 선택',
      originTabText: '텍스트 검색',
      originGpsBtn: '📍 현재 위치 사용',
      originMapHint: '지도를 탭하면 그 위치가 출발지로 설정됩니다.',
      originSearchPlaceholder: '역 이름이나 지명을 입력 (예: 고탄다역)',
      originSearchNoResults: '일치하는 장소를 찾을 수 없습니다',
      originSearchError: '검색 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      originFoundNearTemplate: '선택한 지점은 "{name}" 지원 지역 내에 있습니다.',
      originOutOfAreaTemplate: '해당 지역의 버스 승차장 데이터가 아직 없습니다. 현재는 "{name}"만 지원합니다.',
      originCloseBtn: '닫기',
      selectedPointLabel: '선택한 지점',
      yourLocationLabel: '현재 위치'
    }
  };

  // ---------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------
  var state = {
    lang: localStorage.getItem(LANG_KEY) || 'ja',
    view: 'home',
    currentOrigin: 'shinagawa',
    currentDest: null,
    search: '',
    favorites: [],
    selectedPoint: null,  // {lat, lon, label} — from GPS / map tap / text search
    originDisplayLabel: null // shown in the route bar when it differs from the active data origin (out-of-area pick)
  };

  try {
    var raw = localStorage.getItem(FAV_KEY);
    state.favorites = raw ? JSON.parse(raw) : [];
  } catch (e) {
    state.favorites = [];
  }

  function saveFavorites() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(state.favorites)); } catch (e) {}
  }

  function isFavorite(destId) { return state.favorites.indexOf(destId) !== -1; }

  function toggleFavorite(destId) {
    var idx = state.favorites.indexOf(destId);
    if (idx === -1) state.favorites.push(destId); else state.favorites.splice(idx, 1);
    saveFavorites();
  }

  // ---------------------------------------------------------------------
  // small helpers
  // ---------------------------------------------------------------------
  function t(key) { return (STR[state.lang] && STR[state.lang][key]) || STR.ja[key] || key; }

  function tmpl(str, vars) {
    return str.replace(/\{(\w+)\}/g, function (m, k) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, k)) ? vars[k] : m;
    });
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function originName(originId) {
    var origin = DATA.origins[originId];
    if (!origin) return originId;
    return origin.name[state.lang] || origin.name.ja;
  }

  function getServicePattern(date) {
    var day = date.getDay(); // 0=Sun .. 6=Sat
    if (day === 0) return 100; // Sunday / holiday pattern (public holidays not distinguished — see README)
    if (day === 6) return 160; // Saturday
    return 170; // weekday
  }

  function getNextDepartures(destId, count, fromDate) {
    var dest = DATA.destinations[destId];
    var pattern = getServicePattern(fromDate);
    var table = dest.timetable[pattern] || {};
    var hours = Object.keys(table).map(Number).sort(function (a, b) { return a - b; });
    var curH = fromDate.getHours(), curM = fromDate.getMinutes();
    var results = [];
    for (var i = 0; i < hours.length; i++) {
      var h = hours[i];
      if (h < curH) continue;
      var mins = table[h];
      for (var j = 0; j < mins.length; j++) {
        var mm = parseInt(mins[j], 10);
        if (h === curH && mm <= curM) continue;
        var etaMin = (h * 60 + mm) - (curH * 60 + curM);
        results.push({ h: h, m: mm, label: pad2(h) + ':' + pad2(mm), etaMin: etaMin });
        if (results.length >= count) break;
      }
      if (results.length >= count) break;
    }
    return results;
  }

  function formatEta(min) {
    if (min < 60) return tmpl(t('etaTemplate'), { min: min });
    return tmpl(t('etaHourMinTemplate'), { h: Math.floor(min / 60), min: min % 60 });
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function nearestOrigin(lat, lon) {
    var best = null;
    Object.keys(DATA.origins).forEach(function (id) {
      var o = DATA.origins[id];
      var km = haversineKm(lat, lon, o.lat, o.lon);
      if (!best || km < best.distanceKm) best = { id: id, distanceKm: km };
    });
    return best;
  }

  // ---------------------------------------------------------------------
  // origin ("start point") selection
  // ---------------------------------------------------------------------
  var ORIGIN_MATCH_RADIUS_KM = 1;

  function selectStartPoint(lat, lon, label) {
    var pointLabel = label || t('selectedPointLabel');
    state.selectedPoint = { lat: lat, lon: lon, label: pointLabel };
    var nearest = nearestOrigin(lat, lon);
    if (nearest && nearest.distanceKm <= ORIGIN_MATCH_RADIUS_KM) {
      state.currentOrigin = nearest.id;
      state.originDisplayLabel = null; // show the matched origin's own name, not the raw tap/search label
      showToast(tmpl(t('originFoundNearTemplate'), { name: originName(nearest.id) }));
    } else {
      // No data for this point yet: keep showing whatever origin's data we do have
      // (state.currentOrigin is left unchanged), but reflect what the user actually
      // picked in the route bar — silently snapping the label back to "品川駅高輪口"
      // when they clearly chose somewhere else just reads as "nothing happened".
      state.originDisplayLabel = pointLabel;
      showToast(tmpl(t('originOutOfAreaTemplate'), { name: originName(state.currentOrigin) }));
    }
    closeOriginModal();
    if (state.view === 'detail') { state.view = 'home'; }
    render();
  }

  function currentOriginLabel() {
    return state.originDisplayLabel || originName(state.currentOrigin);
  }

  function handleGpsClick() {
    if (!navigator.geolocation) { showToast(t('gpsUnsupported')); return; }
    showToast(t('gpsLocating'));
    navigator.geolocation.getCurrentPosition(function (pos) {
      selectStartPoint(pos.coords.latitude, pos.coords.longitude, t('yourLocationLabel'));
    }, function () {
      showToast(t('gpsDenied'));
    }, { timeout: 8000 });
  }

  function openOriginModal() {
    $('#origin-modal').hidden = false;
    setOriginTab('gps');
  }
  function closeOriginModal() {
    $('#origin-modal').hidden = true;
  }
  function setOriginTab(name) {
    ['gps', 'map', 'text'].forEach(function (tab) {
      $('#origin-tab-' + tab).hidden = (tab !== name);
    });
    document.querySelectorAll('#origin-tabs .tt-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-origin-tab') === name);
    });
    if (name === 'map') {
      // the panel just became visible — Leaflet needs a real layout pass before it
      // can measure the container, so defer creation/resize one frame.
      requestAnimationFrame(function () { ensureOriginMap(); });
    }
  }

  var searchDebounce = null;
  function runOriginSearch(query) {
    var results = $('#origin-search-results');
    if (!query || query.trim().length < 2) { results.innerHTML = ''; return; }
    results.innerHTML = '<p class="empty-note">' + t('gpsLocating') + '</p>';
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=jp&accept-language=' +
      encodeURIComponent(state.lang) + '&q=' + encodeURIComponent(query);
    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (list) {
        results.innerHTML = '';
        if (!list || list.length === 0) {
          results.innerHTML = '<p class="empty-note">' + t('originSearchNoResults') + '</p>';
          return;
        }
        list.forEach(function (item) {
          var row = document.createElement('button');
          row.className = 'origin-result';
          row.textContent = item.display_name;
          row.addEventListener('click', function () {
            selectStartPoint(parseFloat(item.lat), parseFloat(item.lon), item.display_name);
          });
          results.appendChild(row);
        });
      })
      .catch(function () {
        results.innerHTML = '<p class="empty-note">' + t('originSearchError') + '</p>';
      });
  }

  // ---------------------------------------------------------------------
  // maps (Leaflet) — two lazily-created instances:
  //   #map          the result/detail-screen map (platform + destination + route line)
  //   #origin-map   the small tap-to-select map inside the origin picker modal
  // ---------------------------------------------------------------------
  var map = null;
  var mapLayers = [];
  var originMap = null;

  function ensureMap() {
    if (!map) {
      map = L.map('map', { zoomControl: true, attributionControl: true }).setView([35.6285, 139.7375], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
    }
    map.invalidateSize();
    return map;
  }

  function ensureOriginMap() {
    var origin = DATA.origins[state.currentOrigin];
    if (!originMap) {
      originMap = L.map('origin-map', { zoomControl: false, attributionControl: false })
        .setView([origin.lat, origin.lon], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(originMap);
      originMap.on('click', function (e) {
        selectStartPoint(e.latlng.lat, e.latlng.lng, t('selectedPointLabel'));
      });
    }
    originMap.invalidateSize();
    return originMap;
  }

  function clearMapLayers() {
    mapLayers.forEach(function (l) { map.removeLayer(l); });
    mapLayers = [];
  }

  function renderMapForDest(destId) {
    ensureMap();
    clearMapLayers();
    var origin = DATA.origins[state.currentOrigin];
    var dest = DATA.destinations[destId];

    var originMarker = L.marker([origin.lat, origin.lon]).addTo(map)
      .bindPopup(originName(state.currentOrigin));
    mapLayers.push(originMarker);

    var platformIcon = L.divIcon({
      className: 'noriba-pin',
      html: '<div class="noriba-pin-num">' + dest.platform + '</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
    var platformMarker = L.marker(dest.platformLatLon, { icon: platformIcon }).addTo(map)
      .bindPopup(t('platformLabel') + ' ' + dest.platform);
    mapLayers.push(platformMarker);

    var destMarker = L.marker(dest.destLatLon).addTo(map)
      .bindPopup(dest.name[state.lang] || dest.name.ja);
    mapLayers.push(destMarker);

    var bounds = [[origin.lat, origin.lon], dest.platformLatLon, dest.destLatLon];

    if (dest.shape && dest.shape.length) {
      var line = L.polyline(dest.shape, { color: '#e6522c', weight: 5, opacity: 0.9 }).addTo(map);
      mapLayers.push(line);
      bounds = dest.shape.concat([dest.destLatLon]);
    }

    map.invalidateSize();
    map.fitBounds(bounds, { padding: [36, 36] });
  }

  // ---------------------------------------------------------------------
  // rendering
  // ---------------------------------------------------------------------
  var $ = function (sel) { return document.querySelector(sel); };

  function render() {
    document.documentElement.lang = state.lang;
    renderChrome();
    if (state.view === 'home') renderHome();
    else renderDetail(state.currentDest);
  }

  function renderChrome() {
    $('#app-title').textContent = t('appTitle');
    $('#app-tagline').textContent = t('tagline');
    $('#search-input').placeholder = t('searchPlaceholder');
    $('#gps-label').textContent = t('gpsBtn');
    $('#attribution').textContent = t('attribution');
    $('#map-note').textContent = t('mapNote');
    $('#route-from-label').textContent = t('routeFromLabel');
    $('#route-to-label').textContent = t('routeToLabel');
    $('#origin-current-label').textContent = currentOriginLabel();
    $('#origin-modal-title').textContent = t('originModalTitle');
    $('#origin-close-btn').textContent = t('originCloseBtn');
    $('#origin-gps-btn').textContent = t('originGpsBtn');
    $('#origin-map-hint').textContent = t('originMapHint');
    $('#origin-search-input').placeholder = t('originSearchPlaceholder');
    document.querySelector('[data-origin-tab="gps"]').textContent = t('originTabGps');
    document.querySelector('[data-origin-tab="map"]').textContent = t('originTabMap');
    document.querySelector('[data-origin-tab="text"]').textContent = t('originTabText');
    document.querySelectorAll('.lang-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === state.lang);
    });
  }

  function destList(originId) {
    var origin = DATA.origins[originId];
    return origin.destinations.map(function (id) { return DATA.destinations[id]; });
  }

  function renderHome() {
    $('#home-view').hidden = false;
    $('#detail-view').hidden = true;
    $('#all-dest-title').textContent = tmpl(t('allDestTitleTemplate'), { origin: originName(state.currentOrigin) });

    var mismatchNote = $('#origin-mismatch-note');
    if (state.originDisplayLabel) {
      mismatchNote.hidden = false;
      mismatchNote.textContent = tmpl(t('originOutOfAreaTemplate'), { name: originName(state.currentOrigin) });
    } else {
      mismatchNote.hidden = true;
    }

    // favorites
    var favWrap = $('#fav-section');
    favWrap.innerHTML = '';
    var favTitle = document.createElement('h2');
    favTitle.className = 'section-title';
    favTitle.textContent = t('favSectionTitle');
    favWrap.appendChild(favTitle);

    if (state.favorites.length === 0) {
      var empty = document.createElement('p');
      empty.className = 'empty-note';
      empty.textContent = t('favEmpty');
      favWrap.appendChild(empty);
    } else {
      var favList = document.createElement('div');
      favList.className = 'dest-grid';
      state.favorites.forEach(function (id) {
        var d = DATA.destinations[id];
        if (d) favList.appendChild(destCard(d));
      });
      favWrap.appendChild(favList);
    }

    // all destinations (filtered by the "to" field in the route bar)
    var listWrap = $('#dest-list');
    listWrap.innerHTML = '';
    var q = state.search.trim().toLowerCase();
    destList(state.currentOrigin).forEach(function (d) {
      var name = (d.name[state.lang] || d.name.ja).toLowerCase();
      var nameJa = d.name.ja.toLowerCase();
      if (q && name.indexOf(q) === -1 && nameJa.indexOf(q) === -1) return;
      listWrap.appendChild(destCard(d));
    });
  }

  function destCard(d) {
    var card = document.createElement('button');
    card.className = 'dest-card';
    card.setAttribute('data-dest', d.id);

    var top = document.createElement('div');
    top.className = 'dest-card-top';

    var name = document.createElement('span');
    name.className = 'dest-name';
    name.textContent = d.name[state.lang] || d.name.ja;
    top.appendChild(name);

    var star = document.createElement('span');
    star.className = 'dest-star' + (isFavorite(d.id) ? ' is-fav' : '');
    star.textContent = isFavorite(d.id) ? '★' : '☆';
    star.setAttribute('data-star-for', d.id);
    top.appendChild(star);

    card.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'dest-card-meta';
    var routeBadge = document.createElement('span');
    routeBadge.className = 'badge badge-route';
    routeBadge.textContent = d.route;
    var platBadge = document.createElement('span');
    platBadge.className = 'badge badge-platform';
    platBadge.textContent = t('platformLabel') + ' ' + d.platform;
    var travel = document.createElement('span');
    travel.className = 'dest-travel';
    travel.textContent = tmpl(t('travelMinTemplate'), { min: d.travelMin });
    meta.appendChild(routeBadge);
    meta.appendChild(platBadge);
    meta.appendChild(travel);
    card.appendChild(meta);

    card.addEventListener('click', function (evt) {
      if (evt.target && evt.target.getAttribute && evt.target.getAttribute('data-star-for')) return;
      openDetail(d.id);
    });
    return card;
  }

  function openDetail(destId) {
    state.currentDest = destId;
    state.view = 'detail';
    render();
  }

  function renderDetail(destId) {
    var d = DATA.destinations[destId];
    if (!d) { state.view = 'home'; render(); return; }

    $('#home-view').hidden = true;
    $('#detail-view').hidden = false;

    $('#detail-origin-name').textContent = originName(state.currentOrigin);
    $('#detail-dest-name').textContent = d.name[state.lang] || d.name.ja;
    $('#detail-route-badge').textContent = t('routeLabel') + ' ' + d.route;
    $('#detail-platform-badge').textContent = t('platformLabel') + ' ' + d.platform;
    $('#detail-travel').textContent = tmpl(t('travelMinTemplate'), { min: d.travelMin });

    var favBtn = $('#detail-fav-btn');
    favBtn.textContent = isFavorite(destId) ? t('favRemove') : t('favAdd');
    favBtn.classList.toggle('is-fav', isFavorite(destId));

    var viaRow = $('#detail-via');
    if (d.via) {
      viaRow.hidden = false;
      viaRow.textContent = t('viaLabel') + ': ' + (d.via[state.lang] || d.via.ja);
    } else {
      viaRow.hidden = true;
    }

    var noteRow = $('#detail-headsign-note');
    noteRow.textContent = t('platformNoteHeadsign');

    // next departures
    var nextWrap = $('#next-departures');
    nextWrap.innerHTML = '';
    var title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = t('nextDepTitle');
    nextWrap.appendChild(title);

    var deps = getNextDepartures(destId, 3, new Date());
    if (deps.length === 0) {
      var none = document.createElement('p');
      none.className = 'empty-note';
      none.textContent = t('noMoreToday');
      nextWrap.appendChild(none);
    } else {
      var row = document.createElement('div');
      row.className = 'dep-row';
      deps.forEach(function (dep, i) {
        var chip = document.createElement('div');
        chip.className = 'dep-chip' + (i === 0 ? ' dep-chip-next' : '');
        var time = document.createElement('div');
        time.className = 'dep-time';
        time.textContent = dep.label;
        var eta = document.createElement('div');
        eta.className = 'dep-eta';
        eta.textContent = formatEta(dep.etaMin);
        chip.appendChild(time);
        chip.appendChild(eta);
        row.appendChild(chip);
      });
      nextWrap.appendChild(row);
    }

    // the map's container has just been unhidden — wait one frame so Leaflet
    // measures it correctly before creating/resizing the map (see file header note).
    requestAnimationFrame(function () { renderMapForDest(destId); });
  }

  // ---------------------------------------------------------------------
  // timetable modal
  // ---------------------------------------------------------------------
  var ttActivePattern = 170;

  function openTimetable(destId) {
    var d = DATA.destinations[destId];
    ttActivePattern = getServicePattern(new Date());
    $('#tt-modal').hidden = false;
    $('#tt-title').textContent = d.name[state.lang] || d.name.ja;
    renderTimetableTabs();
    renderTimetableBody(destId);
  }

  function renderTimetableTabs() {
    var tabs = $('#tt-tabs');
    tabs.innerHTML = '';
    [[170, 'ttWeekday'], [160, 'ttSaturday'], [100, 'ttHoliday']].forEach(function (pair) {
      var btn = document.createElement('button');
      btn.className = 'tt-tab' + (ttActivePattern === pair[0] ? ' active' : '');
      btn.textContent = t(pair[1]);
      btn.setAttribute('data-pattern', pair[0]);
      tabs.appendChild(btn);
    });
  }

  function renderTimetableBody(destId) {
    var d = DATA.destinations[destId];
    var table = d.timetable[ttActivePattern] || {};
    var count = (d.timetable.counts && d.timetable.counts[ttActivePattern]) || 0;
    $('#tt-count').textContent = tmpl(t('ttCountTemplate'), { n: count });

    var body = $('#tt-body');
    body.innerHTML = '';
    var hours = Object.keys(table).map(Number).sort(function (a, b) { return a - b; });
    hours.forEach(function (h) {
      var tr = document.createElement('div');
      tr.className = 'tt-row';
      var hourCell = document.createElement('div');
      hourCell.className = 'tt-hour';
      hourCell.textContent = h;
      var minsCell = document.createElement('div');
      minsCell.className = 'tt-mins';
      minsCell.textContent = table[h].join('  ');
      tr.appendChild(hourCell);
      tr.appendChild(minsCell);
      body.appendChild(tr);
    });
  }

  function closeTimetable() { $('#tt-modal').hidden = true; }

  // ---------------------------------------------------------------------
  // toast
  // ---------------------------------------------------------------------
  var toastTimer = null;
  function showToast(msg) {
    var toast = $('#gps-toast');
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; }, 4500);
  }

  // ---------------------------------------------------------------------
  // events
  // ---------------------------------------------------------------------
  function wireEvents() {
    document.querySelectorAll('.lang-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.lang = b.getAttribute('data-lang');
        try { localStorage.setItem(LANG_KEY, state.lang); } catch (e) {}
        render();
      });
    });

    $('#search-input').addEventListener('input', function (e) {
      state.search = e.target.value;
      renderHome();
    });

    $('#gps-btn').addEventListener('click', handleGpsClick);

    $('#back-btn').addEventListener('click', function () {
      state.view = 'home';
      render();
    });

    $('#detail-fav-btn').addEventListener('click', function () {
      toggleFavorite(state.currentDest);
      renderDetail(state.currentDest);
    });

    $('#view-timetable-btn').addEventListener('click', function () {
      openTimetable(state.currentDest);
    });

    $('#tt-close-btn').addEventListener('click', closeTimetable);
    $('#tt-modal').addEventListener('click', function (e) {
      if (e.target.id === 'tt-modal') closeTimetable();
    });

    $('#tt-tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.tt-tab');
      if (!btn) return;
      ttActivePattern = parseInt(btn.getAttribute('data-pattern'), 10);
      renderTimetableTabs();
      renderTimetableBody(state.currentDest);
    });

    // origin ("route bar" from-field) picker
    $('#change-origin-btn').addEventListener('click', openOriginModal);
    $('#origin-close-btn').addEventListener('click', closeOriginModal);
    $('#origin-modal').addEventListener('click', function (e) {
      if (e.target.id === 'origin-modal') closeOriginModal();
    });
    $('#origin-tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.tt-tab');
      if (!btn) return;
      setOriginTab(btn.getAttribute('data-origin-tab'));
    });
    $('#origin-gps-btn').addEventListener('click', handleGpsClick);
    $('#origin-search-btn').addEventListener('click', function () {
      runOriginSearch($('#origin-search-input').value);
    });
    $('#origin-search-input').addEventListener('input', function (e) {
      clearTimeout(searchDebounce);
      var q = e.target.value;
      searchDebounce = setTimeout(function () { runOriginSearch(q); }, 500);
    });
    $('#origin-search-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(searchDebounce); runOriginSearch(e.target.value); }
    });

    // event delegation for favorite stars in lists
    document.addEventListener('click', function (e) {
      var star = e.target.closest('[data-star-for]');
      if (!star) return;
      e.stopPropagation();
      toggleFavorite(star.getAttribute('data-star-for'));
      render();
    });
  }

  // ---------------------------------------------------------------------
  // boot
  // ---------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    wireEvents();
    render();
  });
})();
