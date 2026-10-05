// LS AI parity: the new/changed look-ups checked against independent SQL (read-only, no cost). node scripts/assistant-parity.js
require('dotenv').config();
const S=require('../db/schema'),{BY_KEY}=require('../utils/assistantTools'),E=require('../utils/assistantEntities'),ST=require('../utils/assistantStats');
let pass=0,fail=0; const ok=(n,c,x='')=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+(c?'':'  '+x));};
const num=(s)=>Number(String(s).replace(/,/g,''));
(async()=>{
  const today=S.istDateString(); const base={question:'',today,user:'x',store:'all'};
  // tasks
  let r=await BY_KEY.tasks.run({...base,question:'open tasks'}); let d=await S.queryOne("SELECT COUNT(*) n, SUM(due_date<?) o FROM crm_tasks WHERE status='open'",[today]);
  ok('tasks total',r.total===Number(d.n),`${r.total} vs ${d.n}`); ok('tasks overdue in summary',r.summary.includes(`${d.o} overdue`),r.summary);
  r=await BY_KEY.tasks.run({...base,question:'zakir tasks',users:['zakir']}); d=await S.queryOne("SELECT COUNT(*) n FROM crm_tasks WHERE status='open' AND assigned_to='zakir'");
  ok('tasks for zakir',r.total===Number(d.n),`${r.total} vs ${d.n}`);
  const cl=(await E.clientCandidates('Sansui'))[0]; r=await BY_KEY.tasks.run({...base,question:'next follow up with Sansui',client:{ids:cl.ids,label:cl.label}});
  d=await S.queryAll(`SELECT due_date FROM crm_tasks WHERE status='open' AND due_date>=? AND contact_id IN (${cl.ids.map(()=>'?').join(',')}) ORDER BY due_date LIMIT 1`,[today,...cl.ids]);
  ok('next follow-up Sansui',d.length?r.summary.includes(E.fmtD(d[0].due_date)):/No upcoming/.test(r.summary),r.summary);
  const wk=E.parsePeriod('this week',today); r=await BY_KEY.tasks.run({...base,question:'tasks this week',period:wk});
  d=await S.queryOne("SELECT COUNT(*) n FROM crm_tasks WHERE status='open' AND due_date BETWEEN ? AND ?",[wk.from,wk.to]); ok('tasks this week window',r.total===Number(d.n),`${r.total} vs ${d.n}`);
  r=await BY_KEY.tasks.run({...base,question:'completed tasks'}); d=await S.queryOne("SELECT COUNT(*) n FROM crm_tasks WHERE status='done'"); ok('done tasks',r.total===Number(d.n),`${r.total} vs ${d.n}`);
  // requests
  r=await BY_KEY.pending_requests.run({...base,question:'what did pranav approve',users:['pranav']}); d=await S.queryOne("SELECT COUNT(*) n FROM requests WHERE status='approved' AND reviewed_by='pranav'"); ok('approved by pranav',r.total===Number(d.n),`${r.total} vs ${d.n}`);
  // stock cover vs independent SQL
  const it=(await S.queryOne("SELECT r.item_code c FROM reels r WHERE r.status='In Stock' GROUP BY r.item_code ORDER BY COUNT(*) DESC LIMIT 1")).c;
  const cov=await ST.stockCover({itemCode:it,today}); const x=cov.rows[0];
  const stock=await S.queryOne("SELECT SUM(quantity) q FROM reels WHERE status='In Stock' AND item_code=?",[it]); const sh=await S.queryOne("SELECT COALESCE(SUM(o.quantity_shipped),0) q FROM outwards o JOIN reels r ON r.reel_number=o.reel_number WHERE r.item_code=? AND o.outward_date>=?",[it,`${E.add(today,-90)} 00:00:00`]);
  ok('cover stock',x.stock===Number(stock.q),`${x.stock} vs ${stock.q}`); ok('cover shipped',x.shipped===Number(sh.q),`${x.shipped} vs ${sh.q}`);
  ok('cover math',x.cover_days===null?x.shipped===0:Math.abs(x.cover_days-x.stock/(x.shipped/cov.days))<1e-6);
  r=await BY_KEY.stock_cover.run({...base,question:'run out',item:{code:it,label:''}}); ok('cover tool runs',r.rows.length===1&&!!r.summary,r.summary);
  // store filter on cover: gelco has zero stock
  const g=await ST.stockCover({store:'secondary',today}); const gs=await S.queryOne("SELECT SUM(quantity) q FROM reels WHERE status='In Stock' AND store_code='secondary'"); ok('cover store filter',g.rows.reduce((a,y)=>a+y.stock,0)===Number(gs.q),'secondary stock total');
  // customer rhythm: Gelco order days independent
  const rh=(await ST.customerRhythm({today})).find((y)=>y.key==='gelco electronics');
  const gd=await S.queryOne("SELECT COUNT(DISTINCT substr(outward_date,1,10)) n FROM outwards WHERE lower(customer_name) LIKE 'gelco e%'");
  ok('rhythm orders',!!rh&&rh.orders===Number(gd.n),`${rh&&rh.orders} vs ~${gd.n}`);
  ok('rhythm excludes internal',!(await ST.customerRhythm({today})).some((y)=>y.key==='gelco stores'));
  // PO value
  const po=await S.queryOne("SELECT p.id,p.po_number,p.status,(SELECT SUM(quantity_ordered*COALESCE(unit_price,0)) FROM crm_po_items WHERE po_id=p.id) v FROM crm_purchase_orders p WHERE (SELECT COUNT(*) FROM crm_po_items WHERE po_id=p.id)>0 LIMIT 1");
  r=await BY_KEY.purchase_orders.run({...base,question:'po',po:{id:po.id,po_number:po.po_number,status:po.status}}); ok('PO value',r.summary.includes(`value ${num(Math.round(po.v)).toLocaleString('en-IN')}`),`${r.summary} vs ${po.v}`);
  // clients
  r=await BY_KEY.clients_pipeline.run({...base,question:'which clients have we not contacted'}); d=await S.queryAll("SELECT c.id FROM crm_contacts c WHERE c.status!='lost' AND NOT EXISTS(SELECT 1 FROM crm_notes n WHERE n.contact_id=c.id) AND NOT EXISTS(SELECT 1 FROM crm_tasks t WHERE t.contact_id=c.id AND t.status='done')");
  ok('never contacted',r.total===d.length,`${r.total} vs ${d.length}`);
  r=await BY_KEY.client_notes.run({...base,question:'notes',client:{ids:(await E.clientCandidates('Rotomotive'))[0].ids,label:'Roto'}}); d=await S.queryOne("SELECT COUNT(*) n FROM crm_notes WHERE contact_id IN (SELECT id FROM crm_contacts WHERE company_id=(SELECT company_id FROM crm_contacts WHERE id=?))",[(await E.clientCandidates('Rotomotive'))[0].ids[0]]);
  ok('notes count',r.rows.filter((y)=>y.kind==='Note').length===Math.min(10,Number(d.n)),`${r.rows.length}`);
  // previousPeriod
  ok('prev month-to-date',E.previousPeriod({from:'2026-10-01',to:'2026-10-06'}).to==='2026-09-06'); ok('prev full month',E.previousPeriod({from:'2026-03-01',to:'2026-03-31'}).label==='February 2026');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
})().catch((e)=>{console.error(e);process.exit(1)});
