// Finite, interruptible feedback. Never a permanent animation loop.
let enabled = true;
try { enabled = localStorage.getItem('kaputt-motion') !== 'off'; } catch {}
const preference = matchMedia('(prefers-reduced-motion: reduce)');
const running = new Set();
export const reduced = () => !enabled || preference.matches;
export const motionEnabled = () => enabled;
export function animate(element, frames, duration = 300, options = {}) {
  if (!element || reduced() || document.hidden || !element.animate) return null;
  const animation = element.animate(frames, {duration, easing:'cubic-bezier(.2,.8,.2,1)', ...options});
  running.add(animation); animation.finished.catch(()=>{}).finally(()=>running.delete(animation));
  return animation;
}
export function cancelMotion() { for (const a of running) a.cancel(); running.clear(); }
export function toggleMotion() {
  enabled = !enabled;
  try { localStorage.setItem('kaputt-motion', enabled ? 'on' : 'off'); } catch {}
  apply(); return enabled;
}
function apply() {
  document.documentElement.dataset.motion = reduced() ? 'off' : 'on';
  if (reduced()) cancelMotion();
  dispatchEvent(new Event('kaputt-motion-change'));
}
preference.addEventListener('change', apply);
document.addEventListener('visibilitychange', ()=>{if(document.hidden)cancelMotion();});
export function enter(element) { animate(element,[{opacity:0,transform:'translateY(18px) scale(.97)'},{opacity:1,transform:'translateY(0) scale(1)'}],280); }
export function bump(element) { animate(element,[{transform:'scale(1)'},{transform:'scale(1.16)',offset:.4},{transform:'scale(1)'}],350); }
export function shake(element) { animate(element,[{transform:'translateX(0)'},{transform:'translateX(-7px)'},{transform:'translateX(6px)'},{transform:'translateX(-3px)'},{transform:'translateX(0)'}],340); }
export function number(element, value) {
  const changed = element.textContent !== String(value);
  element.textContent = value; if (changed) bump(element);
}
export function celebrate(root) {
  root.replaceChildren(); if(reduced())return;
  for(let i=0;i<16;i++) {
    const icon=document.createElement('img');icon.src='assets/icons/sparkle-fill.svg';icon.alt='';
    icon.style.left=`${8+(i*29)%84}%`;root.append(icon);
    const a=animate(icon,[{opacity:0,transform:'translateY(0) scale(.3) rotate(0)'},{opacity:1,offset:.15},{opacity:0,transform:`translateY(${220+i%5*42}px) scale(.8) rotate(${i%2?210:-210}deg)`}],1400+i%4*140,{delay:i%5*45});
    a?.finished.finally(()=>icon.remove()).catch(()=>{});
  }
}
document.addEventListener('pointerdown',event=>{
  const button=event.target.closest('button:enabled,.sheet-link');
  if(button && !button.classList.contains('die-hit'))animate(button,[{transform:'scale(1)'},{transform:'scale(.97)'},{transform:'scale(1)'}],180);
});
apply();
