/* 听障就诊助手 · 服务端（零依赖，单端口）
   职责：托管静态页面 + 提供手环端与护士端共享的实时数据接口
   数据落盘在 state.json，重启不丢 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'state.json');

const APP_VER = '5.0';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};

/* ---------------- 数据 ---------------- */
function hm(offsetMin) {
  const d = new Date(Date.now() - (offsetMin || 0) * 60000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

const SEED = [
  ['张**', '男', 67, '耳鼻喉科', '3 诊室', 'A023', '听障'],
  ['李**', '女', 45, '骨科', '5 诊室', 'A021', '无'],
  ['王**', '男', 52, '消化内科', '2 诊室', 'A019', '无'],
  ['赵**', '女', 38, '放射科', '检查室 1', 'A017', '无'],
  ['陈**', '男', 71, '心内科', '6 诊室', 'A015', '轮椅'],
  ['刘**', '女', 29, '妇产科', '4 诊室', 'A012', '听障'],
  ['杨**', '男', 61, '呼吸内科', '1 诊室', 'A011', '耳背'],
  ['周**', '女', 34, '眼科', '7 诊室', 'A009', '无'],
  ['吴**', '男', 8, '儿科', '8 诊室', 'A007', '无'],
  ['徐**', '女', 56, '神经内科', '9 诊室', 'A005', '听障'],
  ['孙**', '男', 43, '骨科', '5 诊室', 'A003', '无'],
  ['马**', '女', 25, '耳鼻喉科', '3 诊室', 'A002', '识字困难']
];

function makeSeed() {
  const patients = SEED.map((s, i) => ({
    id: i + 1,
    name: s[0], gender: s[1], age: s[2], dept: s[3], room: s[4], no: s[5], need: s[6],
    note: '',
    status: '待发环',
    band: null,
    bandActive: false,
    callToken: null,
    examToken: null, examName: null, examSteps: null, examStep: 0,
    medToken: null, medWin: null, medMeds: null,
    registeredAt: hm(120 - i * 8),
    events: [{ t: hm(120 - i * 8), label: '自助机挂号成功 · ' + s[3] }]
  }));
  return {
    rev: 1,
    patients,
    feed: [{ t: hm(6), label: '今日已挂号 ' + patients.length + ' 人，等待发放手环', color: '#1F6FE0' }],
    sos: []
  };
}

let state = null;
try {
  const raw = fs.readFileSync(DATA, 'utf8');
  state = JSON.parse(raw);
  if (!state || !Array.isArray(state.patients) || !state.patients.length) state = makeSeed();
} catch (e) { state = makeSeed(); }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA, JSON.stringify(state)); } catch (e) { /* 忽略写盘失败 */ }
  }, 150);
}
function bump() { state.rev++; save(); }
function feedAdd(label, color) {
  state.feed.unshift({ t: hm(0), label, color: color || '#1F6FE0' });
  if (state.feed.length > 60) state.feed.length = 60;
}
function activePatientByBand(band) {
  return state.patients.find(p => p.bandActive && p.band === band) || null;
}
function publicPatient(p) {
  return {
    name: p.name, no: p.no, dept: p.dept, room: p.room, need: p.need,
    gender: p.gender, age: p.age, status: p.status
  };
}

/* 手环端会话：只暴露这支手环需要的信息 */
function sessionFor(band) {
  const p = activePatientByBand(band);
  if (!p) return { band, bound: false, rev: state.rev };
  return {
    band,
    bound: true,
    rev: state.rev,
    patient: publicPatient(p),
    call: p.callToken ? { room: p.room, no: p.no, name: p.name, token: p.callToken } : null,
    exam: p.examToken ? { name: p.examName, steps: p.examSteps || [], step: p.examStep, token: p.examToken } : null,
    med: p.medToken ? { win: p.medWin, meds: p.medMeds || [], token: p.medToken } : null
  };
}

/* ---------------- 业务动作 ---------------- */
function handleAction(body) {
  const t = body.type;
  const p = body.patientId ? state.patients.find(x => x.id === Number(body.patientId)) : null;

  switch (t) {
    case 'bind': {
      const band = String(body.band || '').toUpperCase();
      if (!p) return { code: 400, msg: '请先选择患者' };
      if (!band) return { code: 400, msg: '缺少手环编号' };
      const used = activePatientByBand(band);
      if (used && used.id !== p.id) return { code: 409, msg: '手环 ' + band + ' 正在给 ' + used.name + ' 使用' };
      if (p.bandActive) return { code: 409, msg: p.name + ' 已绑定手环 ' + p.band };
      p.band = band; p.bandActive = true;
      p.status = '候诊中';
      p.callToken = null;
      p.events.push({ t: hm(0), label: '护士扫码绑定手环 ' + band });
      feedAdd(p.no + ' ' + p.name + ' 领取手环 ' + band + ' · ' + p.dept, '#1F6FE0');
      bump();
      return { code: 0, patient: p, session: sessionFor(band) };
    }
    case 'call': {
      if (!p) return { code: 404, msg: '患者不存在' };
      if (!p.bandActive) return { code: 400, msg: '该患者尚未领取手环' };
      if (p.status === '已完成') return { code: 400, msg: '该患者已完成就诊' };
      p.status = '已叫号';
      p.callToken = Date.now();
      p.events.push({ t: hm(0), label: '叫号 · ' + p.room });
      feedAdd(p.no + ' ' + p.name + ' 已叫号 · ' + p.room, '#E8961F');
      bump();
      return { code: 0 };
    }
    case 'ack': {
      const band = String(body.band || '').toUpperCase();
      const a = activePatientByBand(band);
      if (!a) return { code: 404, msg: '手环未绑定' };
      a.callToken = null;
      if (a.status === '已叫号') a.status = '就诊中';
      a.events.push({ t: hm(0), label: '患者手环确认，前往 ' + a.room });
      feedAdd(a.name + ' 手环确认收到叫号', '#0FA3A0');
      bump();
      return { code: 0 };
    }
    case 'visit': {
      if (!p) return { code: 404 };
      p.callToken = null; p.status = '就诊中';
      p.events.push({ t: hm(0), label: '进入诊室就诊' });
      feedAdd(p.name + ' 进入 ' + p.room + ' 就诊', '#0FA3A0');
      bump();
      return { code: 0 };
    }
    case 'exam': {
      if (!p) return { code: 404 };
      p.examName = body.examName; p.examSteps = body.steps || []; p.examStep = 0;
      p.examToken = Date.now(); p.status = '检查中';
      p.events.push({ t: hm(0), label: '推送 ' + body.examName + ' 引导' });
      feedAdd(p.name + ' 开始 ' + body.examName + ' 引导', '#6E56D8');
      bump();
      return { code: 0 };
    }
    case 'examNext': {
      if (!p || !p.examSteps) return { code: 404 };
      if (p.examStep < p.examSteps.length - 1) {
        p.examStep++;
        p.events.push({ t: hm(0), label: '检查进行中 · 第 ' + (p.examStep + 1) + ' 步' });
        bump();
      }
      return { code: 0, step: p.examStep };
    }
    case 'examDone': {
      if (!p) return { code: 404 };
      p.status = '就诊中'; p.examToken = null; p.examName = null; p.examSteps = null; p.examStep = 0;
      p.events.push({ t: hm(0), label: '检查完成，返回诊室' });
      feedAdd(p.name + ' 检查完成，返回诊室', '#0FA3A0');
      bump();
      return { code: 0 };
    }
    case 'med': {
      if (!p) return { code: 404 };
      p.medWin = body.win; p.medMeds = body.meds || []; p.medToken = Date.now();
      p.events.push({ t: hm(0), label: '推送取药提醒 · ' + body.win });
      feedAdd(p.name + ' 收到取药提醒 · ' + body.win, '#0FA3A0');
      bump();
      return { code: 0 };
    }
    case 'medAck': {
      const band = String(body.band || '').toUpperCase();
      const a = activePatientByBand(band);
      if (!a) return { code: 404 };
      a.medToken = null;
      a.events.push({ t: hm(0), label: '患者已确认取到药' });
      feedAdd(a.name + ' 已确认取药', '#0FA3A0');
      bump();
      return { code: 0 };
    }
    case 'finish':
    case 'unbind': {
      if (!p) return { code: 404 };
      const band = p.band;
      p.status = '已完成';
      p.bandActive = false;
      p.callToken = null; p.examToken = null; p.medToken = null;
      p.events.push({ t: hm(0), label: t === 'finish' ? '全部就诊完成 · 手环回收' : '手环解绑回收' });
      feedAdd(p.name + ' ' + (t === 'finish' ? '全部就诊完成' : '手环已解绑') + ' · ' + band + ' 已回收', '#5A7C93');
      bump();
      return { code: 0 };
    }
    case 'sos': {
      const band = String(body.band || '').toUpperCase();
      const a = activePatientByBand(band);
      const item = {
        id: Date.now(),
        band,
        patient: a ? a.name : '未知患者',
        kind: body.kind || 'sos',
        loc: body.loc || '候诊区',
        time: hm(0),
        status: 'active'
      };
      if (a) a.events.push({ t: hm(0), label: (item.kind === 'interpreter' ? '呼叫手语翻译' : '一键求助') + ' · ' + item.loc });
      state.sos.unshift(item);
      feedAdd((item.kind === 'interpreter' ? '手语翻译请求' : '患者求助') + ' · ' + band + ' ' + item.loc,
        item.kind === 'interpreter' ? '#6E56D8' : '#F4574C');
      bump();
      return { code: 0 };
    }
    case 'sosHandle':
    case 'sosResolve': {
      const s = state.sos.find(x => x.id === Number(body.id));
      if (!s) return { code: 404 };
      s.status = t === 'sosHandle' ? 'handling' : 'resolved';
      s.time = hm(0) + (t === 'sosHandle' ? ' 处理中' : ' 已解决');
      bump();
      return { code: 0 };
    }
    default:
      return { code: 400, msg: '未知操作' };
  }
}

/* ---------------- HTTP ---------------- */
function sendJson(res, obj, code) {
  const body = JSON.stringify(obj);
  res.writeHead(code || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isHtml ? 'no-store, must-revalidate' : 'no-cache'
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  /* ---- API ---- */
  if (pathname === '/api/nurse' && req.method === 'GET') {
    return sendJson(res, {
      ver: APP_VER,
      rev: state.rev,
      patients: state.patients,
      feed: state.feed,
      sos: state.sos,
      time: hm(0)
    });
  }
  if (pathname.startsWith('/api/band/') && req.method === 'GET') {
    const band = pathname.slice('/api/band/'.length).toUpperCase();
    const s = sessionFor(band);
    s.ver = APP_VER;
    return sendJson(res, s);
  }
  if (pathname === '/api/action' && req.method === 'POST') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (e) { return sendJson(res, { code: 400, msg: '参数格式错误' }, 400); }
      try {
        const r = handleAction(body);
        if (r.code) return sendJson(res, r, r.code === 409 ? 409 : 400);
        sendJson(res, r);
      } catch (e) {
        sendJson(res, { code: 500, msg: String(e && e.message || e) }, 500);
      }
    });
    return;
  }
  if (pathname === '/api/health') return sendJson(res, { ok: true, rev: state.rev });

  /* ---- 静态 ---- */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); return res.end('Method Not Allowed');
  }
  if (pathname === '/' || pathname === '/index.html'
    || pathname === '/nurse' || pathname === '/nurse/' || pathname === '/nurse.html'
    || pathname === '/index') return serveFile(res, path.join(ROOT, 'index.html'));
  /* 手环端已下线：旧链接统一重定向到手表端 */
  if (pathname === '/band' || pathname === '/band/' || pathname === '/band.html'
    || pathname === '/patient' || pathname === '/patient/') {
    res.writeHead(302, { Location: '/watch/' });
    return res.end();
  }
  if (pathname === '/watch' || pathname === '/watch/' || pathname === '/watch.html') return serveFile(res, path.join(ROOT, 'watch', 'index.html'));

  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  serveFile(res, filePath);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('deaf-care-assistant listening on ' + PORT);
});
