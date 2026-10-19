/* 前端状态代理：拦截 /api/* 请求，用 localStorage 模拟后端
   用于 GitHub Pages 纯静态部署，护士端和手表端各自独立运行 */
(function(){
  'use strict';
  var KEY = 'dca_state_v5';
  var APP_VER = '5.0';

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

  function makeSeed(){
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
      rev:1,patients:patients,
      feed:[{t:hm(6),label:'今日已挂号 '+patients.length+' 人，等待发放手环',color:'#1F6FE0'}],
      sos:[]
    };
  }

  /* ---------- 状态持久化 ---------- */
  var state = null;
  try{
    var raw = localStorage.getItem(KEY);
    if(raw) state = JSON.parse(raw);
    if(!state || !Array.isArray(state.patients) || !state.patients.length){
      state = makeSeed();
      localStorage.setItem(KEY, JSON.stringify(state));
    }
  }catch(e){ state = makeSeed(); localStorage.setItem(KEY, JSON.stringify(state)); }

  function save(){
    try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){}
  }
  function bump(){ state.rev++; save(); }
  function feedAdd(label,color){
    state.feed.unshift({t:hm(0),label:label,color:color||'#1F6FE0'});
    if(state.feed.length>60) state.feed.length=60;
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

  /* ---------- 业务动作 ---------- */
  function handleAction(body){
    var t = body.type;
    var p = body.patientId ? state.patients.find(function(x){ return x.id===Number(body.patientId); }) : null;
    switch(t){
      case 'bind':{
        var band = String(body.band||'').toUpperCase();
        if(!p) return {code:400,msg:'请先选择患者'};
        if(!band) return {code:400,msg:'缺少手环编号'};
        var used = activePatientByBand(band);
        if(used && used.id!==p.id) return {code:409,msg:'手环 '+band+' 正在给 '+used.name+' 使用'};
        if(p.bandActive) return {code:409,msg:p.name+' 已绑定手环 '+p.band};
        p.band = band; p.bandActive = true; p.status = '候诊中'; p.callToken = null;
        p.events.push({t:hm(0),label:'护士扫码绑定手环 '+band});
        feedAdd(p.no+' '+p.name+' 领取手环 '+band+' · '+p.dept,'#1F6FE0');
        bump();
        return {code:0,patient:p,session:sessionFor(band)};
      }
      case 'call':{
        if(!p) return {code:404,msg:'患者不存在'};
        if(!p.bandActive) return {code:400,msg:'该患者尚未领取手环'};
        if(p.status==='已完成') return {code:400,msg:'该患者已完成就诊'};
        p.status='已叫号'; p.callToken=Date.now();
        p.events.push({t:hm(0),label:'叫号 · '+p.room});
        feedAdd(p.no+' '+p.name+' 已叫号 · '+p.room,'#E8961F');
        bump(); return {code:0};
      }
      case 'ack':{
        var bandAck = String(body.band||'').toUpperCase();
        var a = activePatientByBand(bandAck);
        if(!a) return {code:404,msg:'手环未绑定'};
        a.callToken=null; if(a.status==='已叫号') a.status='就诊中';
        a.events.push({t:hm(0),label:'患者手环确认，前往 '+a.room});
        feedAdd(a.name+' 手环确认收到叫号','#0FA3A0');
        bump(); return {code:0};
      }
      case 'visit':{
        if(!p) return {code:404};
        p.callToken=null; p.status='就诊中';
        p.events.push({t:hm(0),label:'进入诊室就诊'});
        feedAdd(p.name+' 进入 '+p.room+' 就诊','#0FA3A0');
        bump(); return {code:0};
      }
      case 'exam':{
        if(!p) return {code:404};
        p.examName=body.examName; p.examSteps=body.steps||[]; p.examStep=0;
        p.examToken=Date.now(); p.status='检查中';
        p.events.push({t:hm(0),label:'推送 '+body.examName+' 引导'});
        feedAdd(p.name+' 开始 '+body.examName+' 引导','#6E56D8');
        bump(); return {code:0};
      }
      case 'examNext':{
        if(!p || !p.examSteps) return {code:404};
        if(p.examStep < p.examSteps.length-1){ p.examStep++; bump(); }
        return {code:0,step:p.examStep};
      }
      case 'examDone':{
        if(!p) return {code:404};
        p.status='就诊中'; p.examToken=null; p.examName=null; p.examSteps=null; p.examStep=0;
        p.events.push({t:hm(0),label:'检查完成，返回诊室'});
        feedAdd(p.name+' 检查完成，返回诊室','#0FA3A0');
        bump(); return {code:0};
      }
      case 'med':{
        if(!p) return {code:404};
        p.medWin=body.win; p.medMeds=body.meds||[]; p.medToken=Date.now();
        p.events.push({t:hm(0),label:'推送取药提醒 · '+body.win});
        feedAdd(p.name+' 收到取药提醒 · '+body.win,'#0FA3A0');
        bump(); return {code:0};
      }
      case 'medAck':{
        var bandMed = String(body.band||'').toUpperCase();
        var m = activePatientByBand(bandMed);
        if(!m) return {code:404};
        m.medToken=null;
        m.events.push({t:hm(0),label:'患者已确认取到药'});
        feedAdd(m.name+' 已确认取药','#0FA3A0');
        bump(); return {code:0};
      }
      case 'finish': case 'unbind':{
        if(!p) return {code:404};
        var fb = p.band;
        p.status='已完成'; p.bandActive=false;
        p.callToken=null; p.examToken=null; p.medToken=null;
        p.events.push({t:hm(0),label:t==='finish'?'全部就诊完成 · 手环回收':'手环解绑回收'});
        feedAdd(p.name+' '+(t==='finish'?'全部就诊完成':'手环已解绑')+' · '+fb+' 已回收','#5A7C93');
        bump(); return {code:0};
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
        bump(); return {code:0};
      }
      case 'sosHandle': case 'sosResolve':{
        var ss = state.sos.find(function(x){ return x.id===Number(body.id); });
        if(!ss) return {code:404};
        ss.status = t==='sosHandle'?'handling':'resolved';
        ss.time = hm(0) + (t==='sosHandle'?' 处理中':' 已解决');
        bump(); return {code:0};
      }
      case '__reset':{
        state = makeSeed(); save(); return {code:0};
      }
      default: return {code:400,msg:'未知操作'};
    }
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
        return Promise.resolve(fakeResponse({ok:true,rev:state.rev}));
      }
      if(path==='/api/nurse'){
        return Promise.resolve(fakeResponse({ver:APP_VER,rev:state.rev,
          patients:state.patients,feed:state.feed,sos:state.sos,time:hm(0)}));
      }
      if(path.indexOf('/api/band/')===0){
        var band = path.slice('/api/band/'.length).toUpperCase();
        var s = sessionFor(band); s.ver = APP_VER;
        return Promise.resolve(fakeResponse(s));
      }
      if(path==='/api/action'){
        var body = {};
        try{ body = init&&init.body ? JSON.parse(init.body) : {}; }catch(e){}
        try{
          var r = handleAction(body);
          var code = r.code===0 || !r.code ? 200 : (r.code===409 ? 409 : r.code);
          var obj = r.code===0 || !r.code ? r : {code:r.code,msg:r.msg};
          return Promise.resolve(fakeResponse(obj,code));
        }catch(e){
          return Promise.resolve(fakeResponse({code:500,msg:String(e.message||e)},500));
        }
      }
    }
    return realFetch.apply(this, arguments);
  };

  /* 暴露重置接口（用于开发调试） */
  window.__DCA_reset = function(){ handleAction({type:'__reset'}); };
})();
