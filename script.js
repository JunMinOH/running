'use strict';

const inputType = document.querySelector('.form__input--type');
const inputCourseKm = document.querySelector('.form__input--course-km');
const btnAlert = document.querySelector('.btn-alert-distance');
const btnUndo = document.querySelector('.btn-undo');
const btnReset = document.querySelector('.btn-reset');
const btnSave = document.querySelector('.btn-save');
const btnLoad = document.querySelector('.btn-load');
const fileInput = document.querySelector('.gpx-input');

const spanCurrent = document.querySelector('.course-current');
const spanTarget = document.querySelector('.course-target');
const spanDiff = document.querySelector('.course-diff');

class App {
  #map;
  #mapZoomLevel = 15;
  #directionsService;

  #startLatLng = null; // {lat, lng}
  #lastPointLatLng = null;

  #startMarker = null;
  #segments = []; // [{ coords: [{lat,lng}...] }]
  #polyline = null;
  #pathCoords = []; // 전체 경로 좌표들

  constructor() {
    this._initMap();

    inputCourseKm.addEventListener('input', this._updateInfo.bind(this));
    btnAlert.addEventListener('click', this._alertDistance.bind(this));
    btnUndo.addEventListener('click', this._undoLastSegment.bind(this));
    btnReset.addEventListener('click', this._resetCourse.bind(this));
    btnSave.addEventListener('click', this._downloadGpx.bind(this));
    btnLoad.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', this._onGpxFileSelected.bind(this));
  }

  // ---------------- 지도 초기화 ----------------

  _initMap() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => this._loadMap(pos),
        () => this._loadMap()
      );
    } else {
      this._loadMap();
    }
  }

  _loadMap(position) {
    let center;
    if (position && position.coords) {
      const { latitude, longitude } = position.coords;
      center = { lat: latitude, lng: longitude };
    } else {
      center = { lat: 35.945, lng: 126.682 }; // 군산대 근처
    }

    this.#map = new google.maps.Map(document.getElementById('map'), {
      center,
      zoom: this.#mapZoomLevel,
    });

    this.#directionsService = new google.maps.DirectionsService();

    this.#map.addListener('click', e => this._onMapClick(e));
  }

  _onMapClick(e) {
    const latLng = e.latLng.toJSON();

    // 출발점 없으면 먼저 S 지정
    if (!this.#startLatLng) {
      this.#startLatLng = latLng;
      this.#lastPointLatLng = latLng;
      this.#pathCoords = [latLng];

      if (this.#startMarker) this.#startMarker.setMap(null);
      this.#startMarker = new google.maps.Marker({
        position: this.#startLatLng,
        map: this.#map,
        label: 'S',
      });

      this.#map.panTo(this.#startLatLng);
      this._redrawPolyline();
      this._updateInfo();
      return;
    }

    // 이후 클릭: 이전 지점 → 새 지점까지 구간 추가
    const origin = this.#lastPointLatLng;
    const destination = latLng;
    this.#lastPointLatLng = latLng;

    this._addRouteSegment(origin, destination);
  }

  // ---------------- 구간 추가 (Directions API) ----------------

  _addRouteSegment(origin, destination) {
    const travelMode =
      inputType.value === 'cycling'
        ? google.maps.TravelMode.BICYCLING
        : google.maps.TravelMode.WALKING;

    const request = {
      origin,
      destination,
      travelMode,
    };

    this.#directionsService.route(request, (result, status) => {
      if (status !== 'OK') {
        console.warn('Directions segment error:', status);
        // 실패하면 도로는 못 따라가도 직선으로라도 이어줌
        const segCoords = [origin, destination];

        this.#segments.push({ coords: segCoords });
        this._rebuildPathFromSegments();
        this._redrawPolyline();
        this._updateInfo();
        return;
      }

      const segCoords = result.routes[0].overview_path.map(p => ({
        lat: p.lat(),
        lng: p.lng(),
      }));

      if (segCoords.length === 0) return;

      this.#segments.push({ coords: segCoords });
      this._rebuildPathFromSegments();
      this._redrawPolyline();
      this._updateInfo();
    });
  }

  _rebuildPathFromSegments() {
    if (!this.#startLatLng) {
      this.#pathCoords = [];
      return;
    }

    let path = [this.#startLatLng];

    this.#segments.forEach(seg => {
      if (seg.coords && seg.coords.length > 0) {
        path = path.concat(seg.coords.slice(1));
      }
    });

    this.#pathCoords = path;
    this.#lastPointLatLng =
      this.#pathCoords.length > 0
        ? this.#pathCoords[this.#pathCoords.length - 1]
        : this.#startLatLng;
  }

  _redrawPolyline() {
    if (this.#polyline) this.#polyline.setMap(null);

    if (this.#pathCoords.length < 2) return;

    this.#polyline = new google.maps.Polyline({
      path: this.#pathCoords,
      map: this.#map,
      strokeColor:
        inputType.value === 'cycling' ? '#ffb545' : '#00c46a',
      strokeOpacity: 0.9,
      strokeWeight: 5,
    });
  }

  // ---------------- 거리 계산 ----------------

  _distanceBetween(p1, p2) {
    const R = 6371000; // m
    const toRad = deg => (deg * Math.PI) / 180;
    const φ1 = toRad(p1.lat);
    const φ2 = toRad(p2.lat);
    const Δφ = toRad(p2.lat - p1.lat);
    const Δλ = toRad(p2.lng - p1.lng);

    const a =
      Math.sin(Δφ / 2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  _getTotalDistanceKm() {
    if (this.#pathCoords.length < 2) return 0;

    let sum = 0;
    for (let i = 0; i < this.#pathCoords.length - 1; i++) {
      sum += this._distanceBetween(
        this.#pathCoords[i],
        this.#pathCoords[i + 1]
      );
    }
    return sum / 1000;
  }

  _updateInfo() {
    const currentKm = this._getTotalDistanceKm();
    spanCurrent.textContent = currentKm.toFixed(2);

    const targetKm = +inputCourseKm.value || null;
    if (targetKm) {
      spanTarget.textContent = targetKm.toFixed(2);
      const diff = currentKm - targetKm;
      spanDiff.textContent = diff.toFixed(2);

      spanDiff.style.color =
        Math.abs(diff) <= 0.2 ? '#00c46a' : '#ffb545';
    } else {
      spanTarget.textContent = '-';
      spanDiff.textContent = '-';
      spanDiff.style.color = '#ececec';
    }
  }

  _alertDistance() {
    const currentKm = this._getTotalDistanceKm();
    const targetKm = +inputCourseKm.value || null;

    let msg = `현재 코스 거리: ${currentKm.toFixed(2)} km`;

    if (targetKm) {
      const diff = currentKm - targetKm;
      msg += `\n목표 거리: ${targetKm.toFixed(2)} km`;
      msg += `\n차이: ${diff.toFixed(2)} km`;
    }

    alert(msg);
  }

  // ---------------- Undo / Reset ----------------

  _undoLastSegment() {
    if (!this.#startLatLng) return;

    if (this.#segments.length === 0) {
      this._resetCourse();
      return;
    }

    this.#segments.pop();
    this._rebuildPathFromSegments();
    this._redrawPolyline();
    this._updateInfo();
  }

  _resetCourse() {
    this.#segments = [];

    if (this.#polyline) {
      this.#polyline.setMap(null);
      this.#polyline = null;
    }

    if (this.#startMarker) {
      this.#startMarker.setMap(null);
      this.#startMarker = null;
    }

    this.#startLatLng = null;
    this.#lastPointLatLng = null;
    this.#pathCoords = [];

    this._updateInfo();
  }

  // ---------------- GPX 다운로드 ----------------

  _downloadGpx() {
    if (!this.#startLatLng || this.#pathCoords.length < 2) {
      alert('GPX로 내보낼 코스가 없습니다. 먼저 코스를 그려주세요.');
      return;
    }

    const now = new Date();
    const timeStr = now.toISOString();

    const header =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<gpx version="1.1" creator="RunningCoursePlanner" ` +
      `xmlns="http://www.topografix.com/GPX/1/1" ` +
      `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
      `xsi:schemaLocation="http://www.topografix.com/GPX/1/1 ` +
      `http://www.topografix.com/GPX/1/1/gpx.xsd">\n`;

    let trk =
      `  <trk>\n` +
      `    <name>Running Course</name>\n` +
      `    <time>${timeStr}</time>\n` +
      `    <trkseg>\n`;

    this.#pathCoords.forEach(p => {
      trk += `      <trkpt lat="${p.lat}" lon="${p.lng}">\n`;
      trk += `        <ele>0</ele>\n`;
      trk += `        <time>${timeStr}</time>\n`;
      trk += `      </trkpt>\n`;
    });

    trk += `    </trkseg>\n  </trk>\n</gpx>\n`;

    const gpx = header + trk;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    const currentKm = this._getTotalDistanceKm().toFixed(2);
    a.href = url;
    a.download = `running-course-${currentKm}km.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }

  // ---------------- GPX 불러오기 ----------------

  _onGpxFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      this._loadGpxFromText(text);
    };
    reader.readAsText(file, 'utf-8');

    // 같은 파일 다시 선택 가능하게 reset
    e.target.value = '';
  }

  _loadGpxFromText(gpxText) {
    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(gpxText, 'application/xml');

      const pts = Array.from(xml.getElementsByTagName('trkpt'));
      if (pts.length < 2) {
        alert('유효한 GPX 트랙 포인트가 없습니다.');
        return;
      }

      const coords = pts.map(pt => ({
        lat: parseFloat(pt.getAttribute('lat')),
        lng: parseFloat(pt.getAttribute('lon')),
      }));

      // 기존 코스 제거
      this._resetCourse();

      // 불러온 경로를 pathCoords로 사용
      this.#pathCoords = coords;
      this.#startLatLng = coords[0];
      this.#lastPointLatLng = coords[coords.length - 1];

      // segments는 한 덩어리로 처리 → Undo 하면 전체 지워지게
      this.#segments = [{ coords: coords }];

      // 시작 마커
      this.#startMarker = new google.maps.Marker({
        position: this.#startLatLng,
        map: this.#map,
        label: 'S',
      });

      this._redrawPolyline();
      this._updateInfo();
      this.#map.panTo(this.#startLatLng);

      alert('GPX 코스를 성공적으로 불러왔습니다.');
    } catch (err) {
      console.error(err);
      alert('GPX 파일을 읽는 중 오류가 발생했습니다.');
    }
  }
}

let app;

function initMap() {
  app = new App();
}
