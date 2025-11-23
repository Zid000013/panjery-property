// main.js (module)
// Initialize Firebase + Firestore and core app behaviour
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-analytics.js";
import {
  getFirestore, collection, addDoc, getDocs, doc, getDoc,
  query, where, orderBy, updateDoc, setDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDVWCQFenGAjuapDGlt5clVoRkbc1MHRsY",
  authDomain: "panjery-property.firebaseapp.com",
  projectId: "panjery-property",
  storageBucket: "panjery-property.firebasestorage.app",
  messagingSenderId: "1053629459314",
  appId: "1:1053629459314:web:38460e0f0f473f571bcbeb",
  measurementId: "G-0WTZWLBL2M"
};

const app = initializeApp(firebaseConfig);
try{ getAnalytics(app); }catch(e){ /* analytics may fail in some hosts */ }
const db = getFirestore(app);

// Utility helpers
function $(sel){ return document.querySelector(sel) }
function $all(sel){ return Array.from(document.querySelectorAll(sel)) }
function fmtBDT(n){ return Number(n||0).toLocaleString(); }
function todayMonth(){ const d=new Date(); return d.toISOString().slice(0,7); }

// ======= Dashboard (index.html) =======
async function loadSummary(){
  const tenantsSnap = await getDocs(collection(db,'tenants'));
  const tenants = tenantsSnap.docs.map(d=>({id:d.id, ...d.data()}));
  $('#total-tenants').textContent = tenants.length;
  $('#branches-count').textContent = (await getDocs(collection(db,'branches'))).size;

  // collected this month & due this month
  const current = todayMonth();
  const paymentsSnap = await getDocs(collection(db,'payments'));
  let collected = 0;
  paymentsSnap.forEach(p => {
    const data = p.data();
    if(data.month === current) collected += Number(data.amount_paid||0);
  });
  $('#collected-month').textContent = fmtBDT(collected);

  // due calculation: sum of (rent + balance - paid_this_month) for each tenant if positive
  let dueSum = 0;
  for(const t of tenants){
    const paymentsQuery = query(collection(db,'payments'), where('tenant_id','==', t.id), where('month','==', current));
    const paymentDocs = await getDocs(paymentsQuery);
    let paidThis = 0;
    paymentDocs.forEach(p=> paidThis += Number(p.data().amount_paid||0));
    const balance = Number(t.balance||0);
    const need = Number(t.monthly_rent||0) + balance - paidThis;
    if(need>0) dueSum += need;
  }
  $('#due-month').textContent = fmtBDT(dueSum);

  // branches list
  const branchesSnap = await getDocs(collection(db,'branches'));
  const branchesDiv = $('#branches-list');
  branchesDiv.innerHTML = '';
  branchesSnap.forEach(b=>{
    const btn = document.createElement('button');
    btn.textContent = b.data().branch_name;
    btn.onclick = ()=> location.href = 'tenants.html?branch='+b.id;
    branchesDiv.appendChild(btn);
  });
}

// Seed default branches if not present
async function seedBranches(){
  const names = ['Gazipur Chawrasta','Police Line Cadet Housing','Uttara Sector 12','Porabari'];
  const bcol = collection(db,'branches');
  const snap = await getDocs(bcol);
  if(snap.size === 0){
    for(const n of names) await addDoc(bcol,{branch_name:n});
    alert('Default branches seeded.');
    await loadSummary();
  } else {
    alert('Branches already exist.');
  }
}

// Finalize month: for each tenant, compute unpaid and update tenant.balance accordingly
async function finalizeMonth(){
  if(!confirm('This will carry unpaid sums into tenant.balance for the current month. Continue?')) return;
  const current = todayMonth();
  const tenantsSnap = await getDocs(collection(db,'tenants'));
  for(const tdoc of tenantsSnap.docs){
    const t = {id: tdoc.id, ...tdoc.data()};
    // sum payments this month
    const paymentsQuery = query(collection(db,'payments'), where('tenant_id','==', t.id), where('month','==', current));
    const paySnap = await getDocs(paymentsQuery);
    let paidThis = 0; paySnap.forEach(p=> paidThis += Number(p.data().amount_paid||0));
    const need = Number(t.monthly_rent||0) + Number(t.balance||0) - paidThis;
    const newBalance = need>0 ? need : 0;
    if(newBalance !== Number(t.balance||0)){
      await updateDoc(doc(db,'tenants', t.id), { balance: newBalance });
    }
  }
  alert('Month finalized. Dues carried forward.');
  await loadSummary();
}

// ======= Tenants page =======
async function loadTenantsPage(){
  // populate branch selects
  const branchesSnap = await getDocs(collection(db,'branches'));
  const branchFilter = $('#branch-filter');
  const branchSelect = $('#branch-select');
  branchFilter.innerHTML = '<option value="">-- All branches --</option>';
  branchSelect && (branchSelect.innerHTML = '');
  branchesSnap.forEach(b=>{
    const opt = document.createElement('option'); opt.value = b.id; opt.textContent = b.data().branch_name;
    branchFilter.appendChild(opt);
    if(branchSelect) branchSelect.appendChild(opt.cloneNode(true));
  });

  // filter from URL
  const params = new URLSearchParams(location.search);
  const branchQ = params.get('branch') || '';
  if(branchQ) branchFilter.value = branchQ;

  // load tenants
  const tenantsSnap = await getDocs(collection(db,'tenants'));
  const tbody = document.querySelector('#tenants-table tbody');
  tbody.innerHTML = '';
  tenantsSnap.forEach(t=>{
    const data = t.data();
    const tr = document.createElement('tr');
    if(branchQ && data.branch_id !== branchQ) return;
    tr.innerHTML = `<td>${data.name||''}</td>
      <td>${data.phone||''}</td>
      <td>${data.room_no||''}</td>
      <td>${fmtBDT(data.monthly_rent||0)}</td>
      <td>${fmtBDT(data.balance||0)}</td>
      <td><a href="tenant_profile.html?id=${t.id}">View</a></td>`;
    tbody.appendChild(tr);
  });

  branchFilter && branchFilter.addEventListener('change', ()=> location.href = 'tenants.html?branch='+branchFilter.value);
}

// ======= Add tenant page =======
async function handleAddTenant(){
  const form = $('#tenant-form');
  if(!form) return;
  // populate branch select done in loadTenantsPage path
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f = new FormData(form);
    const data = {
      name: f.get('name'),
      phone: f.get('phone'),
      branch_id: f.get('branch_id'),
      room_no: f.get('room_no'),
      monthly_rent: Number(f.get('monthly_rent')||0),
      balance: 0,
      created_at: Timestamp.now()
    };
    await addDoc(collection(db,'tenants'), data);
    $('#tenant-msg').textContent = 'Tenant added.';
    form.reset();
  });
}

// ======= Payments page =======
async function handlePaymentsPage(){
  // populate tenant select
  const tenantsSnap = await getDocs(collection(db,'tenants'));
  const tselect = $('#payment-tenant');
  tselect.innerHTML = '<option value="">-- Select tenant --</option>';
  tenantsSnap.forEach(t=> {
    const opt = document.createElement('option'); opt.value = t.id; opt.textContent = t.data().name + ' (' + (t.data().room_no||'') + ')';
    tselect.appendChild(opt);
  });

  // load history
  const paymentsTable = document.querySelector('#payments-table tbody');
  async function loadHistory(){
    const snap = await getDocs(collection(db,'payments'));
    paymentsTable.innerHTML = '';
    for(const pdoc of snap.docs){
      const p = pdoc.data();
      const tenantDoc = await getDoc(doc(db,'tenants', p.tenant_id));
      const tname = tenantDoc.exists() ? tenantDoc.data().name : '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${tname}</td><td>${p.month}</td><td>${fmtBDT(p.amount_paid)}</td><td>${p.date_of_payment}</td>`;
      paymentsTable.appendChild(tr);
    }
  }
  await loadHistory();

  const form = $('#payment-form');
  form && form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const tenant_id = $('#payment-tenant').value;
    const month = $('#payment-month').value;
    const amount = Number($('#payment-amount').value||0);
    const date_of_payment = $('#payment-date').value;
    if(!tenant_id || !month || !amount) { $('#payment-msg').textContent = 'Fill required fields'; return;}
    await addDoc(collection(db,'payments'), { tenant_id, month, amount_paid: amount, date_of_payment });
    $('#payment-msg').textContent = 'Payment recorded.';
    // optional: reduce balance immediately if present (we'll recompute in display)
    // reload history
    await loadHistory();
  });
}

// ======= Tenant profile page =======
async function loadTenantProfile(){
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if(!id) { document.body.innerHTML = '<p>Missing tenant id</p>'; return; }
  const tdoc = await getDoc(doc(db,'tenants', id));
  if(!tdoc.exists()){ document.body.innerHTML = '<p>Tenant not found</p>'; return; }
  const t = tdoc.data();
  document.title = t.name + ' — Profile';

  const main = document.querySelector('main') || document.createElement('main');
  main.innerHTML = `
    <section class="card"><h2>${t.name}</h2>
      <div><strong>Phone:</strong> ${t.phone||''}</div>
      <div><strong>Room:</strong> ${t.room_no||''}</div>
      <div><strong>Monthly Rent:</strong> ${fmtBDT(t.monthly_rent||0)}</div>
      <div><strong>Balance (carried dues):</strong> ${fmtBDT(t.balance||0)}</div>
    </section>
    <section class="card">
      <h3>Payments</h3>
      <table id="profile-payments"><thead><tr><th>Month</th><th>Amount</th><th>Date</th></tr></thead><tbody></tbody></table>
    </section>
    <section class="card">
      <h3>Add Payment</h3>
      <form id="profile-payment-form">
        <label>Month<input type="month" id="pp-month" required></label>
        <label>Amount<input type="number" id="pp-amount" required></label>
        <label>Date<input type="date" id="pp-date" required></label>
        <button type="submit">Save Payment</button>
      </form>
      <div id="pp-msg" class="note"></div>
    </section>
  `;
  if(!document.querySelector('main')) document.body.appendChild(main);

  // fill payments
  const tbody = document.querySelector('#profile-payments tbody');
  const paySnap = await getDocs(query(collection(db,'payments'), where('tenant_id','==', id), orderBy('month','desc')));
  tbody.innerHTML = '';
  paySnap.forEach(p => {
    const d = p.data();
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.month}</td><td>${fmtBDT(d.amount_paid)}</td><td>${d.date_of_payment}</td>`;
    tbody.appendChild(tr);
  });

  // handle add payment
  const pf = document.querySelector('#profile-payment-form');
  pf && pf.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const month = $('#pp-month').value;
    const amount = Number($('#pp-amount').value||0);
    const date_of_payment = $('#pp-date').value;
    if(!month||!amount) { $('#pp-msg').textContent = 'Fill required fields'; return; }
    await addDoc(collection(db,'payments'), { tenant_id: id, month, amount_paid: amount, date_of_payment });
    $('#pp-msg').textContent = 'Saved';
    location.reload();
  });
}

// ======= Router-ish boot =======
document.addEventListener('DOMContentLoaded', async ()=>{
  const path = location.pathname.split('/').pop();
  if(path === '' || path === 'index.html'){
    await loadSummary();
    document.getElementById('seed-branches').addEventListener('click', seedBranches);
    document.getElementById('finalize-month').addEventListener('click', finalizeMonth);
  } else if(path === 'tenants.html'){
    await loadTenantsPage();
  } else if(path === 'add_tenant.html'){
    await loadTenantsPage(); // populate branch selects
    await handleAddTenant();
  } else if(path === 'payments.html'){
    await handlePaymentsPage();
  } else if(path === 'tenant_profile.html'){
    await loadTenantProfile();
  }
});
