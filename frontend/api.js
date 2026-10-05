// API 베이스 URL 결정
// - 백엔드(Express)가 프론트를 직접 서빙하면 같은 오리진 → ''
// - GitHub Pages 등 정적 호스팅이면 localStorage에 저장된 백엔드 주소 사용
function getApiBase() {
  try {
    const saved = localStorage.getItem('ormhome_api');
    if (saved) return saved.replace(/\/+$/, '');
  } catch (e) { /* 무시 */ }
  if (location.hostname.endsWith('github.io')) {
    return 'https://ormhome-backend.onrender.com'; // 기본값: Render 배포 백엔드
  }
  return ''; // 같은 오리진
}

function setApiBase(url) {
  try {
    if (url) localStorage.setItem('ormhome_api', url.trim());
    else localStorage.removeItem('ormhome_api');
  } catch (e) { /* 무시 */ }
}

async function apiFetch(path, options) {
  const res = await fetch(getApiBase() + path, options);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch (e) { /* 무시 */ }
    throw new Error(detail || `서버 오류 (${res.status})`);
  }
  return res.json();
}

// 만원 단위 → 읽기 좋은 표기
function fmtMoney(man) {
  if (man === null || man === undefined || isNaN(man)) return '-';
  const sign = man < 0 ? '-' : '';
  man = Math.abs(Math.round(man));
  if (man >= 10000) {
    const eok = Math.floor(man / 10000);
    const rest = man % 10000;
    return sign + (rest ? `${eok}억 ${rest.toLocaleString()}만` : `${eok}억`);
  }
  return sign + man.toLocaleString() + '만원';
}

// API 설정 UI (양쪽 페이지 공통, 푸터에 삽입)
function renderApiConfig(el) {
  const base = getApiBase();
  el.innerHTML = `
    <details class="api-config">
      <summary>⚙ 백엔드 API 설정 (현재: ${base || '같은 주소'})</summary>
      <label>백엔드 주소 <span class="hint">예: http://localhost:5000 또는 배포된 서버 주소</span></label>
      <input type="text" id="apiBaseInput" value="${base}" placeholder="http://localhost:5000">
      <button type="button" class="btn-ghost" id="apiBaseSave" style="margin-top:8px">저장</button>
    </details>`;
  el.querySelector('#apiBaseSave').addEventListener('click', () => {
    setApiBase(el.querySelector('#apiBaseInput').value);
    alert('저장되었습니다.');
    location.reload();
  });
}
