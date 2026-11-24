/* زَفّة — دوال مشتركة */
'use strict';
const $ = id => document.getElementById(id);
const $$ = s => [...document.querySelectorAll(s)];
const qs = new URLSearchParams(location.search);

let _tt;
function toast(t, ms = 2800) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = t; el.classList.add('on');
  clearTimeout(_tt); _tt = setTimeout(() => el.classList.remove('on'), ms);
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'حدث خطأ، حاول مرة ثانية');
  return d;
}

const money = (cents, cur = 'usd') =>
  cur === 'sdg'
    ? Math.round(cents / 100).toLocaleString('en') + ' ج.س'
    : (cur === 'usd' ? '$' : '') + (cents / 100).toFixed(cents % 100 ? 2 : 0);

const arNum = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('تم النسخ ✓'); }
  catch { prompt('انسخ الرابط:', t); }
}

/* reveal on scroll + شبكة أمان */
function initReveal() {
  const els = $$('.rv');
  if (!els.length) return;
  const showAll = () => els.forEach(e => e.classList.add('in'));

  if (!('IntersectionObserver' in window)) { showAll(); return; }

  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: .16, rootMargin: '0px 0px -40px 0px' });
  els.forEach(e => io.observe(e));

  // شبكة أمان: لا تبقى أي عناصر مخفية (طباعة، لقطات شاشة، متصفحات قديمة)
  setTimeout(() => {
    els.forEach(e => {
      const r = e.getBoundingClientRect();
      if (r.top < innerHeight * 1.4) e.classList.add('in');
    });
  }, 900);
  addEventListener('beforeprint', showAll);
}

/* nav shadow */
function initNav() {
  const n = document.querySelector('.nav');
  if (!n) return;
  const f = () => n.classList.toggle('scrolled', scrollY > 12);
  f(); addEventListener('scroll', f, { passive: true });
}

/* حالة الدعوة المحفوظة */
const LAST_KEY = 'zaffa_last';
function getLast() { try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; } }
function setLast(v) { try { localStorage.setItem(LAST_KEY, JSON.stringify(v)); } catch {} }

document.addEventListener('DOMContentLoaded', () => { initReveal(); initNav(); });
