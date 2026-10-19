/* 云端状态代理（EMQX 公共 MQTT Broker，免注册、WSS 标准 443 端口）
   护士端与手表端订阅同一个主题，任一设备执行动作后广播全量状态（retain 保留），
   对端 1 秒内收到并刷新；断线自动重连，心跳兜底保证丢消息自愈。
   Broker 无需注册与配置，国内网络可直连；不可用时用 localStorage 缓存兜底单机演示。 */
(function(){
  'use strict';
  var BROKER   = 'wss://broker.emqx.io:8084/mqtt';
  var TOPIC    = 'dca/demo/7qkx29';
  var MQTT_SRC = ['https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js',
                  'https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js'];
  var CACHE_KEY = 'dca_cache_v7';
  var APP_VER   = '5.0';
  var HEARTBEAT_MS = 10000;

  /* ---------- 工具 ---------- */
  function hm(offsetMin){
    var d = new Date(Date.now() - (offsetMin||0)*60000);
    function p(n){return String(n).padStart(2,'0');}
    return p(d.getHours())+':'+p(d.getMinutes());
  }

  /* ---------- 种子数据 ---------- */
  var SEED = [
    ['张**','男',67,'耳鼻喉科','3 诊室','A023','听障'],
    ['李**','女',45,'骨科','5 诊室','A021','无'],
    ['王**','男',52,'消化内科','2 诊室','A019','无'],
    ['赵**','女',38,'放射科','检查室 1','A017','无'],
    ['陈**','男',71,'心内科','6 诊室','A015','轮椅'],
    ['刘**','女',29,'妇产科','4 诊室','A012','听障'],
    ['杨**','男',61,'呼吸内科','1 诊室','A011','耳背'],
    ['周**','女',34,'眼科','7 诊室','A009','无'],
    ['吴**','男',8,'儿科','8 诊室','A007','无'],
    ['徐**','女',56,'神经内科','9 诊室','A005','听障'],
    ['孙**','男',43,'骨科','5 诊室','A003','无'],
    ['马**','女',25,'耳鼻喉科','3 诊室','A002','识字困难']
  ];

  function makeSeed(rev){
    var patients = SEED.map(function(s,i){
      return {
        id:i+1,name:s[0],gender:s[1],age:s[2],dept:s[3],room:s[4],no:s[5],need:s[6],
        note:'',status:'待发环',band:null,bandActive:false,
        callToken:null,examToken:null,examName:null,examSteps:null,examStep:0,
        medToken:null,medWin:null,medMeds:null,
        registeredAt:hm(120-i*8),
        events:[{t:hm(120-i*8),label:'自助机挂号成功 · '+s[3]}]
      };
    });
    return {
      rev:rev||1,patients:patients,
      feed:[{t:hm(6),label:'今日已挂号 '+patients.length+' 人，等待发放手环',color:'#1F6FE0'}],
      sos:[]
    };
  }

  /* ---------- 本地缓存（断网兜底） ---------- */
  function cacheLoad(){
    try{
      var raw = localStorage.getItem(CACHE_KEY);
      if(raw){
        var s = JSON.parse(raw);
        if(s && Array.isArray(s.patients) && s.patients.length) return s;
      }
    }catch(e){}
    return null;
  }
  function cacheSave(s){
    try{ localStorage.setItem(CACHE_KEY, JSON.stringify(s)); }catch(e){}
  }

  var state = cacheLoad() || makeSeed();

  /* ---------- MQTT 实时同步 ---------- */
  var client = null, connected = false, everSynced = false;
  var heartbeatTimer = null, seedTimer = null;
  var SID = 'd' + Math.random().toString(36).slice(2, 10);
  var readyResolve, readyResolved = false;
  var ready = new Promise(function(res){ readyResolve = res; });
  function readyNow(){ if(!readyResolved){ readyResolved = true; readyResolve(); } }

  function online(){ return connected; }
  window.__DCA_online = online;

  /* 状态变化后通知页面立即刷新（页面也保留轮询兜底） */
  function notifyUI(){
    try{ window.dispatchEvent(new CustomEvent('dca-state')); }catch(e){}
  }

  function applyRemote(remote){
    if(!remote || !Array.isArray(remote.patients) || !remote.patients.length) return false;
    if(Number(remote.rev||0) < Number(state.rev||0)) return false;
    var first = !everSynced;
    state = remote;
    everSynced = true;
    cacheSave(state);
    notifyUI();
    if(first) readyNow();
    return true;
  }

  function publish(obj, retain){
    if(!client || !client.connected) return false;
    obj.sid = SID;
    try{
      client.publish(TOPIC, JSON.stringify(obj), {qos:0, retain:!!retain});
      return true;
    }catch(e){ return false; }
  }
  /* 状态变化后广播（retain 保留，后加入的设备订阅即可拿到最新状态） */
  function broadcast(){ publish({k:'state', rev:Number(state.rev||0), state:state}, true); }

  function connect(){
    var c = window.mqtt.connect(BROKER, {
      clientId:'dca_' + SID, clean:true, keepalive:30,
      reconnectPeriod:2000, connectTimeout:8000
    });
    client = c;

    c.on('connect', function(){
      if(client !== c) return;
      connected = true;
      c.subscribe(TOPIC, {qos:0});
      /* 上线：向主题内其他设备索要当前全量状态；broker 同时会推送 retain 的最近状态 */
      publish({k:'hello'}, false);
      if(seedTimer) clearTimeout(seedTimer);
      seedTimer = setTimeout(function(){
        if(client !== c || everSynced) return;
        /* 1.8 秒内没拿到任何对端状态：以本地为准（首次即播种） */
        everSynced = true; cacheSave(state); broadcast(); readyNow();
      }, 1800);
      if(heartbeatTimer) clearInterval(heartbeatTimer);
      /* 心跳兜底：即使 retain 丢失也能在 10 秒内自愈（不覆盖 retain） */
      heartbeatTimer = setInterval(function(){
        publish({k:'state', rev:Number(state.rev||0), state:state}, false);
      }, HEARTBEAT_MS);
    });

    c.on('message', function(topic, payload){
      if(client !== c) return;
      var msg;
      try{ msg = JSON.parse(payload.toString()); }catch(e){ return; }
      if(msg.sid === SID) return;            /* 忽略自己发回的消息 */
      if(msg.k === 'hello'){
        broadcast();                         /* 新设备上线：把我手里的最新状态发给它 */
      }else if(msg.k === 'state'){
        applyRemote(msg.state);
      }
    });

    function down(){
      if(client !== c) return;
      connected = false;
      if(heartbeatTimer){ clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }
    c.on('close', down);
    c.on('offline', down);
    c.on('error', function(){});
  }

  /* 按需加载 MQTT 组件（两个 CDN 兜底），加载成功即接入公共 Broker */
  function ensureMqtt(){
    if(window.mqtt && typeof window.mqtt.connect === 'function'){ connect(); return; }
    var i = 0;
    (function load(){
      if(i >= MQTT_SRC.length){ everSynced = true; cacheSave(state); return; }
      var s = document.createElement('script');
      s.src = MQTT_SRC[i++];
      s.onload = function(){
        if(window.mqtt && typeof window.mqtt.connect === 'function') connect();
        else load();
      };
      s.onerror = load;
      document.head.appendChild(s);
    })();
  }
  ensureMqtt();
  /* 兜底：无论如何 3 秒后放行页面（MQTT 组件缺失或连不上时单机演示） */
  setTimeout(readyNow, 3000);

  /* ---------- 业务动作 ---------- */
  function bump(){ state.rev = (Number(state.rev)||0) + 1; cacheSave(state); }
  function feedAdd(label,color){
    state.feed.unshift({t:hm(0),label:label,color:color||'#1F6FE0'});
    if(state.feed.length>40) state.feed.length=40;
  }
  function activePatientByBand(band){
    return state.patients.find(function(p){ return p.bandActive && p.band===band; }) || null;
  }
  function publicPatient(p){
    return {name:p.name,no:p.no,dept:p.dept,room:p.room,need:p.need,gender:p.gender,age:p.age,status:p.status};
  }
  function sessionFor(band){
    var p = activePatientByBand(band);
    if(!p) return {band:band,bound:false,rev:state.rev};
    return {
      band:band,bound:true,rev:state.rev,
      patient:publicPatient(p),
      call:p.callToken ? {room:p.room,no:p.no,name:p.name,token:p.callToken} : null,
      exam:p.examToken ? {name:p.examName,steps:p.examSteps||[],step:p.examStep,token:p.examToken} : null,
      med:p.medToken ? {win:p.medWin,meds:p.medMeds||[],token:p.medToken} : null
    };
  }

  function handleAction(body){
    var t = body.type;
    if(t === '__reset'){
      state = makeSeed(Date.now()); cacheSave(state);
      broadcast(); notifyUI();
      return {code:0};
    }
    var p = body.patientId ? state.patients.find(function(x){ return x.id===Number(body.patientId); }) : null;
    switch(t){
      case 'bind':{
        var band = String(body.band||'').toUpperCase();
        if(!p) return {code:400,msg:'请先选择患者'};
        if(!band) return {code:400,msg:'缺少手表编号'};
        var used = activePatientByBand(band);
        if(used && used.id!==p.id) return {code:409,msg:'手表 '+band+' 正在给 '+used.name+' 使用'};
        if(p.bandActive) return {code:409,msg:p.name+' 已绑定手表 '+p.band};
        p.band = band; p.bandActive = true; p.status = '候诊中'; p.callToken = null;
        p.events.push({t:hm(0),label:'护士扫码绑定手表 '+band});
        feedAdd(p.no+' '+p.name+' 领取手表 '+band+' · '+p.dept,'#1F6FE0');
        break;
      }
      case 'call':{
        if(!p) return {code:404,msg:'患者不存在'};
        if(!p.bandActive) return {code:400,msg:'该患者尚未领取手表'};
        if(p.status==='已完成') return {code:400,msg:'该患者已完成就诊'};
        p.status='已叫号'; p.callToken=Date.now();
        p.events.push({t:hm(0),label:'叫号 · '+p.room});
        feedAdd(p.no+' '+p.name+' 已叫号 · '+p.room,'#E8961F');
        break;
      }
      case 'ack':{
        var bandAck = String(body.band||'').toUpperCase();
        var a = activePatientByBand(bandAck);
        if(!a) return {code:404,msg:'手表未绑定'};
        a.callToken=null; if(a.status==='已叫号') a.status='就诊中';
        a.events.push({t:hm(0),label:'患者手表确认，前往 '+a.room});
        feedAdd(a.name+' 手表确认收到叫号','#0FA3A0');
        break;
      }
      case 'visit':{
        if(!p) return {code:404};
        p.callToken=null; p.status='就诊中';
        p.events.push({t:hm(0),label:'进入诊室就诊'});
        feedAdd(p.name+' 进入 '+p.room+' 就诊','#0FA3A0');
        break;
      }
      case 'exam':{
        if(!p) return {code:404};
        p.examName=body.examName; p.examSteps=body.steps||[]; p.examStep=0;
        p.examToken=Date.now(); p.status='检查中';
        p.events.push({t:hm(0),label:'推送 '+body.examName+' 引导'});
        feedAdd(p.name+' 开始 '+body.examName+' 引导','#6E56D8');
        break;
      }
      case 'examNext':{
        if(!p || !p.examSteps) return {code:404};
        if(p.examStep < p.examSteps.length-1){ p.examStep++; }
        break;
      }
      case 'examDone':{
        if(!p) return {code:404};
        p.status='就诊中'; p.examToken=null; p.examName=null; p.examSteps=null; p.examStep=0;
        p.events.push({t:hm(0),label:'检查完成，返回诊室'});
        feedAdd(p.name+' 检查完成，返回诊室','#0FA3A0');
        break;
      }
      case 'med':{
        if(!p) return {code:404};
        p.medWin=body.win; p.medMeds=body.meds||[]; p.medToken=Date.now();
        p.events.push({t:hm(0),label:'推送取药提醒 · '+body.win});
        feedAdd(p.name+' 收到取药提醒 · '+body.win,'#0FA3A0');
        break;
      }
      case 'medAck':{
        var bandMed = String(body.band||'').toUpperCase();
        var m = activePatientByBand(bandMed);
        if(!m) return {code:404};
        m.medToken=null;
        m.events.push({t:hm(0),label:'患者已确认取到药'});
        feedAdd(m.name+' 已确认取药','#0FA3A0');
        break;
      }
      case 'finish': case 'unbind':{
        if(!p) return {code:404};
        var fb = p.band;
        p.status='已完成'; p.bandActive=false;
        p.callToken=null; p.examToken=null; p.medToken=null;
        p.events.push({t:hm(0),label:t==='finish'?'全部就诊完成 · 手表回收':'手表解绑回收'});
        feedAdd(p.name+' '+(t==='finish'?'全部就诊完成':'手表已解绑')+' · '+fb+' 已回收','#5A7C93');
        break;
      }
      case 'sos':{
        var bandSos = String(body.band||'').toUpperCase();
        var s = activePatientByBand(bandSos);
        var item = {id:Date.now(),band:bandSos,patient:s?s.name:'未知患者',
          kind:body.kind||'sos',loc:body.loc||'候诊区',time:hm(0),status:'active'};
        if(s) s.events.push({t:hm(0),label:(item.kind==='interpreter'?'呼叫手语翻译':'一键求助')+' · '+item.loc});
        state.sos.unshift(item);
        feedAdd((item.kind==='interpreter'?'手语翻译请求':'患者求助')+' · '+bandSos+' '+item.loc,
          item.kind==='interpreter'?'#6E56D8':'#F4574C');
        break;
      }
      case 'sosHandle': case 'sosResolve':{
        var ss = state.sos.find(function(x){ return x.id===Number(body.id); });
        if(!ss) return {code:404};
        ss.status = t==='sosHandle'?'handling':'resolved';
        ss.time = hm(0) + (t==='sosHandle'?' 处理中':' 已解决');
        break;
      }
      default: return {code:400,msg:'未知操作'};
    }
    bump();
    broadcast();
    notifyUI();
    return {code:0};
  }

  /* ---------- 拦截 fetch ---------- */
  function fakeResponse(obj,status){
    status = status||200;
    return {
      ok: status>=200 && status<300,
      status: status,
      json: function(){ return Promise.resolve(obj); },
      text: function(){ return Promise.resolve(JSON.stringify(obj)); }
    };
  }

  var realFetch = window.fetch;
  window.fetch = function(url,init){
    var path = typeof url==='string' ? url : (url&&url.url) || '';
    if(path.indexOf('/api/')===0){
      if(path==='/api/health'){
        return Promise.resolve(fakeResponse({ok:true,rev:state.rev,online:connected}));
      }
      if(path==='/api/nurse'){
        return ready.then(function(){
          return fakeResponse({ver:APP_VER,rev:state.rev,
            patients:state.patients,feed:state.feed,sos:state.sos,time:hm(0)});
        });
      }
      if(path.indexOf('/api/band/')===0){
        var band = path.slice('/api/band/'.length).toUpperCase();
        return ready.then(function(){
          var s = sessionFor(band); s.ver = APP_VER;
          return fakeResponse(s);
        });
      }
      if(path==='/api/action'){
        var body = {};
        try{ body = init&&init.body ? JSON.parse(init.body) : {}; }catch(e){}
        return ready.then(function(){
          var r = handleAction(body);
          var code = r.code===0 || !r.code ? 200 : (r.code===409 ? 409 : r.code);
          var obj = r.code===0 || !r.code ? r : {code:r.code,msg:r.msg};
          return fakeResponse(obj,code);
        }).catch(function(e){
          return fakeResponse({code:500,msg:String(e.message||e)},500);
        });
      }
    }
    return realFetch.apply(this, arguments);
  };

  /* 重置演示（护士端/手表端设置页调用） */
  window.__DCA_reset = function(){
    return ready.then(function(){
      state = makeSeed(Date.now()); cacheSave(state);
      broadcast(); notifyUI();
    });
  };
})();
